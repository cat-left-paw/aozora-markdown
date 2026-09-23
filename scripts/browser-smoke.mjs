import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { chromium } from "playwright";
import { run } from "../tests/browser/contract.mjs";
import { pipelineCasesV3 } from "../tests/reference/v3Overlay.mjs";
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
// aozora-ts-v3: v2 golden + schema projection + design/compatibility-v3.json.
const cases = pipelineCasesV3(
  await json("design/fixtures/pipeline-fixtures.json"),
  await json("tests/fixtures/pipeline-v2.json"),
  await json("design/compatibility-v3.json"),
)
  .filter((c) => c.caseKey.startsWith("pipeline:"))
  .map((c) => ({
    id: c.id,
    input: c.input,
    options: c.conversion,
    expected: c.expected.core,
  }));
const nodeResult = run(cases);
const root = resolve(".");
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/") {
      res.setHeader("content-type", "text/html");
      res.end(
        '<!doctype html><meta charset="utf-8"><title>Aozora ESM test</title>',
      );
      return;
    }
    const path = resolve(root, "." + decodeURIComponent(url.pathname));
    if (!path.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    res.setHeader(
      "content-type",
      extname(path) === ".js" || extname(path) === ".mjs"
        ? "text/javascript"
        : "application/json",
    );
    res.end(await readFile(path));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://127.0.0.1:" + server.address().port);
  const main = await page.evaluate(async (cases) => {
    const { run } = await import("/tests/browser/contract.mjs");
    return run(cases);
  }, cases);
  const worker = await page.evaluate(
    (cases) =>
      new Promise((resolve, reject) => {
        const worker = new Worker("/tests/browser/worker.mjs", {
          type: "module",
        });
        const timer = setTimeout(() => {
          worker.terminate();
          reject(new Error("Worker timeout"));
        }, 30000);
        worker.onerror = (e) => {
          clearTimeout(timer);
          worker.terminate();
          reject(new Error(e.message));
        };
        worker.onmessage = ({ data }) => {
          clearTimeout(timer);
          worker.terminate();
          data.error ? reject(new Error(data.error)) : resolve(data.result);
        };
        worker.postMessage(cases);
      }),
    cases,
  );
  if (errors.length) throw new Error(errors.join("\n"));
  const result = {
    command: "npm run test:browser",
    browser: "Google Chrome",
    version: browser.version(),
    userAgent: await page.evaluate(() => navigator.userAgent),
    platform: process.platform,
    node: process.version,
    builtESM: true,
    moduleWorker: true,
    nodeResult,
    main,
    worker,
  };
  await writeFile(
    "reports/browser-smoke.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    `PASS Google Chrome ${result.version}: ${main.caseIds.length + main.additional.length + main.reviewCases.length} cases each in built Node ESM / browser ESM / module Worker`,
  );
} finally {
  if (browser) await browser.close();
  await new Promise((done) => server.close(done));
}
