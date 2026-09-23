import type { ConversionOptions, ConversionResult } from "../core/types.js";
import type { Encoding } from "../encoding/index.js";
export interface ImportInput {
  readonly id: string;
  readonly name: string;
  readonly kind: "txt" | "md" | "zip";
  /** Borrowed bytes: never mutated or detached by prepareImport. */
  readonly bytes: Uint8Array;
}
export interface ImportLimits {
  sources: number;
  inputBytes: number;
  totalInputBytes: number;
  archiveEntries: number;
  totalEntries: number;
  filenameBytes: number;
  textBytes: number;
  declaredBytes: number;
  expandedBytes: number;
  outputBytes: number;
  jobTimeoutMs: number;
}
export type OutputExtension = "md" | "txt";
export interface ImportOptions {
  /** Content settings; identical for every input kind and output extension. */
  conversion?: ConversionOptions;
  /** Artifact format, filename extension and MIME only. Default `md`. */
  outputExtension?: OutputExtension;
  encoding?: Encoding | "auto";
  organizeByAuthor?: boolean;
  limits?: Partial<ImportLimits>;
}
export interface ImportProgress {
  stage: "enumerating" | "reading" | "converting" | "converted";
  inputId: string;
  entryIndex?: number;
  /** Snapshot, never a commit. */
  metrics: ImportMetrics;
}
export interface ImportContext {
  signal?: AbortSignal;
  onProgress?: (progress: ImportProgress) => void;
}
export interface ImportDiagnostic {
  code: string;
  severity: "warning" | "error";
  stage:
    | "input"
    | "metadata"
    | "structure"
    | "read"
    | "decode"
    | "convert"
    | "output"
    | "delivery";
  inputId: string;
  entryIndex?: number;
  reason: string;
}
export interface SourceIdentity {
  inputId: string;
  entryIndex?: number;
}
export interface ZipNameAudit {
  rawBytes: Uint8Array;
  basicName?: string;
  adoptedName?: string;
  flags: number;
  entryIndex: number;
  offset: number;
  compressedBytes: number;
  declaredBytes: number;
  unixMode?: number;
}
export interface ImportOutcome extends SourceIdentity {
  fileId: string;
  kind: "txt" | "md" | "zip" | "ignored";
  status:
    | "prepared"
    | "failed"
    | "ignored"
    | "empty"
    | "discarded"
    | "cancelled";
  reason?: string;
  zipName?: ZipNameAudit;
}
export interface PreparedArtifact {
  fileId: string;
  source: SourceIdentity;
  relativePath: string;
  bytes: Uint8Array;
  format: OutputExtension;
  conversion: ConversionResult;
  decoded: { encoding: Encoding; bom: boolean };
}
export interface ImportMetrics {
  sourceCount: number;
  reservedInputBytes: number;
  inputBytes: number;
  zipEntries: number;
  declaredBytes: number;
  /** Bytes offered to our writer, including a rejected over-limit chunk. */
  expandedBytes: number;
  compressedBytesRead: number;
  retainedExpandedBytes: number;
  rejectedChunks: number;
  outputBytes: number;
  conversions: number;
  payloadReads: number;
  readersOpened: number;
  readersClosed: number;
  payloadStreamsClosed: number;
  payloadStreamsAborted: number;
}
export interface ImportResult {
  contract: "aozora-import-v2";
  status: "completed" | "partial" | "failed" | "cancelled";
  artifacts: PreparedArtifact[];
  outcomes: ImportOutcome[];
  diagnostics: ImportDiagnostic[];
  metrics: ImportMetrics;
}
