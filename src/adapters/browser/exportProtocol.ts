import {
  EXPORT_CONTRACT,
  type ExportArtifact,
  type ExportOptions,
  type ExportResult,
  type ExportMetrics,
  type ExportProgress,
} from "../../export/types.js";
import { emptyExportMetrics } from "../../export/limits.js";
import type { ExportPlan } from "../../export/validateArtifacts.js";
export interface ExportWorkerRequest {
  type: "prepare-export";
  requestId: string;
  artifacts: ExportArtifact[];
  options: ExportOptions;
}
export type ExportWorkerResponse =
  | { type: "result"; requestId: string; result: ExportResult }
  | { type: "progress"; requestId: string; progress: ExportProgress }
  | { type: "failure"; requestId: string };
export const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object";
export function validMetrics(v: unknown): v is ExportMetrics {
  return (
    record(v) &&
    Object.keys(v).length === Object.keys(emptyExportMetrics()).length &&
    Object.keys(emptyExportMetrics()).every(
      (k) =>
        typeof v[k] === "number" && Number.isSafeInteger(v[k]) && v[k] >= 0,
    )
  );
}
export function validWorkerResult(
  v: unknown,
  plan: ExportPlan,
): v is ExportResult {
  if (
    !record(v) ||
    v.contract !== EXPORT_CONTRACT ||
    v.mode !== "zip" ||
    typeof v.status !== "string" ||
    !["ready", "failed", "cancelled"].includes(v.status) ||
    !Array.isArray(v.manifest) ||
    !Array.isArray(v.diagnostics) ||
    !validMetrics(v.metrics)
  )
    return false;
  if (
    v.manifest.length !== plan.manifest.length ||
    !v.manifest.every(
      (e: unknown, i: number) =>
        record(e) &&
        Object.keys(e).length === 4 &&
        e.fileId === plan.manifest[i].fileId &&
        e.relativePath === plan.manifest[i].relativePath &&
        e.format === plan.manifest[i].format &&
        e.byteLength === plan.manifest[i].byteLength,
    )
  )
    return false;
  if (
    !v.diagnostics.every(
      (d: unknown) =>
        record(d) &&
        typeof d.code === "string" &&
        d.severity === "error" &&
        typeof d.stage === "string" &&
        ["validate", "copy", "package", "close", "delivery"].includes(
          d.stage,
        ) &&
        typeof d.reason === "string" &&
        Object.keys(d).every((k) =>
          ["code", "severity", "stage", "reason", "fileId"].includes(k),
        ) &&
        (d.fileId === undefined || typeof d.fileId === "string"),
    )
  )
    return false;
  const input = plan.manifest.reduce((n, e) => n + e.byteLength, 0),
    m = v.metrics;
  if (
    m.selectedFiles !== plan.manifest.length ||
    m.inputBytes !== input ||
    m.processedBytes > input ||
    m.copiedBytes !== 0 ||
    m.entriesAdded > plan.manifest.length ||
    m.retainedBytes > plan.limits.maxOutputBytes ||
    m.peakRetainedBytes > plan.limits.maxOutputBytes ||
    m.retainedBytes > m.peakRetainedBytes
  )
    return false;
  if (v.status !== "ready")
    return (
      !("bytes" in v) &&
      !("filename" in v) &&
      !("mime" in v) &&
      m.readyFiles === 0 &&
      m.retainedBytes === 0 &&
      v.diagnostics.length > 0
    );
  return (
    v.filename === plan.filename &&
    v.mime === plan.mime &&
    v.diagnostics.length === 0 &&
    v.bytes instanceof Uint8Array &&
    v.bytes.buffer instanceof ArrayBuffer &&
    v.bytes.length > 0 &&
    v.bytes.length <= plan.limits.maxOutputBytes &&
    v.bytes.length === m.outputBytes &&
    v.bytes.length === m.retainedBytes &&
    m.readyFiles === plan.manifest.length &&
    m.processedBytes === input &&
    m.entriesAdded === plan.manifest.length &&
    m.writersStarted === 1 &&
    m.writersClosed === 1 &&
    m.writersAborted === 0
  );
}
