import { describe, expect, it } from "vitest";
import {
  runPreview,
  type PreviewRequestContext,
} from "../../web/preview/client.js";
import {
  PREVIEW_CONTRACT,
  PREVIEW_LIMITS,
} from "../../web/preview/protocol.js";

type Listener = (event: { data?: unknown; preventDefault(): void }) => void;
/** Fake Worker for race/shape tests. It never runs the parser. */
class FakeWorker {
  listeners = new Map<string, Set<Listener>>();
  posted: { message: unknown; transfer: unknown[] }[] = [];
  terminated = 0;
  addEventListener(type: string, fn: Listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: Listener) {
    this.listeners.get(type)?.delete(fn);
  }
  postMessage(message: unknown, transfer: unknown[]) {
    this.posted.push({ message, transfer });
  }
  terminate() {
    this.terminated++;
  }
  emit(type: string, data?: unknown) {
    let prevented = false;
    for (const fn of [...(this.listeners.get(type) ?? [])])
      fn({ data, preventDefault: () => (prevented = true) });
    return prevented;
  }
  get listening() {
    return [...this.listeners.values()].reduce((n, s) => n + s.size, 0);
  }
}
const okModel = {
  contract: PREVIEW_CONTRACT,
  frontmatter: null,
  body: [{ k: "p", c: [{ k: "text", v: "本文" }] }],
  notices: [],
};
function harness(extra: Partial<PreviewRequestContext> = {}) {
  const worker = new FakeWorker();
  const timers: { cb: () => void; ms: number; cleared: boolean }[] = [];
  const context: PreviewRequestContext = {
    requestId: "preview-1",
    generation: 7,
    workerFactory: () => worker as unknown as Worker,
    setTimer: (cb, ms) => {
      const t = { cb, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      (t as { cleared: boolean }).cleared = true;
    },
    ...extra,
  };
  return { worker, timers, context };
}
const reply = (outcome: unknown, over: Record<string, unknown> = {}) => ({
  contract: PREVIEW_CONTRACT,
  type: "result",
  requestId: "preview-1",
  generation: 7,
  outcome,
  ...over,
});
const bytes = () => new TextEncoder().encode("本文");

describe("S8-04 preview client (fake Worker)", () => {
  it("posts an owned transferred copy with version/requestId/generation", async () => {
    const { worker, timers, context } = harness();
    const source = bytes();
    const done = runPreview(source, context);
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(5000);
    const [{ message, transfer }] = worker.posted;
    const request = message as { bytes: Uint8Array } & Record<string, unknown>;
    expect(request).toMatchObject({
      contract: "aozora-preview-v1",
      type: "preview",
      requestId: "preview-1",
      generation: 7,
    });
    expect(request.bytes).not.toBe(source);
    expect(request.bytes.buffer).not.toBe(source.buffer);
    expect(transfer).toEqual([request.bytes.buffer]);
    expect(request.bytes).toEqual(source);
    worker.emit("message", reply({ status: "ok", model: okModel }));
    expect(await done).toEqual({
      status: "ok",
      model: okModel,
      nodes: 2,
      text: 2,
    });
    expect(worker.terminated).toBe(1);
    expect(worker.listening).toBe(0);
    expect(timers[0].cleared).toBe(true);
    expect(source.byteLength).toBe(6);
  });
  it("ignores other request ids; rejects bad generation/contract/shape", async () => {
    for (const [bad, expected] of [
      [
        reply({ status: "ok", model: okModel }, { generation: 6 }),
        "invalid-result",
      ],
      [
        reply({ status: "ok", model: okModel }, { contract: "x" }),
        "invalid-result",
      ],
      [
        reply({ status: "ok", model: okModel }, { type: "preview" }),
        "invalid-result",
      ],
      [reply({ status: "ok", model: "<p>x</p>" }), "invalid-result"],
      [reply({ status: "ok", model: okModel, html: "<b>" }), "invalid-result"],
      [reply({ status: "limit", reason: "memory" }), "invalid-result"],
      [
        reply({ status: "failed", reason: "worker-unavailable" }),
        "invalid-result",
      ],
      [reply({ status: "weird" }), "invalid-result"],
      [reply({ status: "failed", reason: "parse-failed" }), "parse-failed"],
      [reply({ status: "failed", reason: "invalid-utf8" }), "invalid-utf8"],
    ] as const) {
      const { worker, context } = harness();
      const done = runPreview(bytes(), context);
      worker.emit(
        "message",
        reply({ status: "ok", model: okModel }, { requestId: "preview-0" }),
      );
      worker.emit("message", "string");
      worker.emit("message", bad);
      expect(await done).toEqual({ status: "failed", reason: expected });
      expect(worker.terminated).toBe(1);
    }
  });
  it("limit outcomes and main-thread validation limits", async () => {
    const { worker, context } = harness();
    const done = runPreview(bytes(), context);
    worker.emit("message", reply({ status: "limit", reason: "depth" }));
    expect(await done).toEqual({ status: "limit", reason: "depth" });
    const second = harness();
    const again = runPreview(bytes(), second.context);
    const many = {
      ...okModel,
      body: Array.from({ length: PREVIEW_LIMITS.nodes + 1 }, () => ({
        k: "hr",
      })),
    };
    second.worker.emit("message", reply({ status: "ok", model: many }));
    expect(await again).toEqual({ status: "limit", reason: "nodes" });
  });
  it("injected timeout (fake timer) terminates the Worker", async () => {
    const { worker, timers, context } = harness();
    const done = runPreview(bytes(), context);
    timers[0].cb();
    expect(await done).toEqual({ status: "timeout" });
    expect(worker.terminated).toBe(1);
    worker.emit("message", reply({ status: "ok", model: okModel }));
    expect(worker.terminated).toBe(1);
  });
  it("error/messageerror events fail once and terminate", async () => {
    for (const type of ["error", "messageerror"]) {
      const { worker, context } = harness();
      const done = runPreview(bytes(), context);
      expect(worker.emit(type)).toBe(true);
      expect(await done).toEqual({ status: "failed", reason: "worker-failed" });
      expect(worker.terminated).toBe(1);
      expect(worker.listening).toBe(0);
    }
  });
  it("abort cancels, terminates and detaches", async () => {
    const abort = new AbortController();
    const { worker, timers, context } = harness({ signal: abort.signal });
    const done = runPreview(bytes(), context);
    abort.abort();
    expect(await done).toEqual({ status: "cancelled" });
    expect(worker.terminated).toBe(1);
    expect(worker.listening).toBe(0);
    expect(timers[0].cleared).toBe(true);
  });
  it("pre-aborted, oversize and missing Worker never post", async () => {
    let created = 0;
    const factory = () => {
      created++;
      return new FakeWorker() as unknown as Worker;
    };
    const abort = new AbortController();
    abort.abort();
    expect(
      await runPreview(bytes(), {
        ...harness().context,
        workerFactory: factory,
        signal: abort.signal,
      }),
    ).toEqual({ status: "cancelled" });
    const huge = new Uint8Array(PREVIEW_LIMITS.inputBytes + 1);
    expect(
      await runPreview(huge, { ...harness().context, workerFactory: factory }),
    ).toEqual({ status: "limit", reason: "input-bytes" });
    expect(created).toBe(0);
    expect(
      await runPreview(bytes(), {
        ...harness().context,
        workerFactory: () => {
          throw new Error("404");
        },
      }),
    ).toEqual({ status: "failed", reason: "worker-unavailable" });
    const { workerFactory: _, ...noWorker } = harness().context;
    expect(await runPreview(bytes(), noWorker)).toEqual({
      status: "failed",
      reason: "worker-unavailable",
    });
  });
  it("a factory that aborts synchronously still terminates", async () => {
    const abort = new AbortController();
    const worker = new FakeWorker();
    const done = runPreview(bytes(), {
      ...harness().context,
      signal: abort.signal,
      workerFactory: () => {
        abort.abort();
        return worker as unknown as Worker;
      },
    });
    expect(await done).toEqual({ status: "cancelled" });
    expect(worker.terminated).toBe(1);
    expect(worker.posted).toEqual([]);
  });
});
