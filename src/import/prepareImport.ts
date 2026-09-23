import { convertText } from "../core/pipeline.js";
import { decodeTextBytes } from "../encoding/index.js";
import { utf8Length } from "../policies/naming.js";
import type { OutputRequest } from "../policies/outputPlan.js";
import { withZip } from "./zipReader.js";
import { outputRequest, planArtifacts } from "./outputPlanning.js";
import {
  ImportFailure,
  emptyMetrics,
  resolveLimits,
  validateIdentity,
  validateImportOptions,
  IMPORT_CONTRACT,
  inputKind,
  fileId,
  checkAbort,
  checkLimit,
} from "./limits.js";
import type {
  ImportInput,
  ImportOptions,
  ImportContext,
  ImportResult,
  PreparedArtifact,
  ImportOutcome,
} from "./types.js";
export async function prepareImport(
  inputs: readonly ImportInput[],
  options: ImportOptions = {},
  context: ImportContext = {},
): Promise<ImportResult> {
  const result: ImportResult = {
    contract: IMPORT_CONTRACT,
    status: "completed",
    artifacts: [],
    outcomes: [],
    diagnostics: [],
    metrics: emptyMetrics(),
  };
  const metrics = result.metrics,
    requests: OutputRequest[] = [];
  let active: ImportInput | undefined, entryIndex: number | undefined;
  const diagnostic = (error: ImportFailure) =>
    result.diagnostics.push({
      code: error.code,
      severity: "error",
      stage: error.stage,
      inputId: active?.id ?? "",
      ...(entryIndex === undefined ? {} : { entryIndex }),
      reason: error.reason,
    });
  const discard = () => {
    result.artifacts = [];
    for (const o of result.outcomes)
      if (o.status === "prepared") o.status = "discarded";
  };
  try {
    const limits = resolveLimits(options?.limits);
    const settings = validateImportOptions(options);
    validateIdentity(inputs, limits);
    checkAbort(context.signal);
    metrics.sourceCount = inputs.length;
    // Reserve the entire batch before starting readers. Per-unit byte limits are
    // handled below so one oversized source does not prevent other valid units.
    for (const input of inputs) {
      active = input;
      if (!(input.bytes instanceof Uint8Array))
        throw new ImportFailure(
          "INVALID_INPUT",
          "input",
          "batch",
          "bytes-required",
        );
      metrics.reservedInputBytes += input.bytes.byteLength;
      checkLimit(
        metrics.reservedInputBytes,
        limits.totalInputBytes,
        "totalInputBytes",
        "batch",
        "input",
      );
    }
    for (const input of inputs) {
      active = input;
      entryIndex = undefined;
      checkAbort(context.signal);
      const unit: ImportOutcome = {
        inputId: input.id,
        fileId: fileId(input.id),
        kind: input.kind,
        status: "discarded",
      };
      result.outcomes.push(unit);
      const staged: PreparedArtifact[] = [],
        stagedRequests: OutputRequest[] = [];
      const convert = (
        bytes: Uint8Array,
        outcome: ImportOutcome,
        relativeName: string,
      ) => {
        entryIndex = outcome.entryIndex;
        checkAbort(context.signal);
        checkLimit(
          bytes.length,
          limits.textBytes,
          "textBytes",
          "unit",
          "decode",
        );
        const decoded = decodeTextBytes(bytes, { encoding: options.encoding });
        if (!decoded.ok)
          throw new ImportFailure(
            decoded.code,
            "decode",
            "unit",
            "strict-body-decode",
          );
        context.onProgress?.({
          stage: "converting",
          inputId: input.id,
          entryIndex,
          metrics: { ...metrics },
        });
        checkAbort(context.signal);
        // Exactly one conversion; namingMetadata and all stage statistics come
        // from this result. The input kind and output extension never reach core.
        const conversion = convertText(decoded.text, settings.conversion);
        metrics.conversions++;
        checkAbort(context.signal);
        metrics.outputBytes += utf8Length(conversion.text);
        checkLimit(
          metrics.outputBytes,
          limits.outputBytes,
          "outputBytes",
          "batch",
          "output",
        );
        const artifact: PreparedArtifact = {
          fileId: outcome.fileId,
          source: {
            inputId: input.id,
            ...(entryIndex === undefined ? {} : { entryIndex }),
          },
          relativePath: "",
          bytes: new TextEncoder().encode(conversion.text),
          format: settings.outputExtension,
          conversion,
          decoded: { encoding: decoded.encoding, bom: decoded.bom },
        };
        staged.push(artifact);
        stagedRequests.push(
          outputRequest(input, artifact, relativeName, options),
        );
        outcome.status = "prepared";
        context.onProgress?.({
          stage: "converted",
          inputId: input.id,
          entryIndex,
          metrics: { ...metrics },
        });
        checkAbort(context.signal);
      };
      try {
        if (
          typeof input.name !== "string" ||
          inputKind(input.name) !== input.kind
        )
          throw new ImportFailure(
            "INVALID_INPUT",
            "input",
            "unit",
            "kind-extension-mismatch",
          );
        metrics.inputBytes += input.bytes.length;
        checkLimit(
          input.bytes.length,
          limits.inputBytes,
          "inputBytes",
          "unit",
          "input",
        );
        if (input.kind === "zip") {
          await withZip(
            input,
            limits,
            metrics,
            context,
            result.outcomes,
            result.diagnostics,
            async (entries, read) => {
              for (const entry of entries) {
                if (entry.outcome.kind === "ignored") continue;
                entryIndex = entry.outcome.entryIndex;
                const bytes = await read(entry);
                convert(bytes, entry.outcome, entry.validated.relativeName);
              }
              unit.status = staged.length
                ? "prepared"
                : entries.length
                  ? "ignored"
                  : "empty";
            },
          );
        } else convert(input.bytes, unit, input.name);
        checkAbort(context.signal);
        result.artifacts.push(...staged);
        requests.push(...stagedRequests);
      } catch (cause) {
        const error =
          cause instanceof ImportFailure
            ? cause
            : new ImportFailure(
                input.kind === "zip" ? "ZIP_INVALID" : "IMPORT_FAILED",
                input.kind === "zip" ? "read" : "convert",
                "unit",
                "invalid-structure-data-or-conversion",
              );
        if (context.signal?.aborted)
          throw new ImportFailure(
            "CANCELLED",
            "read",
            "cancel",
            "caller-cancelled",
          );
        if (error.entryIndex !== undefined) entryIndex = error.entryIndex;
        if (error.scope !== "unit") throw error;
        unit.status = "failed";
        unit.reason = error.code;
        for (const outcome of result.outcomes)
          if (
            outcome.inputId === input.id &&
            outcome.entryIndex !== undefined &&
            outcome.status !== "ignored" &&
            outcome.status !== "failed"
          )
            outcome.status = "discarded";
        diagnostic(error);
      }
    }
    checkAbort(context.signal);
    checkLimit(
      metrics.outputBytes,
      limits.outputBytes,
      "outputBytes",
      "batch",
      "output",
    );
    planArtifacts(result.artifacts, requests, inputs);
    const units = result.outcomes.filter((o) => o.entryIndex === undefined);
    result.status = units.some((o) => o.status === "failed")
      ? units.some((o) => o.status !== "failed")
        ? "partial"
        : "failed"
      : "completed";
  } catch (cause) {
    const error =
      cause instanceof ImportFailure
        ? cause
        : new ImportFailure(
            "IMPORT_FAILED",
            "input",
            "batch",
            "invalid-input-or-callback",
          );
    diagnostic(error);
    discard();
    result.status = error.scope === "cancel" ? "cancelled" : "failed";
    for (const input of inputs) {
      let unit = result.outcomes.find(
        (o) => o.inputId === input.id && o.entryIndex === undefined,
      );
      if (!unit) {
        unit = {
          inputId: input.id,
          fileId: fileId(input.id),
          kind: input.kind,
          status: "discarded",
        };
        result.outcomes.push(unit);
      }
      if (result.status === "cancelled") unit.status = "cancelled";
      else if (unit.status !== "failed") {
        unit.status = "failed";
        unit.reason = error.code;
      }
    }
  }
  return result;
}
