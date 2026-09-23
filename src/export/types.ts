export const EXPORT_CONTRACT = "aozora-export-v1" as const;
export interface ExportArtifact {
  readonly fileId: string;
  readonly relativePath: string;
  readonly format: "md" | "txt";
  readonly bytes: Uint8Array;
}
export interface ExportLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxInputBytes: number;
  maxPathBytes: number;
  maxOutputBytes: number;
  jobTimeoutMs: number;
}
export type ExportMode = "single" | "zip";
export type ExportOptions = {
  limits?: Partial<ExportLimits>;
} & (
  | { mode: "single"; archiveName?: never }
  | { mode: "zip"; archiveName?: string }
);
export type ExportStage =
  | "validate"
  | "copy"
  | "package"
  | "close"
  | "delivery"
  | "download";
export interface ExportDiagnostic {
  code: string;
  severity: "error";
  stage: ExportStage;
  fileId?: string;
  reason: string;
}
export interface ExportManifestEntry {
  readonly fileId: string;
  readonly relativePath: string;
  readonly format: "md" | "txt";
  readonly byteLength: number;
}
export interface ExportMetrics {
  selectedFiles: number;
  inputBytes: number;
  processedBytes: number;
  copiedBytes: number;
  outputBytes: number;
  outputChunks: number;
  retainedBytes: number;
  peakRetainedBytes: number;
  readyFiles: number;
  entriesAdded: number;
  writersStarted: number;
  writersClosed: number;
  writersAborted: number;
}
export interface ExportProgress {
  stage: ExportStage;
  metrics: Readonly<ExportMetrics>;
}
export interface ExportContext {
  signal?: AbortSignal;
  onProgress?: (progress: ExportProgress) => void;
}
export interface ExportResultBase {
  contract: typeof EXPORT_CONTRACT;
  mode: ExportMode;
  manifest: readonly ExportManifestEntry[];
  diagnostics: readonly ExportDiagnostic[];
  metrics: ExportMetrics;
}
export type ExportResult = ExportResultBase &
  (
    | {
        status: "ready";
        filename: string;
        mime: string;
        bytes: Uint8Array<ArrayBuffer>;
      }
    | { status: "failed" | "cancelled" }
  );
