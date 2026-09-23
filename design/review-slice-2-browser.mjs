import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { chromium } from "playwright";
const root = resolve(".");
const cases = JSON.parse(
  await readFile("reports/review-slice-2-inputs.json", "utf8"),
);
const server = createServer(async (req, res) => {
  try {
    if (req.url === "/review/") {
      res.setHeader("content-type", "text/html");
      res.end(
        '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,">',
      );
      return;
    }
    const path = resolve(
      root,
      decodeURIComponent(req.url.slice("/review/".length)),
    );
    if (!path.startsWith(root + sep)) throw Error();
    res.setHeader("content-type", "text/javascript");
    res.end(await readFile(path));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:" + server.address().port + "/review/");
  const evidence = await page.evaluate(async (cases) => {
    const { prepareImport } = await import("./dist/import/index.js");
    const { importFiles } = await import("./dist/adapters/browser/index.js");
    const options = {
      conversion: {
        addFrontmatter: false,
        removeAnnotationBlocks: false,
        removeAozoraFooter: false,
      },
    };
    const result = [];
    for (const c of cases) {
      const input = {
        id: c.name,
        name: c.name + ".zip",
        kind: "zip",
        bytes: new Uint8Array(c.bytes),
      };
      const direct = await prepareImport([input], options);
      const delivered = await importFiles(
        [{ id: input.id, file: new File([input.bytes], input.name) }],
        options,
        {
          requestId: c.name,
          attemptId: "review-1",
          workerUrl: new URL(
            "./dist/adapters/browser/import.worker.js",
            location.href,
          ),
        },
      );
      result.push({
        name: c.name,
        expected: c.shouldPass ? "completed" : "failed",
        main: {
          status: direct.status,
          text: direct.artifacts.map((a) => a.conversion.text),
        },
        worker: {
          status: delivered.result.status,
          text: await Promise.all(
            delivered.artifacts.map((a) => a.blob.text()),
          ),
          artifactFiles: delivered.stats.artifactFiles,
          savedFiles: delivered.stats.savedFiles,
          diagnostics: delivered.result.diagnostics,
        },
      });
    }
    return result;
  }, cases);
  const report = { chrome: browser.version(), cases: evidence };
  await writeFile(
    "reports/review-slice-2-browser.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  const mismatches = evidence.filter(
    (c) => c.main.status !== c.expected || c.worker.status !== c.expected,
  );
  console.log(
    JSON.stringify({
      chrome: report.chrome,
      cases: evidence.length,
      matched: evidence.length - mismatches.length,
      mismatches: mismatches.map((c) => c.name),
    }),
  );
  if (mismatches.length) process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
