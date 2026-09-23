import { validateModel, type PreviewModel } from "./model.js";
import {
  LIMIT_REASONS,
  PREVIEW_CONTRACT,
  PREVIEW_LIMITS,
  WORKER_FAILURE_REASONS,
  type PreviewLimitReason,
  type PreviewWorkerRequest,
} from "./protocol.js";

export type PreviewFailure =
  | "worker-unavailable"
  | "worker-failed"
  | "invalid-result"
  | "invalid-utf8"
  | "parse-failed";
export type PreviewOutcome =
  | { status: "ok"; model: PreviewModel; nodes: number; text: number }
  | { status: "limit"; reason: PreviewLimitReason }
  | { status: "failed"; reason: PreviewFailure }
  | { status: "timeout" }
  | { status: "cancelled" };
export interface PreviewRequestContext {
  requestId: string;
  generation: number;
  signal?: AbortSignal;
  workerUrl?: URL | string;
  workerFactory?: () => Worker;
  timeoutMs?: number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}
export type PreviewRunner = (
  bytes: Uint8Array,
  context: PreviewRequestContext,
) => Promise<PreviewOutcome>;

const own = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * One Worker per request. The borrowed artifact bytes are never transferred:
 * only an owned copy made after the size check. The watchdog covers Worker
 * start-up and parsing, and ends with terminate(); there is no main-thread
 * parsing fallback.
 */
export const runPreview: PreviewRunner = (bytes, context) =>
  new Promise((resolve) => {
    if (bytes.byteLength > PREVIEW_LIMITS.inputBytes) {
      resolve({ status: "limit", reason: "input-bytes" });
      return;
    }
    if (context.signal?.aborted) {
      resolve({ status: "cancelled" });
      return;
    }
    const setTimer =
      context.setTimer ?? ((cb: () => void, ms: number) => setTimeout(cb, ms));
    const clearTimer =
      context.clearTimer ??
      ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
    let settled = false,
      worker: Worker | undefined,
      timer: unknown;
    const cleanup = () => {
      if (timer !== undefined) clearTimer(timer);
      context.signal?.removeEventListener("abort", onAbort);
      if (worker) {
        worker.removeEventListener("message", onMessage);
        worker.removeEventListener("error", onError);
        worker.removeEventListener("messageerror", onError);
        worker.terminate();
      }
    };
    const finish = (outcome: PreviewOutcome) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(outcome);
    };
    function onAbort() {
      finish({ status: "cancelled" });
    }
    function onError(event: Event) {
      event.preventDefault();
      finish({ status: "failed", reason: "worker-failed" });
    }
    function onMessage(event: MessageEvent<unknown>) {
      const data = event.data;
      if (settled || !own(data) || data.requestId !== context.requestId) return;
      if (
        data.contract !== PREVIEW_CONTRACT ||
        data.type !== "result" ||
        data.generation !== context.generation ||
        !own(data.outcome)
      ) {
        finish({ status: "failed", reason: "invalid-result" });
        return;
      }
      const outcome = data.outcome;
      if (outcome.status === "ok" && Object.keys(outcome).length === 2) {
        const checked = validateModel(outcome.model);
        if (checked.ok)
          finish({
            status: "ok",
            model: checked.model,
            nodes: checked.nodes,
            text: checked.text,
          });
        else if (checked.kind === "limit")
          finish({ status: "limit", reason: checked.reason });
        else finish({ status: "failed", reason: "invalid-result" });
      } else if (
        outcome.status === "limit" &&
        (LIMIT_REASONS as readonly unknown[]).includes(outcome.reason)
      )
        finish({
          status: "limit",
          reason: outcome.reason as PreviewLimitReason,
        });
      else if (
        outcome.status === "failed" &&
        (WORKER_FAILURE_REASONS as readonly unknown[]).includes(outcome.reason)
      )
        finish({
          status: "failed",
          reason: outcome.reason as "invalid-utf8" | "parse-failed",
        });
      else finish({ status: "failed", reason: "invalid-result" });
    }
    context.signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimer(
      () => finish({ status: "timeout" }),
      context.timeoutMs ?? PREVIEW_LIMITS.timeoutMs,
    );
    try {
      if (!context.workerFactory && !context.workerUrl)
        throw Error("no-worker");
      worker = context.workerFactory
        ? context.workerFactory()
        : new Worker(context.workerUrl!, { type: "module" });
    } catch {
      finish({ status: "failed", reason: "worker-unavailable" });
      return;
    }
    // A factory may abort synchronously while constructing the Worker.
    if (settled) {
      worker.terminate();
      return;
    }
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.addEventListener("messageerror", onError);
    const copy = bytes.slice();
    const request: PreviewWorkerRequest = {
      contract: PREVIEW_CONTRACT,
      type: "preview",
      requestId: context.requestId,
      generation: context.generation,
      bytes: copy,
    };
    try {
      worker.postMessage(request, [copy.buffer]);
    } catch {
      finish({ status: "failed", reason: "worker-failed" });
    }
  });
