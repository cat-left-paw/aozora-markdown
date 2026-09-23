import type {
  ExportContext,
  ExportDiagnostic,
  ExportLimits,
  ExportMetrics,
  ExportStage,
} from "./types.js";
export const DEFAULT_EXPORT_LIMITS: Readonly<ExportLimits> = Object.freeze({
  maxFiles: 8192,
  maxFileBytes: 128 * 1048576,
  maxInputBytes: 128 * 1048576,
  maxPathBytes: 4096,
  maxOutputBytes: 192 * 1048576,
  jobTimeoutMs: 60000,
});
const ceilings: ExportLimits = {
  maxFiles: 65534,
  maxFileBytes: 0xfffffffe,
  maxInputBytes: 0xfffffffe,
  maxPathBytes: 65535,
  maxOutputBytes: 0xfffffffe,
  jobTimeoutMs: Number.MAX_SAFE_INTEGER,
};
export class ExportFailure extends Error {
  constructor(
    readonly code: string,
    readonly stage: ExportStage,
    readonly reason: string,
    readonly fileId?: string,
  ) {
    super(code);
  }
  diagnostic(): ExportDiagnostic {
    return {
      code: this.code,
      severity: "error",
      stage: this.stage,
      reason: this.reason,
      ...(this.fileId === undefined ? {} : { fileId: this.fileId }),
    };
  }
}
export function resolveExportLimits(
  overrides?: Partial<ExportLimits>,
): ExportLimits {
  if (
    overrides !== undefined &&
    (!overrides || typeof overrides !== "object" || Array.isArray(overrides))
  )
    throw new ExportFailure(
      "INVALID_LIMIT",
      "validate",
      "limits-object-required",
    );
  const limits = { ...DEFAULT_EXPORT_LIMITS };
  for (const key of Object.keys(limits) as (keyof ExportLimits)[]) {
    const value = overrides?.[key];
    if (value === undefined) continue;
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > ceilings[key]
    )
      throw new ExportFailure("INVALID_LIMIT", "validate", key);
    limits[key] = value;
  }
  return limits;
}
export function emptyExportMetrics(): ExportMetrics {
  return {
    selectedFiles: 0,
    inputBytes: 0,
    processedBytes: 0,
    copiedBytes: 0,
    outputBytes: 0,
    outputChunks: 0,
    retainedBytes: 0,
    peakRetainedBytes: 0,
    readyFiles: 0,
    entriesAdded: 0,
    writersStarted: 0,
    writersClosed: 0,
    writersAborted: 0,
  };
}
export function checkExportAbort(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new ExportFailure("CANCELLED", "package", "caller-cancelled");
}
export function reportProgress(
  context: ExportContext,
  stage: ExportStage,
  metrics: ExportMetrics,
): void {
  checkExportAbort(context.signal);
  try {
    context.onProgress?.({ stage, metrics: { ...metrics } });
  } catch {
    throw new ExportFailure("PROGRESS_FAILED", stage, "progress-callback");
  }
  checkExportAbort(context.signal);
}
export const yieldExport = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));
export const COPY_CHUNK_BYTES = 65536;
export async function copyExportBytes(
  bytes: Uint8Array,
  context: ExportContext,
  metrics: ExportMetrics,
  check: () => void = () => checkExportAbort(context.signal),
): Promise<Uint8Array<ArrayBuffer>> {
  check();
  const copy = new Uint8Array(bytes.byteLength);
  for (let offset = 0; offset < bytes.byteLength; offset += COPY_CHUNK_BYTES) {
    check();
    const end = Math.min(offset + COPY_CHUNK_BYTES, bytes.byteLength);
    copy.set(bytes.subarray(offset, end), offset);
    metrics.copiedBytes += end - offset;
    reportProgress(context, "copy", metrics);
    await yieldExport();
  }
  check();
  return copy;
}
