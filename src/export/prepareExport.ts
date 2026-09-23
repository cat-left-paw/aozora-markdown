import {
  EXPORT_CONTRACT,
  type ExportArtifact,
  type ExportContext,
  type ExportOptions,
  type ExportResult,
} from "./types.js";
import {
  checkExportAbort,
  copyExportBytes,
  emptyExportMetrics,
  ExportFailure,
  reportProgress,
} from "./limits.js";
import { validateArtifacts } from "./validateArtifacts.js";
import { writeExportZip } from "./zipWriter.js";
export async function prepareExport(
  artifacts: readonly ExportArtifact[],
  options: ExportOptions,
  context: ExportContext = {},
): Promise<ExportResult> {
  const metrics = emptyExportMetrics();
  const base = {
    contract: EXPORT_CONTRACT,
    mode: options?.mode === "zip" ? ("zip" as const) : ("single" as const),
    manifest: [] as ExportResult["manifest"],
    diagnostics: [],
    metrics,
  };
  try {
    checkExportAbort(context.signal);
    const plan = validateArtifacts(artifacts, options, metrics);
    base.manifest = plan.manifest;
    reportProgress(context, "validate", metrics);
    const bytes =
      options.mode === "zip"
        ? await writeExportZip(artifacts, plan.limits, context, metrics)
        : await copyExportBytes(artifacts[0].bytes, context, metrics);
    if (options.mode === "single") {
      metrics.processedBytes = bytes.length;
      metrics.outputBytes = bytes.length;
      metrics.outputChunks = bytes.length ? 1 : 0;
      metrics.retainedBytes = metrics.peakRetainedBytes = bytes.length;
    }
    checkExportAbort(context.signal);
    metrics.readyFiles = artifacts.length;
    return {
      ...base,
      status: "ready",
      filename: plan.filename,
      mime: plan.mime,
      bytes,
    };
  } catch (cause) {
    const error = context.signal?.aborted
      ? new ExportFailure("CANCELLED", "package", "caller-cancelled")
      : cause instanceof ExportFailure
        ? cause
        : new ExportFailure(
            "EXPORT_FAILED",
            "package",
            "writer-or-buffer-failure",
          );
    metrics.retainedBytes = 0;
    metrics.readyFiles = 0;
    return {
      ...base,
      status: error.code === "CANCELLED" ? "cancelled" : "failed",
      diagnostics: [error.diagnostic()],
    };
  }
}
