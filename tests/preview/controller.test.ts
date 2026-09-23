import { expect, it, vi } from "vitest";
import { prepareImport } from "../../src/import/index.js";
import { initialJobStats } from "../../src/policies/index.js";
import type { BrowserImportResult } from "../../src/adapters/browser/index.js";
import type { BrowserExportResult } from "../../src/adapters/browser/export.js";
import { Controller, type Services } from "../../web/controller.js";
import { initialSettings } from "../../web/options.js";
import type {
  PreviewOutcome,
  PreviewRequestContext,
} from "../../web/preview/client.js";
import type { PreviewSurface } from "../../web/preview/session.js";
import { PREVIEW_CONTRACT } from "../../web/preview/protocol.js";

const urls = {
  import: new URL("http://localhost/import.worker.js"),
  export: new URL("http://localhost/export.worker.js"),
  preview: new URL("http://localhost/preview.worker.js"),
};
const prepared = await prepareImport(
  [
    {
      id: "a",
      name: "a.txt",
      kind: "txt",
      bytes: new TextEncoder().encode("本文一"),
    },
    {
      id: "b",
      name: "b.txt",
      kind: "txt",
      bytes: new TextEncoder().encode("本文二"),
    },
  ],
  { conversion: { addFrontmatter: false } },
);
function delivered(): BrowserImportResult {
  const artifacts = prepared.artifacts.map((a) => ({
    ...a,
    blob: new Blob([a.bytes as BlobPart]),
  }));
  return {
    result: { ...prepared, artifacts: [...artifacts] },
    artifacts,
    stats: { ...initialJobStats(), artifactFiles: 2, filesConverted: 2 },
  };
}
const readyExport = (): BrowserExportResult => ({
  contract: "aozora-export-v1",
  mode: "single",
  status: "ready",
  filename: "a.md",
  mime: "text/markdown;charset=utf-8",
  blob: new Blob(["A"]),
  manifest: [],
  diagnostics: [],
  metrics: {
    selectedFiles: 1,
    inputBytes: 1,
    processedBytes: 1,
    copiedBytes: 1,
    outputBytes: 1,
    outputChunks: 1,
    retainedBytes: 1,
    peakRetainedBytes: 1,
    readyFiles: 1,
    entriesAdded: 0,
    writersStarted: 0,
    writersClosed: 0,
    writersAborted: 0,
  },
});
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
async function setup() {
  const runs: {
    bytes: Uint8Array;
    context: PreviewRequestContext;
    done: ReturnType<typeof deferred<PreviewOutcome>>;
  }[] = [];
  const exportJob = { next: deferred<BrowserExportResult>() };
  const services: Services = {
    importFiles: vi.fn(async () => delivered()),
    prepareExport: vi.fn(() => exportJob.next.promise),
    preview: (bytes, context) => {
      const done = deferred<PreviewOutcome>();
      runs.push({ bytes, context, done });
      return done.promise;
    },
  };
  const c = new Controller(urls, services);
  const surface: PreviewSurface = {
    render: async () => ({ result: "done", nodes: 1 }),
    clear: () => {},
  };
  c.preview.attach(surface);
  c.selectFiles([new File(["x"], "a.txt")]);
  await c.startImport();
  return { c, runs, exportJob };
}
const okOutcome: PreviewOutcome = {
  status: "ok",
  model: {
    contract: PREVIEW_CONTRACT,
    frontmatter: null,
    body: [{ k: "p", c: [{ k: "text", v: "本文" }] }],
    notices: [],
  },
  nodes: 2,
  text: 2,
};

it("S8-04 viewing never changes selection, delivery or a ready export", async () => {
  const { c, runs, exportJob } = await setup();
  const [a, b] = c.artifacts;
  c.setSelected(b.fileId, false);
  const preparing = c.prepare("single");
  exportJob.next.resolve(readyExport());
  await preparing;
  const exported = c.state.exported;
  const selected = new Set(c.state.selected);
  expect(exported?.status).toBe("ready");
  expect(c.openPreview(b.fileId)).toBe(true);
  expect(runs[0].bytes).toBe(b.bytes);
  expect(runs[0].context.workerUrl).toBe(urls.preview);
  runs[0].done.resolve(okOutcome);
  await tick();
  expect(c.preview.view.status).toBe("ready");
  expect(c.setPreviewTab("source")).toBe(true);
  expect(c.openPreview(a.fileId)).toBe(true);
  c.closePreview();
  expect(c.state.exported).toBe(exported);
  expect(c.state.selected).toEqual(selected);
  expect(c.state.delivery).toBe("single");
  expect(c.state.delivered?.artifacts[1].bytes).toBe(b.bytes);
  c.dispose();
});

it("VP mode switching never changes selection, delivery, bytes or a ready export", async () => {
  const { c, runs, exportJob } = await setup();
  const [a, b] = c.artifacts;
  c.setSelected(b.fileId, false);
  const preparing = c.prepare("single");
  exportJob.next.resolve(readyExport());
  await preparing;
  const exported = c.state.exported;
  const selected = new Set(c.state.selected);
  const copy = b.bytes.slice();
  expect(c.openPreview(b.fileId)).toBe(true);
  runs[0].done.resolve(okOutcome);
  await tick();
  expect(c.setPreviewMode("vertical")).toBe(true);
  expect(c.setPreviewMode("horizontal")).toBe(true);
  expect(c.setPreviewMode("vertical")).toBe(true);
  expect(runs).toHaveLength(1);
  expect(c.openPreview(a.fileId)).toBe(true);
  expect(c.preview.view.mode).toBe("vertical");
  c.closePreview();
  expect(c.preview.view.mode).toBe("vertical");
  expect(c.state.exported).toBe(exported);
  expect(c.state.selected).toEqual(selected);
  expect(c.state.delivered?.artifacts[1].bytes).toBe(b.bytes);
  expect(b.bytes).toEqual(copy);
  c.dispose();
  expect(c.setPreviewMode("horizontal")).toBe(false);
});

it("FUI face switching never changes selection, delivery, bytes or a ready export", async () => {
  const { c, runs, exportJob } = await setup();
  const [a, b] = c.artifacts;
  c.setSelected(b.fileId, false);
  const preparing = c.prepare("single");
  exportJob.next.resolve(readyExport());
  await preparing;
  const exported = c.state.exported;
  const selected = new Set(c.state.selected);
  const copy = b.bytes.slice();
  expect(c.openPreview(b.fileId)).toBe(true);
  runs[0].done.resolve(okOutcome);
  await tick();
  expect(c.preview.view.face).toBe("gothic");
  expect(c.setPreviewFace("mincho")).toBe(true);
  expect(c.setPreviewFace("gothic")).toBe(true);
  expect(c.setPreviewFace("mincho")).toBe(true);
  expect(runs).toHaveLength(1);
  expect(c.openPreview(a.fileId)).toBe(true);
  expect(c.preview.view.face).toBe("mincho");
  c.closePreview();
  expect(c.preview.view.face).toBe("mincho");
  expect(c.state.exported).toBe(exported);
  expect(c.state.selected).toEqual(selected);
  expect(c.state.delivered?.artifacts[1].bytes).toBe(b.bytes);
  expect(b.bytes).toEqual(copy);
  c.dispose();
  expect(c.setPreviewFace("gothic")).toBe(false);
});

it("S8-04 export start cancels a running preview; busy rejects new previews", async () => {
  const { c, runs, exportJob } = await setup();
  const [a, b] = c.artifacts;
  c.setSelected(b.fileId, false);
  c.openPreview(a.fileId);
  const preparing = c.prepare("single");
  expect(runs[0].context.signal?.aborted).toBe(true);
  expect(c.preview.view).toMatchObject({
    status: "cancelled",
    cancelCause: "busy",
  });
  expect(c.openPreview(a.fileId)).toBe(false);
  expect(c.retryPreview()).toBe(false);
  runs[0].done.resolve(okOutcome);
  exportJob.next.resolve(readyExport());
  await preparing;
  expect(c.state.exported?.status).toBe("ready");
  expect(c.preview.view.status).toBe("cancelled");
  expect(c.retryPreview()).toBe(true);
  expect(runs).toHaveLength(2);
  expect(c.state.exported?.status).toBe("ready");
  c.dispose();
});

it("S8-04 preview failure is not an import/export failure", async () => {
  const { c, runs } = await setup();
  const message = c.state.message;
  c.openPreview(c.artifacts[0].fileId);
  runs[0].done.resolve({ status: "failed", reason: "worker-unavailable" });
  await tick();
  expect(c.preview.view).toMatchObject({
    status: "failed",
    failure: "worker-unavailable",
  });
  expect(c.state.message).toBe(message);
  expect(c.state.delivered?.result.status).toBe("completed");
  expect(c.canImport).toBe(true);
  c.dispose();
});

it("S8-04 input/settings changes, re-import and dispose invalidate the preview", async () => {
  const { c, runs } = await setup();
  c.openPreview(c.artifacts[0].fileId);
  c.changeSettings({ ...initialSettings(), outputExtension: "txt" });
  expect(runs[0].context.signal?.aborted).toBe(true);
  expect(c.preview.view.status).toBe("idle");
  await c.startImport();
  c.openPreview(c.artifacts[0].fileId);
  const stale = c.preview.view.target;
  c.selectFiles([new File(["y"], "b.txt")]);
  expect(c.preview.view.status).toBe("idle");
  await c.startImport();
  expect(c.artifacts.some((a) => a === stale?.artifact)).toBe(false);
  c.openPreview(c.artifacts[0].fileId);
  runs[runs.length - 1].done.resolve({ status: "timeout" });
  await tick();
  c.dispose();
  expect(c.preview.view.status).toBe("idle");
  expect(c.openPreview("anything")).toBe(false);
});

it("S8-04 unknown file ids are refused", async () => {
  const { c, runs } = await setup();
  expect(c.openPreview("nope")).toBe(false);
  expect(runs).toHaveLength(0);
  c.dispose();
});
