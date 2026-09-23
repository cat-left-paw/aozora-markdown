import { createServer } from "node:http";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { resolve, sep, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { prepareExport } from "../dist/export/index.js";
import {
  runExportContract,
  exportArtifacts,
} from "../tests/browser/export-contract.mjs";

const node = await runExportContract(prepareExport);
const fixtures = Object.fromEntries(
  await Promise.all(
    ["integration.zip", "normal.zip", "bad-crc.zip"].map(async (n) => [
      n,
      [...(await readFile("tests/fixtures/zip/" + n))],
    ]),
  ),
);
const root = resolve("."),
  base = "/nested/aozora/";
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === base) {
      res.setHeader("content-type", "text/html");
      res.end(
        '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>Export test</title>',
      );
      return;
    }
    if (!url.pathname.startsWith(base)) {
      res.writeHead(404).end();
      return;
    }
    const path = resolve(
      root,
      decodeURIComponent(url.pathname.slice(base.length)),
    );
    if (!path.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    res.setHeader(
      "content-type",
      [".mjs", ".js"].includes(extname(path))
        ? "text/javascript"
        : "application/octet-stream",
    );
    res.end(await readFile(path));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const directory = await mkdtemp(join(tmpdir(), "aozora-export-"));
const report = {
  contract: "aozora-export-v1",
  startedAt: new Date().toISOString(),
  node: { version: process.version, passed: node.passed },
  completed: false,
};
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  report.chrome = browser.version();
  const page = await browser.newPage({ acceptDownloads: true });
  page.setDefaultTimeout(30000);
  const requests = [],
    errors = [],
    downloads = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("download", (d) => downloads.push(d));
  const origin = "http://127.0.0.1:" + server.address().port;
  await page.goto(origin + base);
  const result = await page.evaluate(async (rawFixtures) => {
    const { prepareExport } = await import("./dist/export/index.js");
    const { prepareBrowserExport, createDownloadHandle } = await import(
      "./dist/adapters/browser/export.js"
    );
    const { importFiles } = await import("./dist/adapters/browser/index.js");
    const { prepareImport } = await import("./dist/import/index.js");
    const { runExportContract, exportArtifacts, equal } = await import(
      "./tests/browser/export-contract.mjs"
    );
    const {
      integrationInputs,
      integrationOptions,
      validateIntegration,
      integrationText,
    } = await import("./tests/browser/import-contract.mjs");
    let sequence = 0,
      started = 0,
      terminated = 0,
      urls = 0,
      revokes = 0;
    const liveUrls = new Set();
    const createURL = URL.createObjectURL.bind(URL),
      revokeURL = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      urls++;
      const u = createURL(blob);
      liveUrls.add(u);
      return u;
    };
    URL.revokeObjectURL = (u) => {
      revokes++;
      liveUrls.delete(u);
      revokeURL(u);
    };
    const workerUrl = new URL(
      "./dist/adapters/browser/export.worker.js",
      location.href,
    );
    const workerFactory = () => {
      started++;
      const w = new Worker(workerUrl, { type: "module" }),
        terminate = w.terminate.bind(w);
      w.terminate = () => {
        terminated++;
        terminate();
      };
      return w;
    };
    const context = () => ({
      requestId: "export-" + ++sequence,
      workerFactory,
    });
    const bytesResult = async (artifacts, options) => {
      const r = await prepareBrowserExport(artifacts, options, context());
      return r.status === "ready"
        ? { ...r, bytes: new Uint8Array(await r.blob.arrayBuffer()) }
        : r;
    };
    const main = await runExportContract(prepareExport),
      worker = await runExportContract(bytesResult);
    equal(main.zip, worker.zip, "main/Worker exact ZIP");
    equal(urls, 0, "preparation does not generate URL");
    const cancellations = [];
    for (const stage of ["copy", "package", "close"]) {
      const controller = new AbortController(),
        before = terminated,
        start = performance.now();
      let reached = false;
      const input = {
        ...exportArtifacts()[0],
        bytes: new Uint8Array(stage === "package" ? 1048576 : 150000),
      };
      const r = await prepareBrowserExport(
        [input],
        { mode: "zip" },
        {
          ...context(),
          signal: controller.signal,
          onProgress: (p) => {
            if (
              p.stage === stage &&
              (stage !== "package" || p.metrics.processedBytes >= 65536)
            ) {
              reached = true;
              controller.abort();
            }
          },
        },
      );
      equal(reached, true, stage + " reached");
      equal(r.status, "cancelled", stage + " cancelled");
      equal("blob" in r, false, "no cancelled output");
      equal(r.metrics.readyFiles, 0, "cancel ready files");
      equal(r.metrics.retainedBytes, 0, "cancel retained");
      equal(terminated - before, stage === "copy" ? 0 : 1, "terminate");
      equal(
        input.bytes.length,
        stage === "package" ? 1048576 : 150000,
        "original remains attached",
      );
      cancellations.push({
        stage,
        elapsedMs: performance.now() - start,
        metrics: r.metrics,
        workersTerminated: terminated - before,
      });
      equal(
        (await prepareBrowserExport([input], { mode: "zip" }, context()))
          .status,
        "ready",
        "retry " + stage,
      );
    }
    const timeoutStart = performance.now();
    let processing = false;
    const timeout = await prepareBrowserExport(
      [{ ...exportArtifacts()[0], bytes: new Uint8Array(16 * 1048576) }],
      { mode: "zip", limits: { jobTimeoutMs: 1500 } },
      {
        ...context(),
        onProgress: (p) => {
          if (p.stage === "package" && p.metrics.processedBytes > 0)
            processing = true;
        },
      },
    );
    equal(timeout.status, "failed", "real job timeout");
    equal(timeout.diagnostics[0].code, "JOB_TIMEOUT", "timeout reason");
    equal(processing, true, "timeout during real package");
    equal("blob" in timeout, false, "timeout no Blob");
    const timeoutEvidence = {
      elapsedMs: performance.now() - timeoutStart,
      processing,
      metrics: timeout.metrics,
    };
    const missing = await prepareBrowserExport(
      exportArtifacts(),
      { mode: "zip", limits: { jobTimeoutMs: 3000 } },
      {
        requestId: "missing",
        workerUrl: new URL("./dist/missing-export-worker.js", location.href),
      },
    );
    equal(missing.status, "failed", "missing asset explicit");
    equal(missing.diagnostics[0].code, "WORKER_FAILED", "no fallback");
    const beforeBlobFailure = terminated;
    const blobFailure = await prepareBrowserExport(
      exportArtifacts(),
      { mode: "zip" },
      {
        ...context(),
        createBlob() {
          throw Error("injected-delivery-failure");
        },
      },
    );
    equal(
      blobFailure.status,
      "failed",
      "real Worker then injected Blob failure",
    );
    equal(
      blobFailure.diagnostics[0].code,
      "BLOB_FAILED",
      "Blob failure diagnostic",
    );
    equal("blob" in blobFailure, false, "Blob failure exposes no output");
    equal(terminated, beforeBlobFailure + 1, "Blob failure Worker cleanup");
    equal(urls, 0, "Blob failure URL zero");
    const parallel = await Promise.all([
      prepareBrowserExport(exportArtifacts(), { mode: "zip" }, context()),
      prepareBrowserExport(
        exportArtifacts(),
        { mode: "zip", limits: { maxOutputBytes: 1 } },
        context(),
      ),
    ]);
    equal(
      parallel.map((r) => r.status),
      ["ready", "failed"],
      "parallel limits",
    );
    const fixtures = Object.fromEntries(
      Object.entries(rawFixtures).map(([k, v]) => [k, new Uint8Array(v)]),
    );
    const inputs = integrationInputs(fixtures),
      asFiles = (items) =>
        items.map((i) => ({
          id: i.id,
          kind: i.kind,
          file: new File([i.bytes], i.name),
        }));
    const importContext = () => ({
      requestId: "import-" + ++sequence,
      attemptId: "1",
      workerUrl: new URL(
        "./dist/adapters/browser/import.worker.js",
        location.href,
      ),
    });
    const delivered = await importFiles(
      asFiles(inputs),
      integrationOptions,
      importContext(),
    );
    validateIntegration(delivered.result);
    const partial = await importFiles(
      asFiles([
        ...inputs,
        {
          id: "bad",
          kind: "zip",
          name: "bad.zip",
          bytes: fixtures["bad-crc.zip"],
        },
      ]),
      integrationOptions,
      importContext(),
    );
    equal(partial.result.status, "partial", "partial import");
    equal(partial.artifacts.length, 9, "only good import artifacts");
    equal(partial.result.diagnostics.length > 0, true, "partial diagnostics");
    const before = JSON.stringify({
      result: partial.result,
      stats: partial.stats,
    });
    const selected = [
      partial.artifacts[8],
      partial.artifacts[0],
      partial.artifacts[3],
    ];
    const expectedBodies = [
      '---\ntitle: 再入力\nraw_header: " 題\\n "\n---\n本文',
      "## ｜青《﹅》",
      "FIRST",
    ];
    equal(
      selected.map((a) => new TextDecoder().decode(a.bytes)),
      expectedBodies,
      "independent converted expectations",
    );
    const integration = await prepareBrowserExport(
      selected,
      { mode: "zip", archiveName: "選択結果.zip" },
      context(),
    );
    equal(integration.status, "ready", "selected partial ZIP");
    const refused = await prepareBrowserExport(
      selected,
      { mode: "zip", limits: { maxOutputBytes: 1 } },
      context(),
    );
    equal(
      refused.status,
      "failed",
      "partial import export may fail independently",
    );
    equal("blob" in refused, false, "failed partial export has no output");
    equal(
      JSON.stringify({ result: partial.result, stats: partial.stats }),
      before,
      "export failure preserves prior import",
    );
    equal(
      [
        ...new Uint8Array(
          await (
            await prepareBrowserExport(
              selected,
              { mode: "zip", archiveName: "選択結果.zip" },
              context(),
            )
          ).blob.arrayBuffer(),
        ),
      ],
      [...new Uint8Array(await integration.blob.arrayBuffer())],
      "repeat ZIP bytes",
    );
    equal(
      JSON.stringify({ result: partial.result, stats: partial.stats }),
      before,
      "no import mutations/recommits",
    );
    // Same realm in both orders, built bundles and independent jobs.
    const mainImport = await prepareImport(inputs, integrationOptions);
    validateIntegration(mainImport);
    equal(
      [...(await prepareExport(exportArtifacts(), { mode: "zip" })).bytes],
      main.zip,
      "import/export realm setting isolation",
    );
    equal(started, terminated, "all export Workers terminated");
    equal(urls, 0, "all preparations URL zero");
    const md = await prepareBrowserExport(
      [
        {
          ...exportArtifacts()[0],
          blob: new Blob(["stale"]),
          conversion: { text: "stale" },
        },
      ],
      { mode: "single" },
      context(),
    );
    const txt = await prepareBrowserExport(
      [
        {
          ...exportArtifacts()[0],
          format: "txt",
          relativePath: "著者/日本語.txt",
        },
      ],
      { mode: "single" },
      context(),
    );
    const zip = await prepareBrowserExport(
      exportArtifacts(),
      { mode: "zip" },
      context(),
    );
    equal(
      [...new Uint8Array(await md.blob.arrayBuffer())],
      [...exportArtifacts()[0].bytes],
      "stale Blob ignored in real Chrome",
    );
    equal(
      [...new Uint8Array(await txt.blob.arrayBuffer())],
      [...exportArtifacts()[0].bytes],
      "single TXT opaque bytes before download",
    );
    window.exportTest = {
      handles: [],
      results: [],
      partial,
      before,
      urlCounts: () => ({ urls, revokes, live: liveUrls.size }),
      downloadInputs: [],
    };
    for (const [label, r] of [
      ["md", md],
      ["txt", txt],
      ["zip", zip],
      ["integration", integration],
      ["again", integration],
    ]) {
      equal(r.status, "ready", label + " ready");
      const handle = createDownloadHandle(r.blob, r.filename),
        button = document.createElement("button");
      window.exportTest.handles.push(handle);
      window.exportTest.downloadInputs.push({
        label,
        filename: r.filename,
        bytes: [...new Uint8Array(await r.blob.arrayBuffer())],
      });
      button.id = "download-" + label;
      button.textContent = label;
      button.onclick = () => window.exportTest.results.push(handle.request());
      document.body.appendChild(button);
    }
    return {
      main: { passed: main.passed },
      worker: { passed: worker.passed, started, terminated },
      zip: main.zip,
      cancellations,
      timeout: timeoutEvidence,
      partial: {
        status: partial.result.status,
        diagnostics: partial.result.diagnostics,
        stats: partial.stats,
      },
      integrationExpected: selected.map((a, i) => ({
        relativePath: a.relativePath,
        bytes: [...new TextEncoder().encode(expectedBodies[i])],
      })),
      downloadInputs: window.exportTest.downloadInputs,
      missing: missing.diagnostics[0].code,
    };
  }, fixtures);
  assert.deepEqual(result.zip, node.zip);
  assert.equal(downloads.length, 0, "preparation emits no downloads");
  const zipExpected = exportArtifacts().map((a) => ({
    relativePath: a.relativePath,
    base64: Buffer.from(a.bytes).toString("base64"),
  }));
  const downloadEvidence = [];
  for (let i = 0; i < result.downloadInputs.length; i++) {
    const input = result.downloadInputs[i];
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#download-" + input.label).click(),
    ]);
    assert.equal(download.suggestedFilename(), input.filename);
    const path = join(directory, String(i));
    await download.saveAs(path);
    assert.equal(await download.failure(), null);
    const bytes = await readFile(path);
    assert.deepEqual([...bytes], input.bytes);
    if (["zip", "integration", "again"].includes(input.label)) {
      const entries =
        input.label === "zip"
          ? zipExpected
          : result.integrationExpected.map((a) => ({
              relativePath: a.relativePath,
              base64: Buffer.from(a.bytes).toString("base64"),
            }));
      const independent = spawnSync(
        "python3",
        ["scripts/check_export_zip.py"],
        {
          input: JSON.stringify({ zip: bytes.toString("base64"), entries }),
          encoding: "utf8",
        },
      );
      assert.equal(independent.status, 0, independent.stderr);
    }
    // Test knows acquisition completed. Product handle cannot observe this event.
    const counts = await page.evaluate((i) => {
      const t = window.exportTest;
      const h = t.handles[i];
      if (h.request().status !== "failed") throw Error("duplicate click");
      h.dispose();
      h.dispose();
      return t.urlCounts();
    }, i);
    assert.equal(counts.live, 0);
    assert.equal(counts.urls, i + 1);
    assert.equal(counts.revokes, i + 1);
    downloadEvidence.push({
      label: input.label,
      filename: input.filename,
      byteLength: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      counts,
    });
  }
  assert.equal(downloads.length, 5);
  const cleanup = await page.evaluate(() => {
    const t = window.exportTest;
    if (
      JSON.stringify({ result: t.partial.result, stats: t.partial.stats }) !==
      t.before
    )
      throw Error("download changed import stats");
    return {
      states: t.handles.map((h) => h.state),
      requests: t.results,
      urlCounts: t.urlCounts(),
      anchors: document.querySelectorAll("a").length,
    };
  });
  assert.deepEqual(cleanup.states, Array(5).fill("disposed"));
  assert.equal(cleanup.anchors, 0);
  assert.deepEqual(cleanup.requests, Array(5).fill({ status: "requested" }));
  const allowed = [
    "",
    "dist/export/index.js",
    "dist/import/index.js",
    "dist/adapters/browser/export.js",
    "dist/adapters/browser/index.js",
    "tests/browser/export-contract.mjs",
    "tests/browser/import-contract.mjs",
    "dist/adapters/browser/export.worker.js",
    "dist/adapters/browser/import.worker.js",
    "dist/missing-export-worker.js",
  ];
  const unexpected = requests.filter(
    (url) =>
      !url.startsWith(origin + base) ||
      !allowed.includes(url.slice((origin + base).length)),
  );
  assert.deepEqual(unexpected, []);
  assert.deepEqual(errors, []);
  delete result.downloadInputs;
  delete result.zip;
  Object.assign(report, result, {
    downloads: downloadEvidence,
    cleanup,
    requests,
    unexpectedNetwork: unexpected,
    pageErrors: errors,
    completed: true,
    finishedAt: new Date().toISOString(),
  });
  console.log(
    JSON.stringify({
      node: report.node,
      main: report.main,
      worker: report.worker,
      downloads: downloadEvidence.map((d) => ({
        label: d.label,
        bytes: d.byteLength,
      })),
      completed: true,
    }),
  );
} finally {
  await writeFile(
    "reports/export-browser-smoke.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser?.close();
  await new Promise((done) => server.close(done));
  await rm(directory, { recursive: true, force: true });
}
