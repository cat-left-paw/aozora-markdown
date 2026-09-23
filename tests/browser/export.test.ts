import { afterEach, expect, it, vi } from "vitest";
import { prepareBrowserExport } from "../../src/adapters/browser/exportClient.js";
import { prepareExport, type ExportArtifact } from "../../src/export/index.js";
import type { ExportWorkerRequest } from "../../src/adapters/browser/exportProtocol.js";
const artifact = (): ExportArtifact => ({
  fileId: "one",
  relativePath: "著者/題.md",
  format: "md",
  bytes: new Uint8Array([0, 239, 187, 191, 10]),
});
class FakeWorker extends EventTarget {
  terminated = 0;
  request?: ExportWorkerRequest;
  transferred: ArrayBuffer[] = [];
  constructor(
    private respond: (
      request: ExportWorkerRequest,
      worker: FakeWorker,
    ) => void | Promise<void> = async (request, w) => {
      const result = await prepareExport(request.artifacts, request.options, {
        onProgress: (progress) =>
          w.emit({ type: "progress", requestId: request.requestId, progress }),
      });
      w.emit({ type: "result", requestId: request.requestId, result });
    },
  ) {
    super();
  }
  postMessage(request: ExportWorkerRequest, transfer: ArrayBuffer[]) {
    this.transferred = transfer;
    this.request = structuredClone(request, { transfer });
    void this.respond(this.request, this);
  }
  emit(data: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
  terminate() {
    this.terminated++;
  }
  asWorker() {
    return this as unknown as Worker;
  }
}
afterEach(() => vi.restoreAllMocks());
it("S3-01 bytes only, ignores stale Blob/conversion; preserves stats and caller buffer", async () => {
  const input = {
    ...artifact(),
    blob: new Blob(["stale"]),
    conversion: { text: "stale" },
  };
  const r = await prepareBrowserExport(
    [input],
    { mode: "single" },
    { requestId: "s" },
  );
  expect(r.status).toBe("ready");
  if (r.status === "ready")
    expect([...new Uint8Array(await r.blob.arrayBuffer())]).toEqual([
      ...input.bytes,
    ]);
  expect(input.bytes.length).toBe(5);
  expect(r).not.toHaveProperty("bytes");
});
it("preflight rejects before copy/worker/Blob and validates identity", async () => {
  const factory = vi.fn(),
    blob = vi.fn();
  for (const requestId of ["", " "])
    expect(
      (
        await prepareBrowserExport(
          [artifact()],
          { mode: "zip" },
          { requestId, workerFactory: factory, createBlob: blob },
        )
      ).diagnostics[0].code,
    ).toBe("INVALID_REQUEST_ID");
  const r = await prepareBrowserExport(
    [artifact(), { ...artifact(), fileId: "two", relativePath: "../bad.md" }],
    { mode: "zip" },
    { requestId: "bad", workerFactory: factory, createBlob: blob },
  );
  expect(r.status).toBe("failed");
  expect(r.metrics.copiedBytes).toBe(0);
  expect(factory).not.toHaveBeenCalled();
  expect(blob).not.toHaveBeenCalled();
});
it("owned snapshots project only fields; transfer never detaches input, worker closed", async () => {
  const input = {
      ...artifact(),
      conversion: { text: "never transferred" },
      blob: new Blob(["stale"]),
    },
    worker = new FakeWorker();
  const r = await prepareBrowserExport(
    [input],
    { mode: "zip" },
    { requestId: "zip", workerFactory: () => worker.asWorker() },
  );
  expect(r.status).toBe("ready");
  expect(worker.terminated).toBe(1);
  expect(Object.keys(worker.request!.artifacts[0]).sort()).toEqual([
    "bytes",
    "fileId",
    "format",
    "relativePath",
  ]);
  expect(worker.transferred[0].byteLength).toBe(0);
  expect(input.bytes.byteLength).toBe(5);
  expect(r.metrics.copiedBytes).toBe(5);
  expect(r.metrics.readyFiles).toBe(1);
});
it.each([
  "unavailable",
  "load",
  "message",
  "transfer",
  "factory",
  "blob",
] as const)("failure %s yields no Blob and permits retry", async (fault) => {
  const worker = new FakeWorker((_, w) => {
    if (fault === "load" || fault === "message")
      w.dispatchEvent(new Event(fault === "load" ? "error" : "messageerror"));
  });
  if (fault === "transfer")
    worker.postMessage = () => {
      throw Error("transfer");
    };
  const r = await prepareBrowserExport(
    [artifact()],
    { mode: fault === "blob" ? "single" : "zip" },
    {
      requestId: "fault",
      ...(fault === "unavailable"
        ? {}
        : {
            workerFactory: () => {
              if (fault === "factory") throw Error("factory");
              return worker.asWorker();
            },
          }),
      createBlob: () => {
        throw Error("blob");
      },
    },
  );
  expect(r.status).toBe("failed");
  expect(r).not.toHaveProperty("blob");
  expect(r.metrics.readyFiles).toBe(0);
  if (["load", "message", "transfer"].includes(fault))
    expect(worker.terminated).toBe(1);
  expect(
    (
      await prepareBrowserExport(
        [artifact()],
        { mode: "single" },
        { requestId: "retry" },
      )
    ).status,
  ).toBe("ready");
});
it.each([
  "contract",
  "status",
  "mode",
  "manifest",
  "filename",
  "mime",
  "bytes",
  "size",
  "metrics",
  "diagnostics",
  "failed-bytes",
] as const)("rejects malformed final %s before Blob", async (key) => {
  const makeBlob = vi.fn(
    (bytes: Uint8Array<ArrayBuffer>, mime: string) =>
      new Blob([bytes], { type: mime }),
  );
  const worker = new FakeWorker(async (req, w) => {
    const result = await prepareExport(req.artifacts, req.options);
    const damaged: Record<string, unknown> = { ...result };
    if (key === "contract") damaged.contract = "wrong";
    if (key === "status") damaged.status = "completed";
    if (key === "mode") damaged.mode = "single";
    if (key === "manifest")
      damaged.manifest = [{ ...result.manifest[0], relativePath: "wrong.md" }];
    if (key === "filename") damaged.filename = "wrong.zip";
    if (key === "mime") damaged.mime = "text/plain";
    if (key === "bytes") damaged.bytes = [1, 2, 3];
    if (key === "size") damaged.bytes = new Uint8Array(1);
    if (key === "metrics")
      damaged.metrics = { ...result.metrics, readyFiles: 999 };
    if (key === "diagnostics") damaged.diagnostics = [{}];
    if (key === "failed-bytes") damaged.status = "failed";
    w.emit({ type: "result", requestId: req.requestId, result: damaged });
  });
  const r = await prepareBrowserExport(
    [artifact()],
    { mode: "zip" },
    {
      requestId: "bad",
      workerFactory: () => worker.asWorker(),
      createBlob: makeBlob,
    },
  );
  expect(r.status).toBe("failed");
  expect(r.diagnostics[0].code).toBe("INVALID_WORKER_RESULT");
  expect(makeBlob).not.toHaveBeenCalled();
  expect(worker.terminated).toBe(1);
});
it("wrong request ID ignored, duplicate/late result ignored, callback throw cleanup", async () => {
  const makeBlob = vi.fn(
    (b: Uint8Array<ArrayBuffer>, m: string) => new Blob([b], { type: m }),
  );
  const worker = new FakeWorker(async (req, w) => {
    w.emit({ type: "result", requestId: "other", result: {} });
    const result = await prepareExport(req.artifacts, req.options);
    const response = { type: "result", requestId: req.requestId, result };
    w.emit(response);
    w.emit(response);
  });
  const r = await prepareBrowserExport(
    [artifact()],
    { mode: "zip" },
    {
      requestId: "right",
      workerFactory: () => worker.asWorker(),
      createBlob: makeBlob,
    },
  );
  expect(r.status).toBe("ready");
  expect(makeBlob).toHaveBeenCalledTimes(1);
  expect(worker.terminated).toBe(1);
  const next = new FakeWorker();
  const failed = await prepareBrowserExport(
    [artifact()],
    { mode: "zip" },
    {
      requestId: "callback",
      workerFactory: () => next.asWorker(),
      onProgress: (p) => {
        if (p.stage === "package") throw Error("callback");
      },
    },
  );
  expect(failed.status).toBe("failed");
  expect(failed.diagnostics[0].code).toBe("PROGRESS_FAILED");
  expect(next.terminated).toBe(1);
});
it("copy cancel and timeout, preabort, factory abort release", async () => {
  const input = { ...artifact(), bytes: new Uint8Array(200000) },
    controller = new AbortController(),
    factory = vi.fn();
  const r = await prepareBrowserExport(
    [input],
    { mode: "zip" },
    {
      requestId: "copy",
      workerFactory: factory,
      signal: controller.signal,
      onProgress: (p) => {
        if (p.stage === "copy") controller.abort();
      },
    },
  );
  expect(r.status).toBe("cancelled");
  expect(r.metrics.copiedBytes).toBe(65536);
  expect(factory).not.toHaveBeenCalled();
  expect(
    (
      await prepareBrowserExport(
        [input],
        { mode: "zip" },
        { requestId: "pre", workerFactory: factory, signal: controller.signal },
      )
    ).metrics.copiedBytes,
  ).toBe(0);
  const timeout = await prepareBrowserExport(
    [input],
    { mode: "zip", limits: { jobTimeoutMs: 1 } },
    { requestId: "timeout", workerFactory: factory },
  );
  expect(timeout.diagnostics[0].code).toBe("JOB_TIMEOUT");
  expect(timeout).not.toHaveProperty("blob");
  const abort = new AbortController(),
    worker = new FakeWorker();
  const aborted = await prepareBrowserExport(
    [artifact()],
    { mode: "zip" },
    {
      requestId: "factory-abort",
      signal: abort.signal,
      workerFactory: () => {
        abort.abort();
        return worker.asWorker();
      },
    },
  );
  expect(aborted.status).toBe("cancelled");
  expect(worker.terminated).toBe(1);
});
it("watchdog terminates stalled worker, late completion cannot resurrect, next job succeeds", async () => {
  const worker = new FakeWorker(() => {}),
    blob = vi.fn();
  const r = await prepareBrowserExport(
    [artifact()],
    { mode: "zip", limits: { jobTimeoutMs: 20 } },
    {
      requestId: "stalled",
      workerFactory: () => worker.asWorker(),
      createBlob: blob,
    },
  );
  expect(r.status).toBe("failed");
  expect(r.diagnostics[0].code).toBe("JOB_TIMEOUT");
  expect(worker.terminated).toBe(1);
  worker.emit({
    type: "result",
    requestId: "stalled",
    result: await prepareExport([artifact()], { mode: "zip" }),
  });
  expect(blob).not.toHaveBeenCalled();
  const good = new FakeWorker();
  expect(
    (
      await prepareBrowserExport(
        [artifact()],
        { mode: "zip" },
        { requestId: "retry", workerFactory: () => good.asWorker() },
      )
    ).status,
  ).toBe("ready");
});
it("parallel browser jobs do not share limits or lifecycle", async () => {
  const good = new FakeWorker(),
    bad = new FakeWorker();
  const results = await Promise.all([
    prepareBrowserExport(
      [artifact()],
      { mode: "zip" },
      { requestId: "good", workerFactory: () => good.asWorker() },
    ),
    prepareBrowserExport(
      [artifact()],
      { mode: "zip", limits: { maxOutputBytes: 1 } },
      { requestId: "bad", workerFactory: () => bad.asWorker() },
    ),
  ]);
  expect(results.map((r) => r.status)).toEqual(["ready", "failed"]);
  expect(good.terminated).toBe(1);
  expect(bad.terminated).toBe(1);
});
it("malformed progress fails before callback; all timer/listener resources released", async () => {
  const worker = new FakeWorker((req, w) =>
    w.emit({
      type: "progress",
      requestId: req.requestId,
      progress: { stage: "package", metrics: { selectedFiles: 100 } },
    }),
  );
  const remove = vi.spyOn(worker, "removeEventListener"),
    progress = vi.fn();
  const r = await prepareBrowserExport(
    [artifact()],
    { mode: "zip" },
    {
      requestId: "progress",
      workerFactory: () => worker.asWorker(),
      onProgress: progress,
    },
  );
  expect(r.status).toBe("failed");
  expect(r.diagnostics[0].code).toBe("INVALID_WORKER_RESULT");
  expect(remove.mock.calls.map((c) => c[0])).toEqual([
    "message",
    "error",
    "messageerror",
  ]);
  expect(worker.terminated).toBe(1);
  expect(progress.mock.calls.some(([p]) => p.stage === "package")).toBe(false);
});
it("deadline includes Blob construction and cleanup clears caller timer", async () => {
  const timers = vi.spyOn(globalThis, "clearTimeout");
  let clock = 0,
    reached = false;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  const r = await prepareBrowserExport(
    [artifact()],
    { mode: "single", limits: { jobTimeoutMs: 20 } },
    {
      requestId: "blob-timeout",
      createBlob: (bytes, mime) => {
        reached = true;
        clock = 20;
        return new Blob([bytes], { type: mime });
      },
    },
  );
  expect(r.status).toBe("failed");
  expect(reached).toBe(true);
  expect(r.diagnostics[0].code).toBe("JOB_TIMEOUT");
  expect(r).not.toHaveProperty("blob");
  expect(timers).toHaveBeenCalled();
});
