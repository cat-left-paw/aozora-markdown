import { it, expect, vi } from "vitest";
import {
  importFiles,
  type BrowserImportContext,
} from "../../src/adapters/browser/index.js";
import { prepareImport, type ImportResult } from "../../src/import/index.js";
import { reduceJobStats } from "../../src/policies/jobStats.js";
import { browserJobStats } from "../../src/adapters/browser/jobStats.js";
import type {
  ImportWorkerRequest,
  ImportWorkerResponse,
} from "../../src/adapters/browser/workerProtocol.js";
class FakeWorker extends EventTarget {
  terminated = 0;
  listeners = 0;
  request?: ImportWorkerRequest;
  respond?: (request: ImportWorkerRequest) => void;
  override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ) {
    super.addEventListener(type, callback, options);
    this.listeners++;
  }
  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ) {
    super.removeEventListener(type, callback, options);
    this.listeners--;
  }
  postMessage(request: ImportWorkerRequest) {
    this.request = request;
    this.respond?.(request);
  }
  terminate() {
    this.terminated++;
  }
  send(message: ImportWorkerResponse) {
    this.dispatchEvent(new MessageEvent("message", { data: message }));
  }
  asWorker() {
    return this as unknown as Worker;
  }
}
const file = () => ({ id: "id", file: new File(["青［＃未対応］"], "x.txt") });
const options = {
  conversion: { addFrontmatter: false, removeAnnotationBlocks: false },
};
const ctx = (
  worker: FakeWorker,
  extra: Partial<BrowserImportContext> = {},
): BrowserImportContext => ({
  requestId: "request",
  attemptId: "attempt",
  workerFactory: () => worker.asWorker(),
  ...extra,
});
async function success(worker: FakeWorker) {
  worker.respond = (request) => {
    void prepareImport(request.inputs, request.options).then((result) =>
      worker.send({ type: "result", requestId: request.requestId, result }),
    );
  };
}
it("all Blob objects before any success commit; duplicates and late completion inert", async () => {
  const w = new FakeWorker();
  await success(w);
  let blobs = 0;
  const result = await importFiles(
    [file()],
    options,
    ctx(w, {
      createBlob: (b) => {
        blobs++;
        return new Blob([b]);
      },
    }),
  );
  expect(blobs).toBe(1);
  expect(result.stats).toMatchObject({
    artifactFiles: 1,
    savedFiles: 0,
    remainingNotes: 1,
  });
  expect(w.listeners).toBe(0);
  expect(w.terminated).toBe(1);
  w.send({ type: "result", requestId: "request", result: result.result });
  expect(result.stats.artifactFiles).toBe(1);
  expect(w.terminated).toBe(1);
});
it("wrong request ID ignored; duplicate completion settles once", async () => {
  const w = new FakeWorker();
  w.respond = (request) => {
    void prepareImport(request.inputs, request.options).then((result) => {
      w.send({ type: "result", requestId: "wrong", result });
      expect(w.terminated).toBe(0);
      w.send({ type: "result", requestId: request.requestId, result });
      w.send({ type: "result", requestId: request.requestId, result });
    });
  };
  expect(
    (await importFiles([file()], options, ctx(w))).stats.artifactFiles,
  ).toBe(1);
  expect(w.terminated).toBe(1);
});
it("Blob failure on second artifact leaves zero success/remaining counts", async () => {
  const w = new FakeWorker();
  await success(w);
  let count = 0;
  const r = await importFiles(
    [file(), { ...file(), id: "two" }],
    options,
    ctx(w, {
      createBlob: (b) => {
        if (++count === 2) throw Error("construction");
        return new Blob([b]);
      },
    }),
  );
  expect(r.result.artifacts).toEqual([]);
  expect(r.artifacts).toEqual([]);
  expect(r.stats).toMatchObject({
    filesConverted: 0,
    artifactFiles: 0,
    savedFiles: 0,
    remainingNotes: 0,
    errors: 2,
  });
  expect(w.terminated).toBe(1);
});
it.each(["error", "messageerror"])(
  "worker %s closes and has zero commits",
  async (event) => {
    const w = new FakeWorker();
    w.respond = () => {
      w.dispatchEvent(new Event(event));
    };
    const r = await importFiles([file()], options, ctx(w));
    expect(r.result.status).toBe("failed");
    expect(r.stats.artifactFiles).toBe(0);
    expect(w.listeners).toBe(0);
    expect(w.terminated).toBe(1);
  },
);
it("transfer failure is a failed delivery", async () => {
  const w = new FakeWorker();
  w.respond = () => {
    throw Error("transfer");
  };
  const r = await importFiles([file()], options, ctx(w));
  expect(r.result.status).toBe("failed");
  expect(r.stats.artifactFiles).toBe(0);
  expect(w.terminated).toBe(1);
});
it("cancel twice, ignore late success, then start a fresh job", async () => {
  const w = new FakeWorker(),
    abort = new AbortController();
  w.respond = () => {
    abort.abort();
    abort.abort();
  };
  const r = await importFiles(
    [file()],
    options,
    ctx(w, { signal: abort.signal }),
  );
  expect(r.result.status).toBe("cancelled");
  expect(r.stats.cancelledFiles).toBe(1);
  expect(w.terminated).toBe(1);
  const w2 = new FakeWorker();
  await success(w2);
  expect((await importFiles([file()], options, ctx(w2))).result.status).toBe(
    "completed",
  );
});
it("timer cancels a silent Worker and listeners are removed", async () => {
  const w = new FakeWorker();
  const r = await importFiles(
    [file()],
    { ...options, limits: { jobTimeoutMs: 5 } },
    ctx(w),
  );
  expect(r.result.diagnostics.at(-1)?.code).toBe("JOB_TIMEOUT");
  expect(r.stats.filesConverted).toBe(0);
  expect(w.terminated).toBe(1);
  expect(w.listeners).toBe(0);
});
it("preflight reserves every File before the first read", async () => {
  const one = file(),
    two = { ...file(), id: "two" };
  const read = vi.spyOn(one.file, "arrayBuffer");
  const w = new FakeWorker();
  const r = await importFiles(
    [one, two],
    { limits: { totalInputBytes: one.file.size * 2 - 1 } },
    ctx(w),
  );
  expect(r.result.status).toBe("failed");
  expect(read).not.toHaveBeenCalled();
  expect(w.request).toBeUndefined();
});
it("actual File bytes checked against reservation and per input limit", async () => {
  const one = file();
  vi.spyOn(one.file, "arrayBuffer").mockResolvedValue(new ArrayBuffer(1));
  const w = new FakeWorker();
  const r = await importFiles([one], options, ctx(w));
  expect(r.result.diagnostics[0].code).toBe("FILE_SIZE_MISMATCH");
  expect(w.request).toBeUndefined();
});
it("abort during File read settles promptly without spawning Worker", async () => {
  const one = file();
  let release!: (b: ArrayBuffer) => void;
  vi.spyOn(one.file, "arrayBuffer").mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const w = new FakeWorker(),
    abort = new AbortController();
  const pending = importFiles([one], options, ctx(w, { signal: abort.signal }));
  abort.abort();
  const r = await pending;
  release(new ArrayBuffer(one.file.size));
  await new Promise((r) => setTimeout(r, 0));
  expect(r.result.status).toBe("cancelled");
  expect(w.request).toBeUndefined();
});
it("missing worker support never falls back to main-thread conversion", async () => {
  const r = await importFiles([file()], options, {
    requestId: "r",
    attemptId: "a",
  });
  expect(r.result.diagnostics[0].code).toBe("WORKER_UNAVAILABLE");
  expect(r.stats.filesConverted).toBe(0);
});
it("reducer attempt identity and input-unit error/cancel/entry skip counting", async () => {
  const result = await prepareImport(
    [
      {
        id: "id",
        kind: "txt",
        name: "a.txt",
        bytes: new TextEncoder().encode("青［＃未対応］"),
      },
    ],
    options,
  );
  const first = browserJobStats(result, "one", true),
    artifact = result.artifacts[0];
  expect(
    reduceJobStats(first, {
      type: "WriteCommitted",
      fileId: artifact.fileId,
      attemptId: "two",
      result: artifact.conversion,
      delivery: "browser-artifact",
    }).filesConverted,
  ).toBe(1);
  const failure: ImportResult = {
    ...result,
    status: "failed",
    artifacts: [],
    outcomes: [
      { fileId: "zip", inputId: "zip", kind: "zip", status: "failed" },
    ],
  };
  const stats = browserJobStats(failure, "one", false);
  expect(
    reduceJobStats(stats, {
      type: "ArchiveFailed",
      fileId: "zip",
      attemptId: "one",
      error: "error",
    }).errors,
  ).toBe(1);
  expect(
    reduceJobStats(stats, {
      type: "ArchiveFailed",
      fileId: "zip",
      attemptId: "two",
      error: "error",
    }).errors,
  ).toBe(2);
});
it("malformed completion settles as failure without reviving artifacts", async () => {
  const w = new FakeWorker();
  w.respond = (r) =>
    w.send({
      type: "result",
      requestId: r.requestId,
      result: null,
    } as unknown as ImportWorkerResponse);
  const result = await importFiles([file()], options, ctx(w));
  expect(result.result.diagnostics[0].code).toBe("INVALID_WORKER_RESULT");
  expect(w.terminated).toBe(1);
});
it("abort reentered during worker factory still terminates the created Worker", async () => {
  const w = new FakeWorker(),
    abort = new AbortController();
  const r = await importFiles(
    [file()],
    options,
    ctx(w, {
      signal: abort.signal,
      workerFactory: () => {
        abort.abort();
        return w.asWorker();
      },
    }),
  );
  expect(r.result.status).toBe("cancelled");
  expect(w.terminated).toBe(1);
  expect(w.listeners).toBe(0);
});
it("safe integer timeout above 32-bit range does not overflow into immediate timeout", async () => {
  const w = new FakeWorker();
  w.respond = (request) => {
    setTimeout(() => {
      void prepareImport(request.inputs, request.options).then((result) =>
        w.send({ type: "result", requestId: request.requestId, result }),
      );
    }, 10);
  };
  const r = await importFiles(
    [file()],
    { ...options, limits: { jobTimeoutMs: 2147483648 } },
    ctx(w),
  );
  expect(r.result.status).toBe("completed");
});
it("cancel reentered by a Blob factory publishes no success", async () => {
  const w = new FakeWorker();
  await success(w);
  const control = new AbortController();
  const r = await importFiles(
    [file()],
    options,
    ctx(w, {
      signal: control.signal,
      createBlob: (b) => {
        control.abort();
        return new Blob([b]);
      },
    }),
  );
  expect(r.result.status).toBe("cancelled");
  expect(r.artifacts).toEqual([]);
  expect(r.stats.remainingNotes).toBe(0);
  expect(w.terminated).toBe(1);
});
it("invalid conversion payload cannot leave the terminal promise unsettled", async () => {
  const w = new FakeWorker();
  w.respond = (request) => {
    void prepareImport(request.inputs, request.options).then((result) => {
      delete (
        result.artifacts[0].conversion as Partial<
          (typeof result.artifacts)[0]["conversion"]
        >
      ).remainingNotes;
      w.send({ type: "result", requestId: request.requestId, result });
    });
  };
  const r = await importFiles(
    [file()],
    { ...options, limits: { jobTimeoutMs: 100 } },
    ctx(w),
  );
  expect(r.result.status).toBe("failed");
  expect(r.stats.filesConverted).toBe(0);
  expect(w.terminated).toBe(1);
});
