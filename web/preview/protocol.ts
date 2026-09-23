import type { PreviewModel } from "./model.js";

export const PREVIEW_CONTRACT = "aozora-preview-v1";

/** Display-processing budgets. They do not bound heap usage. */
export const PREVIEW_LIMITS = Object.freeze({
  inputBytes: 4 * 1048576,
  nodes: 20000,
  depth: 64,
  textUnits: 2 * 1048576,
  timeoutMs: 5000,
  sourceWindowBytes: 128 * 1024,
});
export type PreviewLimitReason = "input-bytes" | "nodes" | "depth" | "text";
export const LIMIT_REASONS: readonly PreviewLimitReason[] = [
  "input-bytes",
  "nodes",
  "depth",
  "text",
];
export type WorkerFailureReason = "invalid-utf8" | "parse-failed";
export const WORKER_FAILURE_REASONS: readonly WorkerFailureReason[] = [
  "invalid-utf8",
  "parse-failed",
];

export interface PreviewWorkerRequest {
  contract: typeof PREVIEW_CONTRACT;
  type: "preview";
  requestId: string;
  generation: number;
  bytes: Uint8Array;
}
export type PreviewWorkerOutcome =
  | { status: "ok"; model: PreviewModel }
  | { status: "limit"; reason: PreviewLimitReason }
  | { status: "failed"; reason: WorkerFailureReason };
export interface PreviewWorkerResponse {
  contract: typeof PREVIEW_CONTRACT;
  type: "result";
  requestId: string;
  generation: number;
  outcome: PreviewWorkerOutcome;
}
