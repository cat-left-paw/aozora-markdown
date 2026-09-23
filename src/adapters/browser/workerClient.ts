import type {
  ImportOptions,
  ImportResult,
  ImportContext,
  OutputExtension,
  PreparedArtifact,
} from "../../import/types.js";
import {
  checkAbort,
  emptyMetrics,
  fileId,
  ImportFailure,
  inputKind,
  resolveLimits,
  validateImportOptions,
  IMPORT_CONTRACT,
} from "../../import/limits.js";
import { preflightFiles, readFiles, type BrowserInput } from "./files.js";
import { browserJobStats } from "./jobStats.js";
import type { JobState } from "../../policies/jobStats.js";
import type {
  ImportWorkerRequest,
  ImportWorkerResponse,
} from "./workerProtocol.js";
export interface BrowserArtifact extends PreparedArtifact {
  blob: Blob;
}
export interface BrowserImportResult {
  result: ImportResult;
  artifacts: BrowserArtifact[];
  stats: JobState;
}
export interface BrowserImportContext extends ImportContext {
  /** Caller owns identity; one new owned Worker per invocation. No pool. */
  requestId: string;
  attemptId: string;
  workerFactory?: () => Worker;
  workerUrl?: string | URL;
  /** Optional host Blob constructor (also permits delivery failure testing). */
  createBlob?: (bytes: Uint8Array<ArrayBuffer>, mime: string) => Blob;
}
export function importFiles(
  inputs: readonly BrowserInput[],
  options: ImportOptions,
  context: BrowserImportContext,
): Promise<BrowserImportResult> {
  return new Promise((resolve) => {
    let settled = false,
      worker: Worker | undefined,
      timer: ReturnType<typeof setTimeout> | undefined,
      outputExtension: OutputExtension | undefined;
    let latest: ImportResult = {
      contract: IMPORT_CONTRACT,
      status: "failed",
      artifacts: [],
      outcomes: [],
      diagnostics: [],
      metrics: emptyMetrics(),
    };
    const reading = new AbortController();
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      context.signal?.removeEventListener("abort", onAbort);
      reading.abort();
      if (worker) {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        worker.removeEventListener("messageerror", onError);
        worker.terminate();
      }
    };
    const finish = (result: ImportResult, artifacts: BrowserArtifact[]) => {
      if (settled) return;
      const stats = browserJobStats(
        result,
        context.attemptId,
        artifacts.length > 0,
      );
      settled = true;
      cleanup();
      resolve({ result, artifacts, stats });
    };
    const fail = (code: string, reason: string, cancelled = false) => {
      if (settled) return;
      const result: ImportResult = {
        ...latest,
        status: cancelled ? "cancelled" : "failed",
        artifacts: [],
        diagnostics: [
          ...latest.diagnostics,
          { code, severity: "error", stage: "delivery", inputId: "", reason },
        ],
        outcomes: inputs.map((input) => ({
          inputId: input.id,
          fileId: fileId(input.id),
          kind: input.kind ?? inputKind(input.file.name) ?? "txt",
          status: cancelled ? "cancelled" : "failed",
          reason: code,
        })),
      };
      finish(result, []);
    };
    function onAbort() {
      fail("CANCELLED", "caller-cancelled", true);
    }
    function onError(event?: Event) {
      event?.preventDefault();
      fail("WORKER_FAILED", "worker-load-runtime-or-transfer");
    }
    function onMessage(event: MessageEvent<ImportWorkerResponse>) {
      if (settled || event.data?.requestId !== context.requestId) return;
      const message = event.data;
      if (message.type === "progress") {
        try {
          latest.metrics = { ...message.progress.metrics };
          context.onProgress?.(message.progress);
        } catch {
          fail("PROGRESS_FAILED", "progress-callback");
        }
      } else if (message.type === "failure")
        fail("WORKER_FAILED", "worker-request-or-result-transfer");
      else if (message.type === "result") {
        try {
          const received = message.result;
          if (
            !received ||
            !["completed", "partial", "failed", "cancelled"].includes(
              received.status,
            ) ||
            !Array.isArray(received.outcomes) ||
            !Array.isArray(received.diagnostics) ||
            !received.metrics ||
            received.contract !== IMPORT_CONTRACT ||
            !Array.isArray(received.artifacts) ||
            received.artifacts.some((a) => a?.format !== outputExtension) ||
            ((received.status === "failed" ||
              received.status === "cancelled") &&
              received.artifacts.length > 0)
          ) {
            fail("INVALID_WORKER_RESULT", "invalid-result-contract");
            return;
          }
          latest = received;
          checkAbort(context.signal);
          const artifacts: BrowserArtifact[] = [];
          for (const candidate of latest.artifacts) {
            checkAbort(context.signal);
            if (settled) return;
            const mime =
              candidate.format === "md"
                ? "text/markdown;charset=utf-8"
                : "text/plain;charset=utf-8";
            const blob = context.createBlob
              ? context.createBlob(candidate.bytes.slice(), mime)
              : new Blob([candidate.bytes.slice()], { type: mime });
            artifacts.push({ ...candidate, blob });
          }
          checkAbort(context.signal);
          finish(latest, artifacts);
        } catch {
          if (context.signal?.aborted) onAbort();
          else fail("BLOB_FAILED", "artifact-construction");
        }
      }
    }
    context.signal?.addEventListener("abort", onAbort, { once: true });
    if (context.signal?.aborted) {
      onAbort();
      return;
    }
    void (async () => {
      try {
        if (!context.requestId?.trim() || !context.attemptId?.trim())
          throw new ImportFailure(
            "INVALID_JOB_ID",
            "input",
            "batch",
            "request-and-attempt-id-required",
          );
        const limits = resolveLimits(options?.limits);
        outputExtension = validateImportOptions(options).outputExtension;
        preflightFiles(inputs, limits, latest.metrics);
        let remaining = limits.jobTimeoutMs;
        const armWatchdog = () => {
          const armedAt = performance.now();
          timer = setTimeout(
            () => {
              remaining -= performance.now() - armedAt;
              if (remaining > 0) armWatchdog();
              else fail("JOB_TIMEOUT", "caller-watchdog");
            },
            Math.min(remaining, 2147483647),
          );
        };
        armWatchdog();
        if (
          !context.workerFactory &&
          (!context.workerUrl || typeof Worker === "undefined")
        ) {
          fail("WORKER_UNAVAILABLE", "module-worker-required");
          return;
        }
        const prepared = await readFiles(
          inputs,
          limits,
          latest.metrics,
          reading.signal,
          () => settled,
        );
        if (settled) return;
        worker = context.workerFactory
          ? context.workerFactory()
          : new Worker(context.workerUrl!, { type: "module" });
        if (settled) {
          worker.terminate();
          return;
        }
        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onError);
        worker.addEventListener("messageerror", onError);
        const request: ImportWorkerRequest = {
          type: "prepare-import",
          requestId: context.requestId,
          inputs: prepared,
          options,
        };
        worker.postMessage(
          request,
          prepared.map((input) => input.bytes.buffer as ArrayBuffer),
        );
      } catch (cause) {
        if (settled) return;
        if (context.signal?.aborted) onAbort();
        else
          fail(
            cause instanceof ImportFailure
              ? cause.code
              : "FILE_OR_WORKER_FAILED",
            cause instanceof ImportFailure
              ? cause.reason
              : "file-read-or-worker-transfer",
          );
      }
    })();
  });
}
