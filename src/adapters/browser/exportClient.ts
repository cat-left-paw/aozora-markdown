import {
  EXPORT_CONTRACT,
  type ExportArtifact,
  type ExportOptions,
  type ExportContext,
  type ExportResultBase,
  type ExportMetrics,
} from "../../export/types.js";
import {
  checkExportAbort,
  copyExportBytes,
  emptyExportMetrics,
  ExportFailure,
  reportProgress,
} from "../../export/limits.js";
import {
  validateArtifacts,
  type ExportPlan,
} from "../../export/validateArtifacts.js";
import {
  record,
  validMetrics,
  validWorkerResult,
  type ExportWorkerRequest,
} from "./exportProtocol.js";
export interface BrowserExportContext extends ExportContext {
  requestId: string;
  workerFactory?: () => Worker;
  workerUrl?: string | URL;
  createBlob?: (bytes: Uint8Array<ArrayBuffer>, mime: string) => Blob;
}
export type BrowserExportResult = ExportResultBase &
  (
    | { status: "ready"; filename: string; mime: string; blob: Blob }
    | { status: "failed" | "cancelled" }
  );
export function prepareBrowserExport(
  artifacts: readonly ExportArtifact[],
  options: ExportOptions,
  context: BrowserExportContext,
): Promise<BrowserExportResult> {
  return new Promise((resolve) => {
    const startedAt = performance.now(),
      controller = new AbortController();
    let settled = false,
      worker: Worker | undefined,
      timer: ReturnType<typeof setTimeout> | undefined;
    let plan: ExportPlan | undefined,
      metrics = emptyExportMetrics(),
      copied = 0;
    const mode = options?.mode === "zip" ? "zip" : "single";
    const base = (): ExportResultBase => ({
      contract: EXPORT_CONTRACT,
      mode,
      manifest: plan?.manifest ?? [],
      diagnostics: [],
      metrics: { ...metrics },
    });
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      context.signal?.removeEventListener("abort", onAbort);
      controller.abort();
      if (worker) {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        worker.removeEventListener("messageerror", onError);
        worker.terminate();
      }
    };
    const finish = (result: BrowserExportResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const fail = (cause: unknown) => {
      if (settled) return;
      const error = context.signal?.aborted
        ? new ExportFailure("CANCELLED", "delivery", "caller-cancelled")
        : cause instanceof ExportFailure
          ? cause
          : new ExportFailure(
              "DELIVERY_FAILED",
              "delivery",
              "worker-copy-or-transfer-failure",
            );
      metrics.readyFiles = 0;
      metrics.retainedBytes = 0;
      finish({
        ...base(),
        status: error.code === "CANCELLED" ? "cancelled" : "failed",
        diagnostics: [error.diagnostic()],
      });
    };
    function check() {
      checkExportAbort(context.signal);
      checkExportAbort(controller.signal);
      if (plan && performance.now() - startedAt >= plan.limits.jobTimeoutMs)
        throw new ExportFailure("JOB_TIMEOUT", "delivery", "caller-watchdog");
    }
    function onAbort() {
      fail(new ExportFailure("CANCELLED", "delivery", "caller-cancelled"));
    }
    function onError(event: Event) {
      event.preventDefault();
      fail(
        new ExportFailure(
          "WORKER_FAILED",
          "delivery",
          "worker-load-or-message",
        ),
      );
    }
    function deliver(bytes: Uint8Array<ArrayBuffer>) {
      check();
      reportProgress(
        { signal: context.signal, onProgress: context.onProgress },
        "delivery",
        metrics,
      );
      check();
      let blob: Blob;
      try {
        blob = context.createBlob
          ? context.createBlob(bytes, plan!.mime)
          : new Blob([bytes], { type: plan!.mime });
        if (
          !(blob instanceof Blob) ||
          blob.size !== bytes.byteLength ||
          blob.type !== plan!.mime
        )
          throw Error("invalid-blob");
      } catch {
        throw new ExportFailure("BLOB_FAILED", "delivery", "blob-construction");
      }
      check();
      metrics.readyFiles = artifacts.length;
      finish({
        ...base(),
        status: "ready",
        filename: plan!.filename,
        mime: plan!.mime,
        blob,
      });
    }
    function onMessage(event: MessageEvent<unknown>) {
      if (
        settled ||
        !record(event.data) ||
        event.data.requestId !== context.requestId
      )
        return;
      try {
        check();
        const message = event.data;
        if (message.type === "progress") {
          if (
            !record(message.progress) ||
            !validMetrics(message.progress.metrics) ||
            typeof message.progress.stage !== "string" ||
            !["validate", "package", "close"].includes(message.progress.stage)
          )
            throw new ExportFailure(
              "INVALID_WORKER_RESULT",
              "delivery",
              "invalid-progress",
            );
          const observed = message.progress.metrics;
          if (
            !plan ||
            observed.selectedFiles !== artifacts.length ||
            observed.inputBytes !== metrics.inputBytes ||
            observed.processedBytes > metrics.inputBytes ||
            observed.processedBytes < metrics.processedBytes ||
            observed.copiedBytes !== 0 ||
            observed.readyFiles !== 0 ||
            observed.outputBytes > plan.limits.maxOutputBytes ||
            observed.retainedBytes > observed.peakRetainedBytes ||
            observed.peakRetainedBytes > plan.limits.maxOutputBytes ||
            observed.entriesAdded > artifacts.length
          )
            throw new ExportFailure(
              "INVALID_WORKER_RESULT",
              "delivery",
              "invalid-progress-budget",
            );
          metrics = {
            ...message.progress.metrics,
            copiedBytes: copied + message.progress.metrics.copiedBytes,
          };
          reportProgress(
            context,
            message.progress.stage as "validate" | "package" | "close",
            metrics,
          );
        } else if (message.type === "result") {
          if (!plan || !validWorkerResult(message.result, plan))
            throw new ExportFailure(
              "INVALID_WORKER_RESULT",
              "delivery",
              "invalid-result-contract",
            );
          const result = message.result;
          metrics = {
            ...result.metrics,
            copiedBytes: copied + result.metrics.copiedBytes,
            readyFiles: 0,
          };
          if (result.status === "ready") deliver(result.bytes);
          else
            finish({
              ...base(),
              status: result.status,
              diagnostics: result.diagnostics,
            });
        } else
          throw new ExportFailure(
            "WORKER_FAILED",
            "delivery",
            "worker-protocol-or-transfer",
          );
      } catch (cause) {
        fail(cause);
      }
    }
    const arm = () => {
      const left = plan!.limits.jobTimeoutMs - (performance.now() - startedAt);
      if (left <= 0) {
        fail(new ExportFailure("JOB_TIMEOUT", "delivery", "caller-watchdog"));
        return;
      }
      timer = setTimeout(arm, Math.min(left, 2147483647));
    };
    context.signal?.addEventListener("abort", onAbort, { once: true });
    void (async () => {
      try {
        check();
        if (typeof context.requestId !== "string" || !context.requestId.trim())
          throw new ExportFailure(
            "INVALID_REQUEST_ID",
            "validate",
            "nonempty-request-id-required",
          );
        plan = validateArtifacts(artifacts, options, metrics);
        check();
        arm();
        reportProgress(context, "validate", metrics);
        check();
        if (
          mode === "zip" &&
          !context.workerFactory &&
          (!context.workerUrl || typeof Worker === "undefined")
        )
          throw new ExportFailure(
            "WORKER_UNAVAILABLE",
            "delivery",
            "owned-module-worker-required",
          );
        const snapshots: ExportArtifact[] = [];
        const copyContext = {
          signal: controller.signal,
          onProgress: context.onProgress,
        };
        for (const a of artifacts) {
          const bytes = await copyExportBytes(
            a.bytes,
            copyContext,
            metrics,
            check,
          );
          snapshots.push({
            fileId: a.fileId,
            relativePath: a.relativePath,
            format: a.format,
            bytes,
          });
        }
        copied = metrics.copiedBytes;
        check();
        if (mode === "single") {
          const bytes = snapshots[0].bytes as Uint8Array<ArrayBuffer>;
          metrics.processedBytes =
            metrics.outputBytes =
            metrics.retainedBytes =
            metrics.peakRetainedBytes =
              bytes.length;
          metrics.outputChunks = bytes.length ? 1 : 0;
          deliver(bytes);
          return;
        }
        worker = context.workerFactory
          ? context.workerFactory()
          : new Worker(context.workerUrl!, { type: "module" });
        // A factory may synchronously abort while constructing the Worker.
        if (settled) {
          worker.terminate();
          return;
        }
        check();
        worker.addEventListener("message", onMessage);
        worker.addEventListener("error", onError);
        worker.addEventListener("messageerror", onError);
        const request: ExportWorkerRequest = {
          type: "prepare-export",
          requestId: context.requestId,
          artifacts: snapshots,
          options,
        };
        worker.postMessage(
          request,
          snapshots.map((a) => a.bytes.buffer as ArrayBuffer),
        );
      } catch (cause) {
        fail(cause);
      }
    })();
  });
}
