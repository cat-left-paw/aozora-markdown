import { afterEach, expect, it, vi } from "vitest";
import {
  convertText,
  CONTENT_OPTION_KEYS,
  DEFAULT_OPTIONS,
} from "../../src/index.js";
import {
  prepareImport,
  DEFAULT_IMPORT_LIMITS,
} from "../../src/import/index.js";
import { initialJobStats } from "../../src/policies/index.js";
import type { BrowserImportResult } from "../../src/adapters/browser/index.js";
import {
  createDownloadHandle,
  type BrowserExportResult,
  type DownloadHost,
} from "../../src/adapters/browser/export.js";
import { Controller, type Services } from "../../web/controller.js";
import {
  DOWNLOAD_CAP_MESSAGE,
  Downloads,
  MAX_DOWNLOAD_HANDLES,
} from "../../web/downloads.js";
import {
  initialSettings,
  importOptions,
  isNoContentConversion,
  selectionIssues,
  snapshotSettings,
  BOOLEAN_CONTROLS,
} from "../../web/options.js";
import {
  PAGE_SIZE,
  WEB_CONTRACT,
  deliveryButtonLabel,
  fileSelectionPresentation,
  pageOf,
} from "../../web/state.js";
import {
  HELP_TOPICS,
  NO_CONTENT_CONVERSION,
  PICKER_FORMATS,
  PICKER_REPLACE,
  REMAINING_NOTES_LABEL,
} from "../../web/catalog.js";
const urls = {
  import: new URL("http://localhost/import.worker.js"),
  export: new URL("http://localhost/export.worker.js"),
};
const file = (name = "a.txt", text = "本文") => new File([text], name);
const initialImport = await prepareImport(
  [
    {
      id: "fixture",
      name: "fixture.txt",
      kind: "txt",
      bytes: new TextEncoder().encode("青［＃未対応］"),
    },
  ],
  { conversion: { addFrontmatter: false } },
);
function delivered(
  status: BrowserImportResult["result"]["status"] = "completed",
  count = 1,
): BrowserImportResult {
  const conversion = convertText("青［＃未対応］", {
    addFrontmatter: false,
  });
  const artifacts = Array.from({ length: count }, (_, i) => ({
    ...initialImport.artifacts[0],
    fileId: "artifact-" + i,
    relativePath: i + ".md",
    conversion,
    blob: new Blob(["青［＃未対応］"]),
  }));
  return {
    result: { ...initialImport, status, artifacts: [...artifacts] },
    artifacts: status === "completed" || status === "partial" ? artifacts : [],
    stats: {
      ...initialJobStats(),
      artifactFiles: count,
      filesConverted: count,
      remainingNotes: count,
      errors: status === "partial" ? 1 : 0,
    },
  };
}
const ready: BrowserExportResult = {
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
};
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup() {
  const imports = vi.fn<Services["importFiles"]>(async () => delivered());
  const exports = vi.fn<Services["prepareExport"]>(async () => ready);
  const c = new Controller(urls, {
    importFiles: imports,
    prepareExport: exports,
  });
  return { c, imports, exports };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("S4-02 selection replacement/cancel/identity/order/reselection/delete with no body read", () => {
  const { c } = setup(),
    f = file(),
    read = vi.spyOn(f, "arrayBuffer");
  expect(c.canImport).toBe(false);
  c.selectFiles([f, f]);
  const ids = c.state.files.map((f) => f.id);
  expect(new Set(ids).size).toBe(2);
  expect(c.state.files.map((x) => x.file)).toEqual([f, f]);
  c.selectFiles([]);
  expect(c.state.files.map((x) => x.id)).toEqual(ids);
  c.selectFiles([f]);
  expect(c.state.files[0].id).not.toBe(ids[0]);
  c.removeFile(c.state.files[0].id);
  expect(c.state.files).toEqual([]);
  expect(read).not.toHaveBeenCalled();
  c.dispose();
});
it("all displayed selection limits use public defaults, boundaries and unsupported preserved", () => {
  expect(DEFAULT_IMPORT_LIMITS).toMatchObject({
    sources: 64,
    inputBytes: 64 * 1048576,
    totalInputBytes: 128 * 1048576,
  });
  const withSize = (size: number, name = "a.txt") => ({
    id: String(size) + name,
    file: { name, size } as File,
  });
  expect(selectionIssues([withSize(DEFAULT_IMPORT_LIMITS.inputBytes)])).toEqual(
    [],
  );
  expect(
    selectionIssues([withSize(DEFAULT_IMPORT_LIMITS.inputBytes + 1)]),
  ).toHaveLength(1);
  expect(
    selectionIssues([
      withSize(DEFAULT_IMPORT_LIMITS.inputBytes),
      withSize(DEFAULT_IMPORT_LIMITS.inputBytes, "b.txt"),
    ]),
  ).toEqual([]);
  expect(
    selectionIssues([
      withSize(DEFAULT_IMPORT_LIMITS.inputBytes),
      withSize(DEFAULT_IMPORT_LIMITS.inputBytes, "b.txt"),
      withSize(1),
    ]),
  ).toHaveLength(1);
  expect(
    selectionIssues(Array.from({ length: 64 }, () => withSize(0))),
  ).toEqual([]);
  expect(
    selectionIssues(Array.from({ length: 65 }, () => withSize(0))),
  ).toHaveLength(1);
  const { c, imports } = setup();
  c.selectFiles([file("bad.png"), file()]);
  expect(c.state.files).toHaveLength(2);
  expect(c.canImport).toBe(false);
  void c.startImport();
  expect(imports).not.toHaveBeenCalled();
  c.removeFile(c.state.files[0].id);
  expect(c.canImport).toBe(true);
  c.dispose();
});
it("defaults cover every public option and no sourceFormat, renameToMd or limit override", () => {
  const s = initialSettings();
  expect(s).toEqual({
    encoding: "auto",
    organizeByAuthor: false,
    outputExtension: "md",
    conversion: { ...DEFAULT_OPTIONS },
  });
  expect(Object.keys(DEFAULT_OPTIONS).sort()).toEqual(
    [
      ...BOOLEAN_CONTROLS.map((x) => x.key),
      "boutenChar",
      "underlineOutputFormat",
      "headingLevels",
    ].sort(),
  );
  expect(importOptions(s)).toEqual(s);
  expect(importOptions(s)).not.toHaveProperty("limits");
  expect(importOptions(s).conversion).not.toHaveProperty("sourceFormat");
  expect(importOptions(s).conversion).not.toHaveProperty("renameToMd");
  expect(importOptions(s).outputExtension).toBe("md");
});
it("S6 nested heading levels are owned per settings/job snapshot; DEFAULT_OPTIONS never shared", () => {
  const a = initialSettings(),
    b = initialSettings();
  expect(a.conversion.headingLevels).toEqual({ large: 2, medium: 3, small: 4 });
  expect(a.conversion.headingLevels).not.toBe(DEFAULT_OPTIONS.headingLevels);
  expect(a.conversion.headingLevels).not.toBe(b.conversion.headingLevels);
  a.conversion.headingLevels.large = 1;
  expect(b.conversion.headingLevels.large).toBe(2);
  expect(DEFAULT_OPTIONS.headingLevels.large).toBe(2);
  const snap = snapshotSettings(a);
  expect(snap.conversion.headingLevels).not.toBe(a.conversion.headingLevels);
  a.conversion.headingLevels.medium = 6;
  expect(snap.conversion.headingLevels).toEqual({
    large: 1,
    medium: 3,
    small: 4,
  });
  const mapped = importOptions(snap);
  expect(mapped.conversion?.headingLevels).not.toBe(
    snap.conversion.headingLevels,
  );
  expect(mapped.conversion?.headingLevels).toEqual({
    large: 1,
    medium: 3,
    small: 4,
  });
});
it("all-OFF display derives from the content parents only, including convertTcy", () => {
  const s = initialSettings();
  expect(isNoContentConversion(s.conversion)).toBe(false);
  const off = Object.fromEntries(CONTENT_OPTION_KEYS.map((k) => [k, false]));
  const allOff = { ...s.conversion, ...off };
  expect(isNoContentConversion(allOff)).toBe(true);
  // Child/format/level settings ON do not count as conversion.
  expect(
    isNoContentConversion({
      ...allOff,
      preserveIndentNotes: true,
      approximateJiage: true,
      approximateSpreadBreaks: true,
      approximateLeftUnderline: true,
      underlineOutputFormat: "html",
      boutenChar: "●",
      headingLevels: { large: 1, medium: 1, small: 1 },
    }),
  ).toBe(true);
  for (const key of CONTENT_OPTION_KEYS)
    expect(isNoContentConversion({ ...allOff, [key]: true }), key).toBe(false);
  expect(NO_CONTENT_CONVERSION).toBe(
    "本文の変換なし。文字コードはUTF-8、改行はLFで出力します。",
  );
  expect(REMAINING_NOTES_LABEL).toBe("未変換注記（OFFにした処理の注記を含む）");
});
it("S7 convertTcy is in the job snapshot, invalidates a result, and reset restores it", async () => {
  const { c, imports } = setup();
  expect(c.state.settings.conversion.convertTcy).toBe(true);
  c.selectFiles([file()]);
  await c.startImport();
  expect(imports.mock.calls[0][1].conversion?.convertTcy).toBe(true);
  expect(
    c.changeSettings({
      ...c.state.settings,
      conversion: { ...c.state.settings.conversion, convertTcy: false },
    }),
  ).toBe(true);
  expect(c.state.delivered).toBeUndefined();
  const owned = snapshotSettings(c.state.settings);
  c.state.settings.conversion = {
    ...c.state.settings.conversion,
    convertTcy: true,
  };
  expect(owned.conversion.convertTcy).toBe(false);
  c.state.settings.conversion = {
    ...c.state.settings.conversion,
    convertTcy: false,
  };
  const pending = c.startImport();
  c.state.settings.conversion = {
    ...c.state.settings.conversion,
    convertTcy: true,
  };
  expect(imports.mock.calls[1][1].conversion?.convertTcy).toBe(false);
  expect(imports.mock.calls[1][1].conversion).not.toBe(
    c.state.settings.conversion,
  );
  await pending;
  c.resetSettings();
  expect(c.state.settings.conversion.convertTcy).toBe(true);
  expect(DEFAULT_OPTIONS.convertTcy).toBe(true);
  c.dispose();
});
it("S6 output extension and conversion changes invalidate results; the job snapshot carries the extension", async () => {
  const { c, imports } = setup();
  c.selectFiles([file()]);
  await c.startImport();
  await c.prepare("single");
  expect(c.state.exported?.status).toBe("ready");
  expect(
    c.changeSettings({ ...c.state.settings, outputExtension: "txt" }),
  ).toBe(true);
  expect(c.state.delivered).toBeUndefined();
  expect(c.state.exported).toBeUndefined();
  expect(c.state.message).toContain("変換を開始してください");
  await c.startImport();
  expect(imports.mock.calls[1][1]).toMatchObject({ outputExtension: "txt" });
  const settings = c.state.settings;
  c.changeSettings({
    ...settings,
    conversion: {
      ...settings.conversion,
      headingLevels: { ...settings.conversion.headingLevels, small: 6 },
    },
  });
  expect(c.state.delivered).toBeUndefined();
  await c.startImport();
  expect(imports.mock.calls[2][1].conversion?.headingLevels).toEqual({
    large: 2,
    medium: 3,
    small: 6,
  });
  c.resetSettings();
  expect(c.state.settings.outputExtension).toBe("md");
  expect(c.state.settings.conversion.headingLevels).toEqual({
    large: 2,
    medium: 3,
    small: 4,
  });
  c.dispose();
});
it.each(BOOLEAN_CONTROLS.map((o) => o.key))(
  "explicit false mapping %s and child preservation",
  (key) => {
    const s = initialSettings();
    const changed = { ...s, conversion: { ...s.conversion, [key]: false } };
    const mapped = importOptions(changed);
    expect(mapped.conversion).toEqual(changed.conversion);
    expect(mapped.conversion?.[key]).toBe(false);
    expect(Object.values(mapped.conversion ?? {})).not.toContain(undefined);
  },
);
it.each(["auto", "utf-8", "cp932", "shift_jis"] as const)(
  "encoding %s and supplementary/space bouten are not normalized",
  (encoding) => {
    const s = initialSettings();
    expect(
      importOptions({
        ...s,
        encoding,
        conversion: { ...s.conversion, boutenChar: " 😀x" },
      }),
    ).toMatchObject({ encoding, conversion: { boutenChar: " 😀x" } });
  },
);
it("S4-03 snapshot/one job/disabled operations/progress noncommit, normal outside artifacts only", async () => {
  const { c, imports, exports } = setup(),
    d = deferred<BrowserImportResult>();
  imports.mockReturnValueOnce(d.promise);
  const f = file();
  c.selectFiles([f]);
  const start = c.startImport();
  expect(await c.startImport()).toBe(false);
  expect(await c.prepare("zip")).toBe(false);
  expect(c.selectFiles([file("b.txt")])).toBe(false);
  expect(c.removeFile(c.state.files[0].id)).toBe(false);
  expect(c.resetSettings()).toBe(false);
  expect(imports).toHaveBeenCalledTimes(1);
  expect(exports).not.toHaveBeenCalled();
  expect(imports.mock.calls[0][1]).toEqual(initialSettings());
  expect(imports.mock.calls[0][0]).not.toBe(c.state.files);
  expect(c.state.active?.settings).not.toBe(c.state.settings);
  const result = delivered();
  result.result.artifacts.push({
    ...result.result.artifacts[0],
    fileId: "candidate-only",
  });
  d.resolve(result);
  await start;
  expect(c.artifacts).toHaveLength(1);
  expect([...c.state.selected]).toEqual(["artifact-0"]);
  expect(c.state.active).toBeUndefined();
  c.dispose();
});
it("clear old job -> new job: stale progress/result/finally cannot end new busy state", async () => {
  const { c, imports } = setup(),
    old = deferred<BrowserImportResult>(),
    next = deferred<BrowserImportResult>();
  imports.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  c.selectFiles([file()]);
  const p = c.startImport(),
    oldContext = imports.mock.calls[0][2];
  c.clear();
  expect(oldContext.signal?.aborted).toBe(true);
  c.selectFiles([file("new.txt")]);
  const q = c.startImport(),
    token = c.state.active?.token;
  oldContext.onProgress?.({
    stage: "converted",
    inputId: "old",
    metrics: initialImport.metrics,
  });
  old.resolve(delivered());
  await p;
  expect(c.state.active?.token).toBe(token);
  expect(c.state.delivered).toBeUndefined();
  expect(c.state.progress).toBe("");
  next.resolve(delivered());
  await q;
  expect(c.artifacts).toHaveLength(1);
  c.dispose();
});
it.each(["completed", "partial", "failed", "cancelled"] as const)(
  "status %s never rescues candidates",
  async (status) => {
    const { c, imports } = setup();
    imports.mockResolvedValueOnce(delivered(status));
    c.selectFiles([file()]);
    await c.startImport();
    expect(c.artifacts.length).toBe(
      status === "completed" || status === "partial" ? 1 : 0,
    );
    expect(c.state.message.length).toBeGreaterThan(0);
    c.dispose();
  },
);
it("completed empty result, options/reset invalidate, clear keeps settings", async () => {
  const { c, imports } = setup();
  imports.mockResolvedValueOnce(delivered("completed", 0));
  c.selectFiles([file()]);
  await c.startImport();
  expect(c.state.message).toContain("出力はありません");
  expect(await c.prepare("zip")).toBe(false);
  c.changeSettings({ ...initialSettings(), organizeByAuthor: true });
  expect(c.state.delivered).toBeUndefined();
  c.clear();
  expect(c.state.settings.organizeByAuthor).toBe(true);
  c.selectFiles([file()]);
  c.resetSettings();
  expect(c.state.files).toHaveLength(1);
  expect(c.state.settings).toEqual(initialSettings());
  c.dispose();
});
it("selection changes invalidate only export; snapshot order is artifact order, not click order", async () => {
  const { c, imports, exports } = setup();
  imports.mockResolvedValueOnce(delivered("partial", 3));
  c.selectFiles([file()]);
  await c.startImport();
  const before = c.state.delivered;
  c.selectAll(false);
  c.setSelected("artifact-2", true);
  c.setSelected("artifact-0", true);
  await c.prepare("zip");
  expect(exports.mock.calls[0][0].map((a) => a.fileId)).toEqual([
    "artifact-0",
    "artifact-2",
  ]);
  expect(Object.keys(exports.mock.calls[0][0][0]).sort()).toEqual([
    "bytes",
    "fileId",
    "format",
    "relativePath",
  ]);
  c.setSelected("artifact-1", true);
  expect(c.state.exported).toBeUndefined();
  expect(c.state.delivered).toBe(before);
  expect(c.state.delivered?.stats.errors).toBe(1);
  expect(c.state.delivered?.stats.savedFiles).toBe(0);
  c.dispose();
});
it("export failure/cancel leaves import and selection; retry works; old export cannot restore Blob", async () => {
  const { c, exports } = setup();
  c.selectFiles([file()]);
  await c.startImport();
  const before = c.state.delivered;
  exports.mockRejectedValueOnce(Error("private"));
  await c.prepare("zip");
  expect(c.state.delivered).toBe(before);
  expect(c.state.exported).toBeUndefined();
  const old = deferred<BrowserExportResult>();
  exports.mockReturnValueOnce(old.promise);
  const p = c.prepare("zip");
  c.cancel();
  expect(exports.mock.calls[1][2].signal?.aborted).toBe(true);
  old.resolve(ready);
  await p;
  expect(c.state.exported).toBeUndefined();
  expect(c.state.selected.size).toBe(1);
  await c.prepare("single");
  expect(c.state.exported?.status).toBe("ready");
  c.dispose();
});
it("import cancel and rejection retain inputs and permit retry; dispose is terminal", async () => {
  const { c, imports } = setup();
  c.selectFiles([file()]);
  imports.mockRejectedValueOnce(Error("private body"));
  await c.startImport();
  expect(c.state.message).not.toContain("private body");
  expect(c.state.files).toHaveLength(1);
  const old = deferred<BrowserImportResult>();
  imports.mockReturnValueOnce(old.promise);
  const p = c.startImport();
  c.cancel();
  expect(imports.mock.calls[1][2].signal?.aborted).toBe(true);
  old.resolve(delivered());
  await p;
  expect(c.state.delivered).toBeUndefined();
  await c.startImport();
  expect(c.artifacts).toHaveLength(1);
  c.dispose();
  c.dispose();
  expect(await c.startImport()).toBe(false);
  expect(c.state.files).toHaveLength(0);
});
it("S4-04 bounded pages preserve all data and selection", async () => {
  const { c, imports } = setup();
  imports.mockResolvedValueOnce(delivered("completed", 101));
  c.selectFiles([file()]);
  await c.startImport();
  expect(PAGE_SIZE).toBe(50);
  expect(pageOf(c.artifacts, 0)).toHaveLength(50);
  expect(pageOf(c.artifacts, 1)).toHaveLength(50);
  expect(pageOf(c.artifacts, 2)).toHaveLength(1);
  c.setPage("resultPage", 2);
  expect(c.state.selected.size).toBe(101);
  c.selectAll(false);
  expect(c.state.selected.size).toBe(0);
  c.selectAll(true);
  expect(c.state.selected.size).toBe(101);
  c.dispose();
});
it("S4-05 real handles + fake clock: 8 cap, 60s retention, one tracking timer, fresh request", () => {
  vi.useFakeTimers();
  let now = 0,
    created = 0,
    revoked = 0;
  const host: DownloadHost = {
    createObjectURL: () => `blob:${++created}`,
    revokeObjectURL: () => {
      revoked++;
    },
    createAnchor: () => ({ href: "", download: "", click() {}, remove() {} }),
    appendAnchor() {},
    setTimer: (cb, ms) => setTimeout(cb, ms),
    clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
  };
  const manager = new Downloads(() => {}, {
    createHandle: (b, n) => createDownloadHandle(b, n, host),
    now: () => now,
    setTimer: (cb, ms) => setTimeout(cb, ms),
    clearTimer: (t) => clearTimeout(t),
  });
  for (let i = 0; i < 8; i++) {
    const message = manager.request(new Blob(["x"]), "x.md");
    expect(message).toBe(
      "ダウンロードを開始しました。保存状況はブラウザで確認してください。",
    );
    expect(message).not.toContain("保存しました");
  }
  expect(manager.count).toBe(MAX_DOWNLOAD_HANDLES);
  expect(created).toBe(8);
  expect(vi.getTimerCount()).toBe(9);
  expect(manager.request(new Blob(), "x.md")).toBe(
    "ダウンロード操作が続いています。少し待ってから再試行してください。",
  );
  expect(manager.request(new Blob(), "x.md")).not.toContain("要求用URL");
  expect(manager.request(new Blob(), "x.md")).not.toContain("未解放");
  expect(created).toBe(8);
  expect(revoked).toBe(0);
  now = 59999;
  vi.advanceTimersByTime(59999);
  expect(revoked).toBe(0);
  now = 60000;
  vi.advanceTimersByTime(1);
  expect(revoked).toBe(8);
  now = 60001;
  vi.advanceTimersByTime(1);
  expect(manager.count).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  manager.request(new Blob(), "x.md");
  expect(created).toBe(9);
  manager.dispose();
  manager.dispose();
  expect(revoked).toBe(9);
  expect(vi.getTimerCount()).toBe(0);
});
it("download capacity warning clears when an issued URL expires", async () => {
  vi.useFakeTimers();
  let now = 0;
  const host: DownloadHost = {
    createObjectURL: () => "blob:test",
    revokeObjectURL() {},
    createAnchor: () => ({ href: "", download: "", click() {}, remove() {} }),
    appendAnchor() {},
    setTimer: (cb, ms) => setTimeout(cb, ms),
    clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
  };
  const c = new Controller(
    urls,
    { importFiles: async () => delivered(), prepareExport: async () => ready },
    true,
    {
      createHandle: (blob, filename) =>
        createDownloadHandle(blob, filename, host),
      now: () => now,
      setTimer: (cb, ms) => setTimeout(cb, ms),
      clearTimer: (t) => clearTimeout(t),
    },
  );
  c.selectFiles([file()]);
  await c.startImport();
  await c.prepare("single");
  for (let i = 0; i < MAX_DOWNLOAD_HANDLES; i++) c.requestDownload();
  c.requestDownload();
  expect(c.state.downloadMessage).toBe(DOWNLOAD_CAP_MESSAGE);
  now = 60002;
  vi.advanceTimersByTime(60002);
  expect(c.downloads.count).toBe(0);
  expect(c.state.downloadMessage).toBe("");
  c.requestDownload();
  expect(c.state.downloadMessage).toContain("ダウンロードを開始しました");
  c.dispose();
});
it("issued handles survive selection/result/clear but page disposal releases them", async () => {
  vi.useFakeTimers();
  const handle = {
    state: "requested" as const,
    request: () => ({ status: "requested" as const }),
    dispose: vi.fn(),
  };
  const c = new Controller(
    urls,
    { importFiles: async () => delivered(), prepareExport: async () => ready },
    true,
    {
      createHandle: () => handle,
      now: () => 0,
      setTimer: (cb, ms) => setTimeout(cb, ms),
      clearTimer: (t) => clearTimeout(t),
    },
  );
  c.selectFiles([file()]);
  await c.startImport();
  await c.prepare("single");
  c.requestDownload();
  expect(handle.dispose).not.toHaveBeenCalled();
  c.setSelected("artifact-0", false);
  c.resetSettings();
  c.clear();
  expect(handle.dispose).not.toHaveBeenCalled();
  expect(c.downloads.count).toBe(1);
  c.dispose();
  expect(handle.dispose).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("complete UI mapping preserves child values, empty/astral bouten, HTML, and undefined stays absent", () => {
  const settings = initialSettings();
  settings.conversion = {
    ...settings.conversion,
    preserveIndentNotes: true,
    convertNyozeIndent: false,
    boutenChar: "",
    underlineOutputFormat: "html",
  };
  expect(importOptions(settings).conversion).toEqual(settings.conversion);
  settings.conversion = { ...settings.conversion, boutenChar: "😀二" };
  expect(importOptions(settings).conversion?.boutenChar).toBe("😀二");
  expect(Object.values(importOptions(settings))).not.toContain(undefined);
});
it("unknown diagnostic remains visible with generic Japanese explanation and code retained by caller", async () => {
  const { explain } = await import("../../web/diagnostics.js");
  expect(explain("FUTURE_CODE")).toContain("識別コード");
  expect(explain("JOB_TIMEOUT")).toContain("上限");
});
it("unavailable host cannot launch import/export", async () => {
  const imports = vi.fn<Services["importFiles"]>();
  const c = new Controller(
    urls,
    { importFiles: imports, prepareExport: async () => ready },
    false,
  );
  c.selectFiles([file()]);
  expect(await c.startImport()).toBe(false);
  expect(await c.prepare("zip")).toBe(false);
  expect(imports).not.toHaveBeenCalled();
  c.dispose();
});
it("download failures leave no manager timer/issued handle; retry and disposal remain possible", () => {
  vi.useFakeTimers();
  let attempts = 0;
  const failed = {
    state: "failed" as const,
    request: () => ({
      status: "failed" as const,
      diagnostic: {
        code: "DOWNLOAD_FAILED",
        severity: "error" as const,
        stage: "download" as const,
        reason: "test",
      },
    }),
    dispose: vi.fn(),
  };
  const m = new Downloads(() => {}, {
    createHandle: () => {
      attempts++;
      return failed;
    },
    now: () => 0,
    setTimer: (cb, ms) => setTimeout(cb, ms),
    clearTimer: (t) => clearTimeout(t),
  });
  expect(m.request(new Blob(), "a.md")).toContain("DOWNLOAD_FAILED");
  expect(m.count).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  expect(failed.dispose).toHaveBeenCalledOnce();
  m.request(new Blob(), "a.md");
  expect(attempts).toBe(2);
  m.dispose();
  expect(m.request(new Blob(), "a.md")).toContain("要求できません");
});
it("S5 file count copy comes from the controller list", () => {
  expect(WEB_CONTRACT).toBe("aozora-web-v6");
  expect(fileSelectionPresentation(0)).toEqual({
    action: "ファイルを選ぶ",
    status: "未選択",
  });
  expect(fileSelectionPresentation(3).status).toBe("3ファイル選択済み");
  expect(fileSelectionPresentation(3).action).toBe("ファイルを選び直す");
  expect(fileSelectionPresentation(3).status).not.toContain("未選択");
  expect(deliveryButtonLabel("single", 1)).toBe("ダウンロード用ファイルを作成");
  expect(deliveryButtonLabel("zip", 4)).toBe("ZIPファイルを作成（4件）");
  expect(PICKER_FORMATS).toBe("TXT・MD・ZIP／複数選択可");
  expect(PICKER_REPLACE).toContain("取消は現在の選択を保持");
});
it("help catalog covers encoding, organize, outputExtension, and all 23 conversion fields", () => {
  const fields = HELP_TOPICS.map((topic) => topic.apiField);
  expect(fields).toContain("encoding");
  expect(fields).toContain("organizeByAuthor");
  expect(fields).toContain("outputExtension");
  expect(fields).not.toContain("conversion.renameToMd");
  expect(Object.keys(DEFAULT_OPTIONS)).toHaveLength(23);
  for (const key of Object.keys(DEFAULT_OPTIONS))
    if (key === "headingLevels")
      for (const level of ["large", "medium", "small"])
        expect(fields).toContain("conversion.headingLevels." + level);
    else expect(fields).toContain("conversion." + key);
  for (const topic of HELP_TOPICS) {
    expect(topic.label.length).toBeGreaterThan(0);
    expect(topic.summary.length).toBeGreaterThan(0);
    expect(topic.detail.length).toBeGreaterThan(0);
    expect(topic.detail).not.toContain("出力拡張子だけ");
    expect(topic.summary).not.toContain("出力拡張子だけ");
  }
  const extension = HELP_TOPICS.find((topic) => topic.id === "outputExtension");
  expect(extension?.control).toBe("radio");
  expect(extension?.summary).toBe(
    "拡張子が変わっても変換内容は同じです。TXTにもMarkdown・Nyozeの記法が含まれます。",
  );
  expect(
    HELP_TOPICS.find((topic) => topic.id === "preserveIndentNotes")?.summary,
  ).toContain("未変換注記の一覧から除きます");
  for (const topic of HELP_TOPICS) {
    expect(topic.summary + topic.detail).not.toContain("Markdown出力では");
    expect(topic.summary + topic.detail).not.toContain("TXTのままでは");
  }
  expect(HELP_TOPICS.find((t) => t.id === "boutenChar")?.parent).toBe(
    "convertBouten",
  );
  for (const key of ["large", "medium", "small"])
    expect(HELP_TOPICS.find((t) => t.levelKey === key)).toMatchObject({
      control: "select",
      parent: "convertHeadings",
    });
});
it("S5 delivery follows 0/1/many selection, explicit choice, and busy refusal", async () => {
  const { c, imports, exports } = setup();
  expect(c.state.delivery).toBe("single");
  expect(c.setDelivery("zip")).toBe(false);
  imports.mockResolvedValueOnce(delivered("completed", 1));
  c.selectFiles([file()]);
  await c.startImport();
  expect(c.state.delivery).toBe("single");
  await c.prepare("single");
  const readyExport = c.state.exported;
  const imported = c.state.delivered;
  const selected = new Set(c.state.selected);
  expect(c.setDelivery("zip")).toBe(true);
  expect(c.state.delivery).toBe("zip");
  expect(c.state.exported).toBeUndefined();
  expect(c.state.delivered).toBe(imported);
  expect(c.state.selected).toEqual(selected);
  expect(c.downloads.count).toBe(0);
  expect(readyExport?.status).toBe("ready");
  expect(c.setDelivery("zip")).toBe(true);
  expect(c.state.exported).toBeUndefined();
  imports.mockResolvedValueOnce(delivered("completed", 3));
  c.selectFiles([file("b.txt")]);
  await c.startImport();
  expect(c.state.delivery).toBe("zip");
  expect(c.setDelivery("single")).toBe(false);
  c.setSelected("artifact-2", false);
  c.setSelected("artifact-1", false);
  expect(c.selectedArtifacts).toHaveLength(1);
  expect(c.state.delivery).toBe("single");
  expect(c.setDelivery("zip")).toBe(true);
  const pending = deferred<BrowserExportResult>();
  exports.mockReturnValueOnce(pending.promise);
  const running = c.prepare("zip");
  expect(c.setDelivery("single")).toBe(false);
  expect(c.state.delivery).toBe("zip");
  pending.resolve(ready);
  await running;
  c.selectAll(false);
  expect(c.state.delivery).toBe("single");
  expect(c.setDelivery("single")).toBe(false);
  c.dispose();
});
it("S5 opening help does not mutate import, export, or settings", async () => {
  const { c, imports, exports } = setup();
  c.selectFiles([file()]);
  await c.startImport();
  await c.prepare("single");
  const before = {
    generation: c.state.generation,
    delivered: c.state.delivered,
    exported: c.state.exported,
    settings: c.state.settings,
    files: c.state.files,
    selected: new Set(c.state.selected),
    delivery: c.state.delivery,
  };
  expect(c.openHelp("addFrontmatter")).toBe(true);
  expect(c.state.helpTopic).toBe("addFrontmatter");
  expect(c.openHelp("addFrontmatter")).toBe(true);
  expect(imports).toHaveBeenCalledTimes(1);
  expect(exports).toHaveBeenCalledTimes(1);
  expect(c.closeHelp()).toBe(true);
  expect(c.state.helpTopic).toBeUndefined();
  expect(c.closeHelp()).toBe(false);
  expect(c.state.generation).toBe(before.generation);
  expect(c.state.delivered).toBe(before.delivered);
  expect(c.state.exported).toBe(before.exported);
  expect(c.state.settings).toBe(before.settings);
  expect(c.state.files).toBe(before.files);
  expect(c.state.selected).toEqual(before.selected);
  expect(c.state.delivery).toBe(before.delivery);
  c.dispose();
  expect(c.openHelp("encoding")).toBe(false);
});
