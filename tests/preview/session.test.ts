import { describe, expect, it } from "vitest";
import type {
  PreviewOutcome,
  PreviewRequestContext,
} from "../../web/preview/client.js";
import type { PreviewModel } from "../../web/preview/model.js";
import {
  PreviewSession,
  type PreviewSurface,
  type PreviewTarget,
  type SurfaceResult,
} from "../../web/preview/session.js";
import {
  PREVIEW_CONTRACT,
  PREVIEW_LIMITS,
} from "../../web/preview/protocol.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const model = (over: Partial<PreviewModel> = {}): PreviewModel => ({
  contract: PREVIEW_CONTRACT,
  frontmatter: null,
  body: [{ k: "p", c: [{ k: "text", v: "本文" }] }],
  notices: [],
  ...over,
});
const ok = (m = model()): PreviewOutcome => ({
  status: "ok",
  model: m,
  nodes: 2,
  text: 2,
});
function target(
  id = "a",
  bytes = new TextEncoder().encode("本文"),
): PreviewTarget {
  return {
    fileId: id,
    relativePath: id + ".md",
    format: "md",
    bytes,
    generation: 1,
    artifact: { id },
  };
}
function harness() {
  const calls: {
    bytes: Uint8Array;
    context: PreviewRequestContext;
    done: ReturnType<typeof deferred<PreviewOutcome>>;
  }[] = [];
  let notified = 0;
  const session = new PreviewSession(
    (bytes, context) => {
      const done = deferred<PreviewOutcome>();
      calls.push({ bytes, context, done });
      return done.promise;
    },
    new URL("http://localhost/preview.worker.js"),
    () => notified++,
  );
  const renders: {
    model: PreviewModel;
    isCurrent: () => boolean;
    done: ReturnType<
      typeof deferred<{ result: SurfaceResult; nodes?: number }>
    >;
  }[] = [];
  let clears = 0;
  const surface: PreviewSurface = {
    render(m, isCurrent) {
      const done = deferred<{ result: SurfaceResult; nodes?: number }>();
      renders.push({ model: m, isCurrent, done });
      return done.promise;
    },
    clear() {
      clears++;
    },
  };
  session.attach(surface);
  return {
    session,
    calls,
    renders,
    get notified() {
      return notified;
    },
    get clears() {
      return clears;
    },
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("S8-04 preview session (fake runner)", () => {
  it("loading → rendering → ready with notices and unique request ids", async () => {
    const h = harness();
    h.session.open(target());
    expect(h.session.view.status).toBe("loading");
    expect(h.session.active).toBe(true);
    expect(h.calls[0].context).toMatchObject({
      requestId: "preview-1",
      generation: 1,
    });
    expect(h.calls[0].context.workerUrl?.toString()).toBe(
      "http://localhost/preview.worker.js",
    );
    h.calls[0].done.resolve(ok(model({ notices: ["tcy-horizontal"] })));
    await tick();
    expect(h.session.view.status).toBe("rendering");
    h.renders[0].done.resolve({ result: "done", nodes: 2 });
    await tick();
    expect(h.session.view).toMatchObject({
      status: "ready",
      notices: ["tcy-horizontal"],
      nodes: 2,
    });
    h.session.open(target("b"));
    expect(h.calls[1].context.requestId).toBe("preview-2");
  });
  it("empty and oversize never start a job", () => {
    const h = harness();
    h.session.open(target("e", new Uint8Array()));
    expect(h.session.view.status).toBe("empty");
    h.session.open(
      target("big", new Uint8Array(PREVIEW_LIMITS.inputBytes + 1)),
    );
    expect(h.session.view).toMatchObject({
      status: "limit",
      limit: "input-bytes",
    });
    h.session.open(target("edge", new Uint8Array(PREVIEW_LIMITS.inputBytes)));
    expect(h.session.view.status).toBe("loading");
    expect(h.calls).toHaveLength(1);
  });
  it("switching files aborts the old job and drops its late result", async () => {
    const h = harness();
    h.session.open(target("a"));
    const first = h.calls[0];
    h.session.open(target("b"));
    expect(first.context.signal?.aborted).toBe(true);
    first.done.resolve(ok());
    await tick();
    expect(h.renders).toHaveLength(0);
    expect(h.session.view).toMatchObject({
      status: "loading",
      target: { fileId: "b" },
    });
  });
  it("switching during render marks the old render stale", async () => {
    const h = harness();
    h.session.open(target("a"));
    h.calls[0].done.resolve(ok());
    await tick();
    const stale = h.renders[0];
    expect(stale.isCurrent()).toBe(true);
    h.session.open(target("b"));
    expect(stale.isCurrent()).toBe(false);
    stale.done.resolve({ result: "done", nodes: 2 });
    await tick();
    expect(h.session.view.status).toBe("loading");
  });
  it("busy cancel only stops running jobs; reset drops the target", async () => {
    const h = harness();
    h.session.open(target());
    h.session.cancelForBusy();
    expect(h.session.view).toMatchObject({
      status: "cancelled",
      cancelCause: "busy",
    });
    expect(h.calls[0].context.signal?.aborted).toBe(true);
    expect(h.session.retry()).toBe(true);
    h.calls[1].done.resolve(ok());
    await tick();
    h.renders[0].done.resolve({ result: "done", nodes: 2 });
    await tick();
    h.session.cancelForBusy();
    expect(h.session.view.status).toBe("ready");
    h.session.reset();
    expect(h.session.view).toEqual({
      status: "idle",
      tab: "preview",
      mode: "horizontal",
      face: "gothic",
      notices: [],
    });
  });
  it("VP mode: horizontal by default, kept across open/close/switch, reset only by dispose", async () => {
    const h = harness();
    expect(h.session.view.mode).toBe("horizontal");
    expect(h.session.setMode("vertical")).toBe(true);
    h.session.open(target("a"));
    expect(h.session.view.mode).toBe("vertical");
    h.calls[0].done.resolve(ok(model({ notices: ["tcy-horizontal"] })));
    await tick();
    h.renders[0].done.resolve({ result: "done", nodes: 2 });
    await tick();
    expect(h.session.view).toMatchObject({
      status: "ready",
      mode: "vertical",
      notices: ["tcy-horizontal"],
    });
    h.session.open(target("b"));
    expect(h.session.view.mode).toBe("vertical");
    h.session.reset();
    expect(h.session.view.mode).toBe("vertical");
    h.session.cancelForBusy();
    h.session.open(target("c"));
    expect(h.session.view.mode).toBe("vertical");
    h.session.dispose();
    expect(h.session.view.mode).toBe("horizontal");
  });
  it("VP mode switch is display-only: no Worker call, no render, no clear, same model state", async () => {
    const h = harness();
    h.session.open(target("a"));
    h.calls[0].done.resolve(ok(model({ notices: ["tcy-horizontal"] })));
    await tick();
    h.renders[0].done.resolve({ result: "done", nodes: 7 });
    await tick();
    const before = { ...h.session.view };
    const clears = h.clears,
      notified = h.notified;
    expect(h.session.setMode("vertical")).toBe(true);
    expect(h.session.setMode("vertical")).toBe(true);
    expect(h.notified).toBe(notified + 1);
    expect(h.session.setMode("diagonal" as "vertical")).toBe(false);
    expect(h.calls).toHaveLength(1);
    expect(h.renders).toHaveLength(1);
    expect(h.clears).toBe(clears);
    expect(h.session.view).toEqual({ ...before, mode: "vertical" });
    expect(h.session.view.target).toBe(before.target);
    h.session.setMode("horizontal");
    expect(h.session.view).toEqual(before);
  });
  it("FUI face: gothic by default, kept across open/close/mode, reset only by dispose, no Worker", async () => {
    const h = harness();
    expect(h.session.view.face).toBe("gothic");
    expect(h.session.setFace("mincho")).toBe(true);
    expect(h.session.setFace("mincho")).toBe(true);
    expect(h.session.setFace("script" as "mincho")).toBe(false);
    h.session.open(target("a"));
    expect(h.session.view.face).toBe("mincho");
    h.calls[0].done.resolve(ok(model({ notices: ["tcy-horizontal"] })));
    await tick();
    h.renders[0].done.resolve({ result: "done", nodes: 2 });
    await tick();
    const calls = h.calls.length,
      renders = h.renders.length;
    h.session.setMode("vertical");
    expect(h.session.view).toMatchObject({ mode: "vertical", face: "mincho" });
    h.session.setFace("gothic");
    expect(h.calls).toHaveLength(calls);
    expect(h.renders).toHaveLength(renders);
    expect(h.session.view).toMatchObject({
      status: "ready",
      mode: "vertical",
      face: "gothic",
    });
    h.session.open(target("b"));
    expect(h.session.view.face).toBe("gothic");
    h.session.setFace("mincho");
    h.session.reset();
    expect(h.session.view.face).toBe("mincho");
    h.session.dispose();
    expect(h.session.view.face).toBe("gothic");
  });
  it("VP mode switch during loading keeps the running job", async () => {
    const h = harness();
    h.session.open(target("a"));
    h.session.setMode("vertical");
    expect(h.calls[0].context.signal?.aborted).toBe(false);
    expect(h.session.view.status).toBe("loading");
    h.calls[0].done.resolve(ok());
    await tick();
    expect(h.renders).toHaveLength(1);
    expect(h.renders[0].isCurrent()).toBe(true);
  });
  it("tab choice survives file switches and rejects unknown tabs", () => {
    const h = harness();
    expect(h.session.setTab("source")).toBe(false);
    h.session.open(target("a"));
    expect(h.session.setTab("source")).toBe(true);
    h.session.open(target("b"));
    expect(h.session.view.tab).toBe("source");
    expect(h.session.setTab("html" as "source")).toBe(false);
    h.session.reset();
    h.session.open(target("c"));
    expect(h.session.view.tab).toBe("preview");
  });
  it("runner/surface failures map to distinct states", async () => {
    for (const [outcome, expected] of [
      [{ status: "timeout" }, { status: "timeout" }],
      [{ status: "cancelled" }, { status: "cancelled" }],
      [
        { status: "limit", reason: "text" },
        { status: "limit", limit: "text" },
      ],
      [
        { status: "failed", reason: "worker-unavailable" },
        { status: "failed", failure: "worker-unavailable" },
      ],
      [ok(model({ body: [] })), { status: "empty" }],
    ] as const) {
      const h = harness();
      h.session.open(target());
      h.calls[0].done.resolve(outcome as PreviewOutcome);
      await tick();
      expect(h.session.view).toMatchObject(expected);
      expect(h.renders).toHaveLength(0);
    }
    for (const [result, expected] of [
      ["limit", { status: "limit", limit: "nodes" }],
      ["failed", { status: "failed", failure: "render-failed" }],
      ["cancelled", { status: "cancelled", cancelCause: "user" }],
    ] as const) {
      const h = harness();
      h.session.open(target());
      h.calls[0].done.resolve(ok());
      await tick();
      const clears = h.clears;
      h.renders[0].done.resolve({ result });
      await tick();
      expect(h.session.view).toMatchObject(expected);
      expect(h.clears).toBe(clears + 1);
    }
  });
  it("a rejecting runner and a missing surface do not hang", async () => {
    const rejecting = new PreviewSession(
      async () => {
        throw new Error("x");
      },
      undefined,
      () => {},
    );
    rejecting.open(target());
    await tick();
    expect(rejecting.view).toMatchObject({
      status: "failed",
      failure: "worker-failed",
    });
    const h = harness();
    h.session.attach(undefined);
    h.session.open(target());
    h.calls[0].done.resolve(ok());
    await tick();
    expect(h.session.view.status).toBe("cancelled");
  });
  it("frontmatter-only model is not empty", async () => {
    const h = harness();
    h.session.open(target());
    h.calls[0].done.resolve(
      ok(
        model({
          body: [],
          frontmatter: { status: "valid", fields: [], raw: "---\n---" },
        }),
      ),
    );
    await tick();
    expect(h.session.view.status).toBe("rendering");
  });
  it("dispose aborts and forgets the surface", () => {
    const h = harness();
    h.session.open(target());
    h.session.dispose();
    expect(h.calls[0].context.signal?.aborted).toBe(true);
    expect(h.session.view.status).toBe("idle");
  });
});
