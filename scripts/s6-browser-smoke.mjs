// S6: the same inputs in real Chrome (library main thread, owned Worker, built Web)
// with both output extensions. Expected bodies and paths are written by hand from
// the S6 specification; ZIP bytes are read back by scripts/check_export_zip.py.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { crc32 } from "node:zlib";
import { createHash } from "node:crypto";
import { createWebServer } from "./serve-web.mjs";
import { DEFAULT_OPTIONS } from "../dist/index.js";
import { prepareImport } from "../dist/import/index.js";

const report = {
  contract: "aozora-web-v3",
  importContract: "aozora-import-v2",
  startedAt: new Date().toISOString(),
  node: process.version,
  checks: [],
  downloads: [],
  completed: false,
};
const check = (label, actual, expected) => {
  assert.deepEqual(actual, expected, label);
  report.checks.push(label);
};
const utf8 = (s) => Buffer.from(s, "utf8");

function storedZip(entries) {
  const locals = [],
    centrals = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const n = utf8(name),
      body = utf8(text),
      crc = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, n, body);
    centrals.push(central, n);
    offset += 30 + n.length + body.length;
  }
  const dir = Buffer.concat(centrals),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

const source =
  "題\n著者\n\n章［＃「章」は大見出し］\n青［＃「青」は太字］※［＃「米＋羔」、U+7CD5］\n";
// Hand-derived: frontmatter replaces the header and its blank line, large → level 2,
// bold → **…**, the JIS/Unicode gaiji note → the character itself. Same for both extensions.
const converted = "---\ntitle: 題\nauthor: 著者\n---\n## 章\n**青**糕\n";
const inputs = [
  { id: "t", kind: "txt", name: "作品.txt", bytes: utf8(source) },
  { id: "m", kind: "md", name: "作品2.md", bytes: utf8(source) },
  {
    id: "z",
    kind: "zip",
    name: "本.zip",
    bytes: storedZip([["章/作品.txt", source]]),
  },
];
// A loose input keeps its basename reserved, so only a same-extension output gets `_converted`.
// ZIP entries are placed under the archive stem and never collide with loose names.
const expectedPaths = {
  md: ["作品.md", "作品2_converted.md", "本/章/作品.md"],
  txt: ["作品_converted.txt", "作品2.txt", "本/章/作品.txt"],
};
const mime = {
  md: "text/markdown;charset=utf-8",
  txt: "text/plain;charset=utf-8",
};

function independentZip(label, bytes, entries) {
  const run = spawnSync("python3", ["scripts/check_export_zip.py"], {
    input: JSON.stringify({
      zip: Buffer.from(bytes).toString("base64"),
      entries: entries.map(([relativePath, text]) => ({
        relativePath,
        base64: utf8(text).toString("base64"),
      })),
    }),
    encoding: "utf8",
  });
  check(label + " independent ZIP reader", run.status, 0);
  if (run.status) throw Error(run.stderr);
}

const plainOptions = (ext) => ({
  outputExtension: ext,
  conversion: { addFrontmatter: true },
});
const summarize = (r) => ({
  status: r.status,
  artifacts: r.artifacts.map((a) => ({
    relativePath: a.relativePath,
    format: a.format,
    text: new TextDecoder().decode(a.bytes),
    core: a.conversion,
  })),
  outcomes: r.outcomes,
  diagnostics: r.diagnostics,
});

const nodeRuns = {};
for (const ext of ["md", "txt"]) {
  const r = await prepareImport(inputs, plainOptions(ext));
  check("node " + ext + " status", r.status, "completed");
  check(
    "node " + ext + " paths",
    r.artifacts.map((a) => a.relativePath),
    expectedPaths[ext],
  );
  check(
    "node " + ext + " formats",
    r.artifacts.map((a) => a.format),
    [ext, ext, ext],
  );
  for (const a of r.artifacts)
    check(
      "node " + ext + " bytes " + a.relativePath,
      Buffer.from(a.bytes),
      utf8(converted),
    );
  nodeRuns[ext] = summarize(r);
}
check(
  "node core identical across extensions",
  nodeRuns.md.artifacts.map((a) => a.core),
  nodeRuns.txt.artifacts.map((a) => a.core),
);
const defaultRun = await prepareImport(inputs.slice(0, 1), {});
check("import default extension is md", defaultRun.artifacts[0].format, "md");

const temp = await mkdtemp(join(tmpdir(), "aozora-s6-"));
let browser, repo, web;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  report.chrome = browser.version();

  // Library: prepareImport on the Chrome main thread and importFiles through an owned Worker.
  repo = await createWebServer({ root: "." });
  const lib = await browser.newPage();
  lib.setDefaultTimeout(30000);
  const libErrors = [];
  lib.on("pageerror", (e) => libErrors.push(e.message));
  await lib.route(repo.url + "s6.html", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>S6</title>',
    }),
  );
  await lib.goto(repo.url + "s6.html");
  const inBrowser = await lib.evaluate(
    async ({ raw, exts }) => {
      const { prepareImport } = await import("/dist/import/index.js");
      const { importFiles } = await import("/dist/adapters/browser/index.js");
      const workerUrl = new URL(
        "/dist/adapters/browser/import.worker.js",
        location.href,
      );
      const inputs = raw.map((i) => ({ ...i, bytes: new Uint8Array(i.bytes) }));
      const summarize = (r) => ({
        status: r.status,
        artifacts: r.artifacts.map((a) => ({
          relativePath: a.relativePath,
          format: a.format,
          text: new TextDecoder().decode(a.bytes),
          core: a.conversion,
        })),
        outcomes: r.outcomes,
        diagnostics: r.diagnostics,
      });
      let started = 0,
        terminated = 0;
      const out = {};
      for (const ext of exts) {
        const options = {
          outputExtension: ext,
          conversion: { addFrontmatter: true },
        };
        const main = await prepareImport(inputs, options);
        const delivered = await importFiles(
          inputs.map((i) => ({
            id: i.id,
            kind: i.kind,
            file: new File([i.bytes], i.name, { type: "wrong/mime" }),
          })),
          options,
          {
            requestId: "s6-" + ext,
            attemptId: "a1",
            workerFactory: () => {
              started++;
              const w = new Worker(workerUrl, { type: "module" });
              const t = w.terminate.bind(w);
              w.terminate = () => {
                terminated++;
                t();
              };
              return w;
            },
          },
        );
        out[ext] = {
          main: summarize(main),
          worker: summarize(delivered.result),
          blobs: await Promise.all(
            delivered.artifacts.map(async (a) => ({
              type: a.blob.type,
              text: await a.blob.text(),
            })),
          ),
          stats: delivered.stats,
        };
      }
      return { out, started, terminated };
    },
    {
      raw: inputs.map((i) => ({ ...i, bytes: [...i.bytes] })),
      exts: ["md", "txt"],
    },
  );
  for (const ext of ["md", "txt"]) {
    const r = inBrowser.out[ext];
    check("chrome main " + ext + " equals node", r.main, nodeRuns[ext]);
    check("chrome Worker " + ext + " equals node", r.worker, nodeRuns[ext]);
    check(
      "Worker Blob " + ext + " MIME and text",
      r.blobs,
      expectedPaths[ext].map(() => ({ type: mime[ext], text: converted })),
    );
    check("Worker stats " + ext + " commits", r.stats.artifactFiles, 3);
  }
  check(
    "one owned Worker per job, all terminated",
    [inBrowser.started, inBrowser.terminated],
    [2, 2],
  );
  check("library page errors", libErrors, []);
  await lib.close();

  // Built Web: UI defaults, explanations and real downloads for both extensions.
  web = await createWebServer();
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1100 },
  });
  await context.addInitScript(() => {
    const types = (window.__s6BlobTypes = []);
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (b) => {
      types.push(b.type);
      return create(b);
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [],
    network = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => network.push(r.url()));
  await page.goto(web.url);
  const button = (name) => page.getByRole("button", { name, exact: true });
  const idle = () =>
    page.waitForFunction(() => document.querySelector("#cancel").disabled);
  const expectDefaults = async (when) => {
    const ui = await page.evaluate(() => {
      const value = (key) => {
        const el = document.querySelector(`[data-setting-id="${key}"]`);
        return el?.value;
      };
      return {
        md: document.querySelector("#output-extension-md").checked,
        txt: document.querySelector("#output-extension-txt").checked,
        summary: document.querySelector("#summary-outputExtension").textContent,
        boutenChar: value("boutenChar"),
        underlineOutputFormat: value("underlineOutputFormat"),
        levels: Object.fromEntries(
          ["large", "medium", "small"].map((k) => [
            k,
            Number(value("headingLevel-" + k)),
          ]),
        ),
        notice: document.querySelector("#conversion-mode").hidden,
      };
    });
    const booleans = Object.keys(DEFAULT_OPTIONS).filter(
      (k) => typeof DEFAULT_OPTIONS[k] === "boolean",
    );
    const uiBooleans = await page.evaluate(
      (keys) =>
        Object.fromEntries(
          keys.map((k) => [
            k,
            document.querySelector("#option-" + k)?.checked ?? null,
          ]),
        ),
      booleans,
    );
    check(
      when + " " + "UI checkboxes equal model defaults",
      uiBooleans,
      Object.fromEntries(booleans.map((k) => [k, DEFAULT_OPTIONS[k]])),
    );
    check(
      when + " " + "UI selects equal model defaults",
      {
        boutenChar: ui.boutenChar,
        underlineOutputFormat: ui.underlineOutputFormat,
        levels: ui.levels,
      },
      {
        boutenChar: DEFAULT_OPTIONS.boutenChar,
        underlineOutputFormat: DEFAULT_OPTIONS.underlineOutputFormat,
        levels: { ...DEFAULT_OPTIONS.headingLevels },
      },
    );
    check(
      when + " " + "UI extension equals import default (md)",
      [ui.md, ui.txt],
      [true, false],
    );
    check(
      when + " " + "UI explains extension invariance",
      ui.summary,
      "拡張子が変わっても変換内容は同じです。TXTにもMarkdown・Nyozeの記法が含まれます。",
    );
    check(when + " " + "defaults are not all-OFF", ui.notice, true);
  };
  await expectDefaults("initial");

  const acquire = async (label, expectedName) => {
    const [d] = await Promise.all([
      page.waitForEvent("download"),
      button("ダウンロード").click(),
    ]);
    check(label + " filename", d.suggestedFilename(), expectedName);
    const path = join(temp, String(report.downloads.length));
    await d.saveAs(path);
    check(label + " acquisition", await d.failure(), null);
    const bytes = await readFile(path);
    report.downloads.push({
      label,
      filename: d.suggestedFilename(),
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    return bytes;
  };
  const lastBlobType = () => page.evaluate(() => window.__s6BlobTypes.at(-1));
  for (const ext of ["md", "txt"]) {
    await page.getByRole("radio", { name: "." + ext, exact: true }).check();
    await page.locator("#files").setInputFiles(
      inputs.map((i) => ({
        name: i.name,
        mimeType: "application/octet-stream",
        buffer: Buffer.from(i.bytes),
      })),
    );
    await button("変換を開始").click();
    await idle();
    const listed = await page.locator("#results").textContent();
    check(
      "Web " + ext + " lists every planned path",
      expectedPaths[ext].map((p) => listed.includes(p.split("/").at(-1))),
      [true, true, true],
    );
    await button("選択を解除").click();
    await page
      .getByLabel("出力を選択: " + expectedPaths[ext][0], { exact: true })
      .check();
    await page.locator("#delivery-single").check();
    await button("ダウンロード用ファイルを作成").click();
    await idle();
    const single = await acquire("Web single " + ext, expectedPaths[ext][0]);
    check("Web single " + ext + " bytes", single, utf8(converted));
    check("Web single " + ext + " MIME", await lastBlobType(), mime[ext]);
    await button("全出力を選択").click();
    await page
      .getByRole("radio", { name: "ZIPにまとめる", exact: true })
      .check();
    await button("ZIPファイルを作成（3件）").click();
    await idle();
    const zip = await acquire("Web ZIP " + ext, "aozora-markdown.zip");
    check("Web ZIP " + ext + " MIME", await lastBlobType(), "application/zip");
    independentZip(
      "Web ZIP " + ext,
      zip,
      expectedPaths[ext].map((p) => [p, converted]),
    );
  }
  // Real history navigation: a fresh model must win over any browser form-state restoration.
  await page.locator("#advanced > summary").click();
  await page.locator("#heading-level-large").selectOption("5");
  await page.locator("#option-convertGaiji").uncheck();
  await page.locator("#option-addFrontmatter").uncheck();
  check(
    "changed before navigation",
    await page.evaluate(() => [
      document.querySelector("#output-extension-txt").checked,
      document.querySelector("#heading-level-large").value,
      document.querySelector("#option-convertGaiji").checked,
    ]),
    [true, "5", false],
  );
  await page.getByRole("link", { name: "MIT License", exact: true }).click();
  await page.goBack();
  await page.waitForFunction(
    () => document.querySelector("#boot-error").hidden,
  );
  report.navigationType = await page.evaluate(
    () => performance.getEntriesByType("navigation")[0]?.type,
  );
  await expectDefaults("after history navigation");
  await page.locator("#files").setInputFiles([
    {
      name: inputs[0].name,
      mimeType: "application/octet-stream",
      buffer: Buffer.from(inputs[0].bytes),
    },
  ]);
  await button("変換を開始").click();
  await idle();
  await button("ダウンロード用ファイルを作成").click();
  await idle();
  check(
    "after history navigation the job uses the displayed defaults",
    await acquire("Web after navigation", "作品.md"),
    utf8(converted),
  );
  check("Web page errors", errors, []);
  check(
    "no external network",
    network.filter((u) => !u.startsWith(web.url)),
    [],
  );
  report.completed = true;
} finally {
  await browser?.close();
  await repo?.close();
  await web?.close();
  await mkdir("reports", { recursive: true });
  await writeFile(
    "reports/s6-browser-smoke.json",
    JSON.stringify(report, null, 2) + "\n",
  );
}
console.log(
  JSON.stringify({
    checks: report.checks.length,
    downloads: report.downloads.length,
    completed: report.completed,
  }),
);
