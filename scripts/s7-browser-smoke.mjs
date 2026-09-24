// S7: Nyoze tate-chu-yoko in real Chrome (library main thread, module Worker,
// built Web). Expected bodies, counts and paths are handwritten from the S7
// specification. ZIP bytes are read back by scripts/check_export_zip.py.
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
  slice: "S7",
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
  if (run.status) throw Error(run.stderr || run.stdout);
}

// No blank line and no trailing newline. A trailing newline is the first empty
// row, so the default header parser would treat every preceding line as a header.
// ON converts each postfix ASCII note. A quote that cuts `｟12｠`, including
// `｠**` after bold and a bracket that was already in the input, stays as a note.
// The roman-numeral note stays. OFF skips only the TCY stage, so a bold
// note that follows a still-present TCY note does not match.
const partialBold = "12［＃「12」は縦中横］［＃「｠」は太字］";
const wholeBouten = "12［＃「12」は縦中横］［＃「｟12｠」に傍点］";
const partialUnderline = "12［＃「12」は縦中横］［＃「｠」に傍線］";
const wrappedBouten =
  "12［＃「12」は縦中横］［＃「12」は太字］［＃「｠**」に傍点］";
const inputPartial = "｟12｠［＃「｠」は太字］";
const nestedBouten = "｟X｟12｠［＃「｠」に傍点］";
const rangeBouten = "［＃傍点］12［＃「12」は縦中横］［＃傍点終わり］";
const source = [
  "12［＃「12」は縦中横］",
  "IIII［＃「IIII」は縦中横］［＃「IIII」は太字］",
  "青［＃「青」は太字］",
  "Ⅳ［＃「Ⅳ」は縦中横］",
  partialBold,
  wholeBouten,
  partialUnderline,
  wrappedBouten,
  inputPartial,
  nestedBouten,
  rangeBouten,
].join("\n");
const onBody = [
  "｟12｠",
  "**｟IIII｠**",
  "**青**",
  "Ⅳ［＃「Ⅳ」は縦中横］",
  "｟12｠［＃「｠」は太字］",
  "｟12｠［＃「｟12｠」に傍点］",
  "｟12｠［＃「｠」に傍線］",
  "**｟12｠**［＃「｠**」に傍点］",
  inputPartial,
  nestedBouten,
  "［＃傍点］｟12｠［＃傍点終わり］",
].join("\n");
const offBody = [
  "12［＃「12」は縦中横］",
  "IIII［＃「IIII」は縦中横］［＃「IIII」は太字］",
  "**青**",
  "Ⅳ［＃「Ⅳ」は縦中横］",
  partialBold,
  wholeBouten,
  partialUnderline,
  wrappedBouten,
  inputPartial,
  nestedBouten,
  rangeBouten,
].join("\n");
const invalidNote = "［＃「Ⅳ」は縦中横］";
const inputs = [
  { id: "t", kind: "txt", name: "縦.txt", bytes: utf8(source) },
  {
    id: "z",
    kind: "zip",
    name: "束.zip",
    bytes: storedZip([["章.txt", source]]),
  },
];
const expectedPaths = {
  md: ["縦.md", "束/章.md"],
  txt: ["縦_converted.txt", "束/章.txt"],
};
const mime = {
  md: "text/markdown;charset=utf-8",
  txt: "text/plain;charset=utf-8",
};
const optionsFor = (ext, tcy) => ({
  outputExtension: ext,
  conversion: { ...structuredClone(DEFAULT_OPTIONS), convertTcy: tcy },
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
  for (const tcy of [true, false]) {
    const key = ext + (tcy ? "-on" : "-off");
    const body = tcy ? onBody : offBody;
    const r = await prepareImport(inputs, optionsFor(ext, tcy));
    check("node " + key + " status", r.status, "completed");
    check(
      "node " + key + " paths",
      r.artifacts.map((a) => a.relativePath),
      expectedPaths[ext],
    );
    for (const a of r.artifacts) {
      check(
        "node " + key + " bytes " + a.relativePath,
        Buffer.from(a.bytes),
        utf8(body),
      );
      check(
        "node " + key + " tcy " + a.relativePath,
        a.conversion.stats.tcy,
        tcy
          ? { converted: 7, unconverted: 1 }
          : { converted: 0, unconverted: 0 },
      );
      check(
        "node " + key + " remaining " + a.relativePath,
        a.conversion.remainingNotes.length,
        tcy ? 9 : 18,
      );
      const tcyEvents = a.conversion.processingEvents.filter(
        (e) => e.stage === "tcy",
      );
      check(
        "node " + key + " tcy events " + a.relativePath,
        tcyEvents,
        tcy
          ? [
              { stage: "tcy", action: "converted", count: 7 },
              { stage: "tcy", action: "unconverted", count: 1 },
            ]
          : [],
      );
    }
    nodeRuns[key] = summarize(r);
  }
}
check(
  "node md and txt cores match when TCY is on",
  nodeRuns["md-on"].artifacts.map((a) => a.core),
  nodeRuns["txt-on"].artifacts.map((a) => a.core),
);

const temp = await mkdtemp(join(tmpdir(), "aozora-s7-"));
let browser, repo, web;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  report.chrome = browser.version();
  repo = await createWebServer({ root: "." });
  const lib = await browser.newPage();
  lib.setDefaultTimeout(30000);
  const libErrors = [];
  lib.on("pageerror", (e) => libErrors.push(e.message));
  await lib.route(repo.url + "s7.html", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><title>S7</title>',
    }),
  );
  await lib.goto(repo.url + "s7.html");
  const cases = ["md", "txt"].flatMap((ext) =>
    [true, false].map((tcy) => ({
      key: ext + (tcy ? "-on" : "-off"),
      options: optionsFor(ext, tcy),
    })),
  );
  const inBrowser = await lib.evaluate(
    async ({ raw, cases: jobCases }) => {
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
      for (const job of jobCases) {
        const main = await prepareImport(inputs, job.options);
        const delivered = await importFiles(
          inputs.map((i) => ({
            id: i.id,
            kind: i.kind,
            file: new File([i.bytes], i.name, { type: "wrong/mime" }),
          })),
          job.options,
          {
            requestId: "s7-" + job.key,
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
        out[job.key] = {
          main: summarize(main),
          worker: summarize(delivered.result),
        };
      }
      return { out, started, terminated };
    },
    {
      raw: inputs.map((i) => ({ ...i, bytes: [...i.bytes] })),
      cases,
    },
  );
  for (const job of cases) {
    const r = inBrowser.out[job.key];
    check("chrome main " + job.key + " equals node", r.main, nodeRuns[job.key]);
    check(
      "chrome Worker " + job.key + " equals node",
      r.worker,
      nodeRuns[job.key],
    );
  }
  check(
    "one owned Worker per library job, all terminated",
    [inBrowser.started, inBrowser.terminated],
    [cases.length, cases.length],
  );
  check("library page errors", libErrors, []);
  await lib.close();

  web = await createWebServer();
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1100 },
  });
  await context.addInitScript(() => {
    const obs = (window.__s7 = {
      urls: 0,
      live: 0,
      revokes: 0,
      started: 0,
      terminated: 0,
      types: [],
    });
    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (b) => {
      obs.urls++;
      obs.live++;
      obs.types.push(b.type);
      return create(b);
    };
    URL.revokeObjectURL = (u) => {
      obs.revokes++;
      obs.live--;
      return revoke(u);
    };
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) {
        super(...args);
        obs.started++;
      }
      terminate() {
        obs.terminated++;
        return super.terminate();
      }
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [],
    network = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => network.push(r.url()));
  await page.goto(web.url);
  await page.waitForFunction(
    () => document.querySelector("#boot-error").hidden,
  );
  const button = (name) => page.getByRole("button", { name, exact: true });
  const idle = () =>
    page.waitForFunction(() => document.querySelector("#cancel").disabled);
  await page.locator("#advanced > summary").click();
  check(
    "default convertTcy is checked",
    await page.locator("#option-convertTcy").isChecked(),
    true,
  );
  check(
    "TCY summary names the example and the display requirement",
    await page.locator("#summary-convertTcy").textContent(),
    "後置の縦中横注記を、Nyozeの縦中横（例: 12 → ｟12｠）へ変換します。表示先がその記法に対応している必要があります。",
  );
  check(
    "TCY is the first checkbox in the decoration group",
    await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          "#decoration-controls input[type=checkbox]",
        ),
      ].map((el) => el.id),
    ),
    [
      "option-convertTcy",
      "option-convertMarkdownEmphasis",
      "option-convertUnderline",
      "option-approximateOtherUnderlineStyles",
      "option-approximateLeftUnderline",
      "option-convertBouten",
      "option-convertHeadings",
    ],
  );
  await page.locator("#option-convertTcy").uncheck();
  check(
    "unchecked before reset",
    await page.locator("#option-convertTcy").isChecked(),
    false,
  );
  await button("設定を初期値に戻す").click();
  check(
    "reset restores convertTcy",
    await page.locator("#option-convertTcy").isChecked(),
    true,
  );

  let releaseWorker;
  const workerGate = new Promise((resolve) => {
    releaseWorker = resolve;
  });
  await page.route("**/import.worker.js", async (route) => {
    await workerGate;
    await route.continue();
  });
  await page.locator("#files").setInputFiles({
    name: "縦.txt",
    mimeType: "application/octet-stream",
    buffer: utf8(source),
  });
  await button("変換を開始").click();
  await page.waitForFunction(() => !document.querySelector("#cancel").disabled);
  check(
    "busy disables convertTcy",
    await page.locator("#option-convertTcy").isDisabled(),
    true,
  );
  releaseWorker();
  await idle();
  await page.unroute("**/import.worker.js");
  check(
    "busy ends with convertTcy enabled again",
    await page.locator("#option-convertTcy").isDisabled(),
    false,
  );

  const acquire = async (label, expectedName) => {
    const [d] = await Promise.all([
      page.waitForEvent("download"),
      button("ダウンロード").click(),
    ]);
    check(label + " filename", d.suggestedFilename(), expectedName);
    const path = join(
      temp,
      String(report.downloads.length) + "-" + expectedName.replaceAll("/", "_"),
    );
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
  const lastBlobType = () => page.evaluate(() => window.__s7.types.at(-1));
  const convertCurrent = async () => {
    await button("変換を開始").click();
    await idle();
  };
  const selectOnly = async (relativePath) => {
    await button("選択を解除").click();
    await page
      .getByLabel("出力を選択: " + relativePath, { exact: true })
      .check();
  };

  check(
    "Web ON lists nine remaining notes and zero failed inputs",
    await page.locator("#result-summary").textContent(),
    "出力 1件 · 失敗した入力 0件 · 未変換注記（OFFにした処理の注記を含む） 9箇所",
  );
  await page
    .getByRole("button", { name: "縦.mdの警告・注記を確認", exact: true })
    .click();
  const detail = await page.locator("#conversion-list").textContent();
  check(
    "Web ON shows the invalid-body explanation",
    detail.includes(
      "縦中横の対象は、半角の英字・数字・!・? の1〜4文字だけです。全角・空白・絵文字などは変換しません。",
    ),
    true,
  );
  check(
    "Web ON names TCY_NOT_CONVERTED",
    detail.includes("TCY_NOT_CONVERTED"),
    true,
  );
  check(
    "Web ON note list keeps the roman-numeral note and the partial quotes",
    await page.locator("#notes").textContent(),
    "出力 4行" +
      invalidNote +
      "出力 5行［＃「｠」は太字］" +
      "出力 6行［＃「｟12｠」に傍点］" +
      "出力 7行［＃「｠」に傍線］" +
      "出力 8行［＃「｠**」に傍点］" +
      "出力 9行［＃「｠」は太字］" +
      "出力 10行［＃「｠」に傍点］" +
      "出力 11行［＃傍点］" +
      "出力 11行［＃傍点終わり］",
  );
  check(
    "Web ON names the partial-quote diagnostics",
    detail.includes("EMPHASIS_NOT_CONVERTED") &&
      detail.includes("太字・斜体に安全に変換できない注記を保持しました。") &&
      detail.includes("BOUTEN_NOT_CONVERTED") &&
      detail.includes(
        "傍点が縦中横の括弧や本体を分解してしまうため、注記を保持しました。",
      ) &&
      detail.includes("UNDERLINE_NOT_CONVERTED") &&
      detail.includes("傍線に安全に変換できない注記を保持しました。"),
    true,
  );

  await selectOnly("縦.md");
  await page.locator("#delivery-single").check();
  await button("ダウンロード用ファイルを作成").click();
  await idle();
  const mdOn = await acquire("Web single md ON", "縦.md");
  check("Web single md ON bytes", mdOn, utf8(onBody));
  check("Web single md ON MIME", await lastBlobType(), mime.md);
  await page.getByRole("radio", { name: "ZIPにまとめる", exact: true }).check();
  await button("ZIPファイルを作成（1件）").click();
  await idle();
  const zipMd = await acquire("Web ZIP md ON", "aozora-markdown.zip");
  check("Web ZIP md ON MIME", await lastBlobType(), "application/zip");
  independentZip("Web ZIP md ON", zipMd, [["縦.md", onBody]]);

  await page.getByRole("radio", { name: ".txt", exact: true }).check();
  await convertCurrent();
  check(
    "Web TXT ON still lists nine remaining notes",
    (await page.locator("#result-summary").textContent()).includes(
      "未変換注記（OFFにした処理の注記を含む） 9箇所",
    ),
    true,
  );
  await selectOnly("縦_converted.txt");
  await page.locator("#delivery-single").check();
  await button("ダウンロード用ファイルを作成").click();
  await idle();
  const txtOn = await acquire("Web single txt ON", "縦_converted.txt");
  check("Web single txt ON bytes equal md ON", txtOn, mdOn);
  check("Web single txt ON MIME", await lastBlobType(), mime.txt);
  await page.getByRole("radio", { name: "ZIPにまとめる", exact: true }).check();
  await button("ZIPファイルを作成（1件）").click();
  await idle();
  const zipTxt = await acquire("Web ZIP txt ON", "aozora-markdown.zip");
  independentZip("Web ZIP txt ON", zipTxt, [["縦_converted.txt", onBody]]);

  await page.locator("#option-convertTcy").uncheck();
  check(
    "turning TCY off clears the delivered result",
    await page.locator("#results > li").count(),
    0,
  );
  await convertCurrent();
  check(
    "Web OFF keeps eighteen notes and zero failed inputs",
    await page.locator("#result-summary").textContent(),
    "出力 1件 · 失敗した入力 0件 · 未変換注記（OFFにした処理の注記を含む） 18箇所",
  );
  await selectOnly("縦_converted.txt");
  await page.locator("#delivery-single").check();
  await button("ダウンロード用ファイルを作成").click();
  await idle();
  const txtOff = await acquire("Web single txt OFF", "縦_converted.txt");
  check("Web single txt OFF bytes", txtOff, utf8(offBody));
  await page.getByRole("radio", { name: ".md", exact: true }).check();
  await convertCurrent();
  await selectOnly("縦.md");
  await page.locator("#delivery-single").check();
  await button("ダウンロード用ファイルを作成").click();
  await idle();
  const mdOff = await acquire("Web single md OFF", "縦.md");
  check("Web single md OFF bytes equal txt OFF", mdOff, txtOff);
  await page.getByRole("radio", { name: "ZIPにまとめる", exact: true }).check();
  await button("ZIPファイルを作成（1件）").click();
  await idle();
  const zipOff = await acquire("Web ZIP md OFF", "aozora-markdown.zip");
  independentZip("Web ZIP md OFF", zipOff, [["縦.md", offBody]]);

  const beforeHide = await page.evaluate(() => window.__s7.live);
  check("downloads issued live URLs", beforeHide > 0, true);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pagehide")),
  );
  const hidden = await page.evaluate(() => ({
    live: window.__s7.live,
    started: window.__s7.started,
    terminated: window.__s7.terminated,
  }));
  check("pagehide revokes download URLs", hidden.live, 0);
  check(
    "pagehide terminates every Worker the page started",
    hidden.terminated,
    hidden.started,
  );
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pageshow")),
  );
  await page.waitForFunction(
    () => document.querySelector("#boot-error").hidden,
  );
  check(
    "pageshow does not show a download quota counter",
    await page.locator("#download-count").count(),
    0,
  );
  check(
    "pageshow restores the TCY default",
    await page.locator("#option-convertTcy").isChecked(),
    true,
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
  report.finishedAt = new Date().toISOString();
  await writeFile(
    "reports/s7-browser-smoke.json",
    JSON.stringify(report, null, 2) + "\n",
  );
}
console.log(
  JSON.stringify({
    checks: report.checks.length,
    downloads: report.downloads.length,
    chrome: report.chrome,
    completed: report.completed,
  }),
);
