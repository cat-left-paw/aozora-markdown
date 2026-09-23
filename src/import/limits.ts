import type {
  ImportLimits,
  ImportMetrics,
  ImportDiagnostic,
  ImportInput,
  ImportOptions,
  OutputExtension,
} from "./types.js";
import {
  ConversionOptionsError,
  normalizeOptions,
  type NormalizedOptions,
} from "../core/options.js";
export const IMPORT_CONTRACT = "aozora-import-v2";
const MiB = 1048576;
export const DEFAULT_IMPORT_LIMITS: Readonly<ImportLimits> = Object.freeze({
  sources: 64,
  inputBytes: 64 * MiB,
  totalInputBytes: 128 * MiB,
  archiveEntries: 2000,
  totalEntries: 8000,
  filenameBytes: 4096,
  textBytes: 16 * MiB,
  declaredBytes: 128 * MiB,
  expandedBytes: 128 * MiB,
  outputBytes: 128 * MiB,
  jobTimeoutMs: 60000,
});
export class ImportFailure extends Error {
  entryIndex?: number;
  constructor(
    readonly code: string,
    readonly stage: ImportDiagnostic["stage"],
    readonly scope: "unit" | "batch" | "cancel",
    readonly reason: string,
  ) {
    super(reason);
  }
}
export function resolveLimits(value: Partial<ImportLimits> = {}): ImportLimits {
  const limits = { ...DEFAULT_IMPORT_LIMITS };
  for (const key of Object.keys(limits) as (keyof ImportLimits)[]) {
    const number = value[key] ?? limits[key];
    if (!Number.isSafeInteger(number) || number <= 0)
      throw new ImportFailure("INVALID_LIMIT", "input", "batch", key);
    limits[key] = number;
  }
  return limits;
}
/**
 * Batch preflight before any payload read or Worker start. Rejections use
 * INVALID_OPTION with a stable dotted reason (`outputExtension`,
 * `conversion.renameToMd`, `conversion.headingLevels.medium`, ...).
 */
export function validateImportOptions(options: ImportOptions): {
  outputExtension: OutputExtension;
  conversion: NormalizedOptions;
} {
  const invalid = (reason: string) =>
    new ImportFailure("INVALID_OPTION", "input", "batch", reason);
  if (typeof options !== "object" || options === null || Array.isArray(options))
    throw invalid("options");
  const outputExtension =
    options.outputExtension === undefined ? "md" : options.outputExtension;
  if (outputExtension !== "md" && outputExtension !== "txt")
    throw invalid("outputExtension");
  try {
    return {
      outputExtension,
      conversion: normalizeOptions(options.conversion),
    };
  } catch (cause) {
    throw invalid(
      cause instanceof ConversionOptionsError && cause.field
        ? "conversion." + cause.field
        : "conversion",
    );
  }
}
export function emptyMetrics(): ImportMetrics {
  return {
    sourceCount: 0,
    reservedInputBytes: 0,
    inputBytes: 0,
    zipEntries: 0,
    declaredBytes: 0,
    expandedBytes: 0,
    compressedBytesRead: 0,
    retainedExpandedBytes: 0,
    rejectedChunks: 0,
    outputBytes: 0,
    conversions: 0,
    payloadReads: 0,
    readersOpened: 0,
    readersClosed: 0,
    payloadStreamsClosed: 0,
    payloadStreamsAborted: 0,
  };
}
export function checkLimit(
  value: number,
  limit: number,
  key: keyof ImportLimits,
  scope: "unit" | "batch",
  stage: ImportDiagnostic["stage"],
): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > limit)
    throw new ImportFailure("LIMIT_EXCEEDED", stage, scope, key);
}
export const fileId = (id: string, index?: number): string =>
  JSON.stringify(index === undefined ? [id] : [id, index]);
export const basename = (name: string): string =>
  name.split(/[\\/]/u).at(-1) ?? "";
export function inputKind(name: string): ImportInput["kind"] | undefined {
  return /\.(txt|md|zip)$/iu.exec(basename(name))?.[1].toLowerCase() as
    | ImportInput["kind"]
    | undefined;
}
export function validateIdentity(
  inputs: readonly { id: string; name: string; kind: ImportInput["kind"] }[],
  limits: ImportLimits,
): void {
  checkLimit(inputs.length, limits.sources, "sources", "batch", "input");
  const seen = new Set<string>();
  for (const input of inputs) {
    if (typeof input.id !== "string" || !input.id.trim() || seen.has(input.id))
      throw new ImportFailure(
        "INVALID_INPUT",
        "input",
        "batch",
        "invalid-or-duplicate-id",
      );
    seen.add(input.id);
  }
}
export function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new ImportFailure("CANCELLED", "read", "cancel", "caller-cancelled");
}
