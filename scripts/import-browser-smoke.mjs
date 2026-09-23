import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { chromium } from "playwright";
import { prepareImport } from "../dist/import/index.js";
import { runContract } from "../tests/browser/import-contract.mjs";
const manifest = JSON.parse(
  await readFile("tests/fixtures/zip/manifest.json", "utf8"),
);
const fixtures = Object.fromEntries(
  await Promise.all(
    Object.keys(manifest.files).map(async (name) => [
      name,
      new Uint8Array(await readFile("tests/fixtures/zip/" + name)),
    ]),
  ),
);
const node = await runContract(prepareImport, fixtures);
const root = resolve("."),
  base = "/nested/aozora/";
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === base) {
      res.setHeader("content-type", "text/html");
      res.end(
        '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>Aozora import test</title>',
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
      [".js", ".mjs"].includes(extname(path))
        ? "text/javascript"
        : "application/octet-stream",
    );
    res.end(await readFile(path));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
let browser;
const report = {
  contract: "aozora-import-v2",
  startedAt: new Date().toISOString(),
  node: { version: process.version, passed: node.passed },
  completed: false,
};
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  report.chrome = browser.version();
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  const requests = [],
    errors = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("pageerror", (e) => errors.push(e.message));
  const origin = "http://127.0.0.1:" + server.address().port;
  await page.goto(origin + base);
  const start = Date.now();
  const result = await page.evaluate(
    async (rawFixtures) => {
      const fixtures = Object.fromEntries(
        Object.entries(rawFixtures).map(([key, val]) => [
          key,
          new Uint8Array(val),
        ]),
      );
      const { prepareImport } = await import("./dist/import/index.js");
      const { importFiles } = await import("./dist/adapters/browser/index.js");
      const { runContract, equal, plain } = await import(
        "./tests/browser/import-contract.mjs"
      );
      const workerUrl = new URL(
        "./dist/adapters/browser/import.worker.js",
        location.href,
      );
      let started = 0,
        terminated = 0,
        sequence = 0;
      const workerFactory = () => {
        started++;
        const worker = new Worker(workerUrl, { type: "module" });
        const terminate = worker.terminate.bind(worker);
        worker.terminate = () => {
          terminated++;
          terminate();
        };
        return worker;
      };
      const context = () => ({
        requestId: "job-" + ++sequence,
        attemptId: "attempt-1",
        workerFactory,
      });
      const asFiles = (inputs) =>
        inputs.map((i) => ({
          id: i.id,
          kind: i.kind,
          file: new File([i.bytes], i.name, { type: "wrong/mime" }),
        }));
      const main = await runContract(prepareImport, fixtures);
      const deliveries = [];
      const worker = await runContract(async (inputs, options) => {
        const delivered = await importFiles(
          asFiles(inputs),
          options,
          context(),
        );
        deliveries.push(delivered);
        equal(delivered.stats.savedFiles, 0, "no OS save");
        equal(
          delivered.stats.artifactFiles,
          delivered.artifacts.length,
          "commit count",
        );
        for (const a of delivered.artifacts)
          equal(await a.blob.text(), a.conversion.text, "Blob UTF8");
        return delivered.result;
      }, fixtures);
      equal(
        worker.integration,
        main.integration,
        "real main/Worker full result parity",
      );
      equal(deliveries[0].stats.artifactFiles, 9, "integration commits");
      equal(deliveries[0].stats.remainingNotes, 1, "integration residual");
      equal(deliveries[0].stats.filesSkipped, 3, "ignored entries");
      const cancellations = [];
      for (const stage of ["reading", "converting"]) {
        const abort = new AbortController();
        let reached = false;
        const inputs =
          stage === "reading"
            ? [
                {
                  id: "cancel",
                  kind: "zip",
                  name: "cancel.zip",
                  bytes: fixtures["cancel.zip"],
                },
              ]
            : [
                {
                  id: "core",
                  kind: "txt",
                  name: "core.txt",
                  bytes: new TextEncoder().encode(
                    "青［＃「青」は太字］\n".repeat(50000),
                  ),
                },
              ];
        const beforeTerminated = terminated,
          startedAt = performance.now();
        const r = await importFiles(asFiles(inputs), plain, {
          ...context(),
          signal: abort.signal,
          onProgress: (p) => {
            if (p.stage === stage) {
              reached = true;
              abort.abort();
              abort.abort();
            }
          },
        });
        equal(reached, true, stage + " reached");
        equal(r.result.status, "cancelled", stage + " cancellation");
        equal(r.artifacts.length, 0, "cancel artifact count");
        equal(r.stats.filesConverted, 0, "cancel commit count");
        equal(r.stats.remainingNotes, 0, "cancel remaining count");
        equal(terminated, beforeTerminated + 1, "owned worker terminated");
        const elapsedMs = performance.now() - startedAt;
        if (elapsedMs > 5000) throw Error("cancellation watchdog exceeded");
        cancellations.push({
          stage,
          elapsedMs,
          reached,
          status: r.result.status,
          terminated: true,
          metricsAtTermination: r.result.metrics,
        });
        const next = await importFiles(
          asFiles([
            {
              id: "next",
              kind: "zip",
              name: "cp437.zip",
              bytes: fixtures["cp437.zip"],
            },
          ]),
          plain,
          context(),
        );
        equal(next.result.status, "completed", "restart after " + stage);
      }
      let converting = false;
      const timeoutStart = performance.now();
      const timeout = await importFiles(
        asFiles([
          {
            id: "slow",
            kind: "txt",
            name: "slow.txt",
            bytes: new TextEncoder().encode(
              "青［＃「青」は太字］\n".repeat(100000),
            ),
          },
        ]),
        { ...plain, limits: { jobTimeoutMs: 1000 } },
        {
          ...context(),
          onProgress: (p) => {
            if (p.stage === "converting") converting = true;
          },
        },
      );
      equal(converting, true, "timeout reaches synchronous conversion");
      equal(timeout.result.status, "failed", "timeout failure");
      equal(
        timeout.result.diagnostics.at(-1).code,
        "JOB_TIMEOUT",
        "timeout reason",
      );
      equal(timeout.stats.filesConverted, 0, "timeout no commit");
      const timeoutMs = performance.now() - timeoutStart;
      const next = await importFiles(
        asFiles([
          {
            id: "restart",
            kind: "zip",
            name: "normal.zip",
            bytes: fixtures["normal.zip"],
          },
        ]),
        plain,
        context(),
      );
      equal(next.result.status, "completed", "restart after timeout");
      const missing = await importFiles(
        asFiles([
          {
            id: "missing",
            kind: "txt",
            name: "missing.txt",
            bytes: new TextEncoder().encode("ok"),
          },
        ]),
        { limits: { jobTimeoutMs: 3000 } },
        {
          requestId: "missing",
          attemptId: "1",
          workerUrl: new URL("./dist/missing-worker.js", location.href),
        },
      );
      equal(missing.result.status, "failed", "missing worker explicit failure");
      equal(missing.stats.artifactFiles, 0, "missing worker no main fallback");
      equal(started, terminated, "all owned workers released");
      return {
        main: { passed: main.passed },
        worker: { passed: worker.passed, started, terminated },
        cancellations,
        timeout: {
          converting,
          elapsedMs: timeoutMs,
          status: timeout.result.status,
        },
        missingAsset: missing.result.diagnostics.at(-1).code,
        additionalChecks: 7,
      };
    },
    Object.fromEntries(
      Object.entries(fixtures).map(([name, bytes]) => [name, [...bytes]]),
    ),
  );
  const allowed = [
    "",
    "dist/import/index.js",
    "dist/adapters/browser/index.js",
    "tests/browser/import-contract.mjs",
    "dist/adapters/browser/import.worker.js",
    "dist/missing-worker.js",
  ];
  const unexpected = requests.filter(
    (url) =>
      !allowed.includes(url.replace(origin + base, "")) ||
      !url.startsWith(origin + base),
  );
  if (unexpected.length)
    throw Error("Unexpected network: " + JSON.stringify(unexpected));
  if (errors.length) throw Error("Page errors: " + JSON.stringify(errors));
  Object.assign(report, result, {
    durationMs: Date.now() - start,
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
      cancellations: report.cancellations.map((c) => ({
        stage: c.stage,
        elapsedMs: c.elapsedMs,
      })),
      timeout: report.timeout,
      completed: true,
    }),
  );
} finally {
  await writeFile(
    "reports/import-browser-smoke.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser?.close();
  await new Promise((done) => server.close(done));
}
