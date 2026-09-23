// S8: safe Markdown preview in real Chrome against the built Web app.
// Expected artifact bytes are handwritten from the S8/S7/S6 specifications and
// cross-checked against the Node public API before the browser runs. Preview
// expectations are DOM facts (tags, attributes, text), never parser HTML.
// Worker faults are labelled: "injected" routes replace or withhold the
// Worker script; "natural" rows are real Worker runs on real input.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createWebServer } from "./serve-web.mjs";
import { DEFAULT_OPTIONS } from "../dist/index.js";
import { prepareImport } from "../dist/import/index.js";

const report = {
  slice: "S8",
  contract: "aozora-web-v4",
  previewContract: "aozora-preview-v1",
  startedAt: new Date().toISOString(),
  node: process.version,
  checks: [],
  downloads: [],
  timings: {},
  resources: [],
  screenshots: [],
  completed: false,
};
const check = (label, actual, expected) => {
  assert.deepEqual(actual, expected, label);
  report.checks.push(label);
};
const utf8 = (s) => Buffer.from(s, "utf8");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const IDEOGRAPHIC_SPACE = "\u3000";

// ---- Handwritten fixtures -------------------------------------------------
const SYNTAX_SOURCE = [
  "夢十夜",
  "夏目漱石",
  "",
  "［＃５字下げ］第一夜［＃「第一夜」は中見出し］",
  "こんな｜夢《ゆめ》を見た。腕組《うでぐみ》をして坐っていると、",
  "女が静［＃「静」に傍点］かな声で云う。",
  "12［＃「12」は縦中横］月、太字［＃「太字」は太字］と傍線［＃「傍線」に傍線］。",
  "［＃ここから２字下げ］",
  "字下げの段落。",
  "［＃ここで字下げ終わり］",
  "［＃地付き］署名",
  "［＃改ページ］",
  "次のページ。",
].join("\n");
// Header lines become frontmatter; the heading keeps five U+3000 (S6);
// bouten is ｜字《﹅》; TCY ｟12｠ (S7); underline ||x|| (Nyoze default).
const SYNTAX_HEAD =
  "---\ntitle: 夢十夜\nauthor: 夏目漱石\n---\n" +
  "### " +
  IDEOGRAPHIC_SPACE.repeat(5) +
  "第一夜\n" +
  "こんな｜夢《ゆめ》を見た。腕組《うでぐみ》をして坐っていると、\n" +
  "女が｜静《﹅》かな声で云う。\n" +
  "｟12｠月、**太字**と||傍線||。\n";
// Nyoze indent/align/page-break are OFF by default: the notes stay literal.
const SYNTAX_DEFAULT =
  SYNTAX_HEAD +
  "［＃ここから２字下げ］\n字下げの段落。\n［＃ここで字下げ終わり］\n" +
  "［＃地付き］署名\n［＃改ページ］\n次のページ。";
const SYNTAX_NYOZE =
  SYNTAX_HEAD +
  ":::indent-2\n字下げの段落。\n:::\n" +
  ":::align-end\n署名\n:::\n" +
  ":::page-break\n:::\n次のページ。";
// No blank line and no trailing newline: the core keeps this text unchanged.
const XSS = [
  "<script>window.__xss=1;alert(1)</script>",
  '<img src=x onerror="window.__xss=2">',
  "[link](javascript:window.__xss=3)",
  "[enc](jav&#x61;script:window.__xss=8)",
  "[data](data:text/html,<script>parent.__xss=9</script>)",
  "[vb](vbscript:msgbox(1)) [file](file:///etc/passwd) [rel](//evil.invalid/x)",
  '[ok](https://example.invalid/?q=1 "t")',
  "![画像](https://example.invalid/a.png)",
  '<iframe srcdoc="<script>parent.__xss=4</script>"></iframe>',
  '<svg onload="window.__xss=5"></svg><math></math><object data=x></object><embed src=x>',
  '<a href="javascript:window.__xss=6">a</a>',
  "&lt;/script&gt; \" ' `code` __proto__ constructor prototype",
  "<style>body{display:none}</style>",
  '<u onclick="window.__xss=7">u</u> <u>下線</u>',
  "<https://example.invalid/auto> <javascript:window.__xss=10>",
].join("\n");
const LINE = "あいうえおかきくけこ";
const BIG = Array.from({ length: 140000 }, () => LINE).join("\n");
const NEAR = Array.from({ length: 130000 }, () => LINE).join("\n");
const MANY_SOURCE = Array.from({ length: 12000 }, (_, i) => "段落" + i).join(
  "\n\n",
);
// The first paragraph and its blank line are the default header.
const MANY =
  "---\ntitle: 段落0\n---\n" +
  Array.from({ length: 11999 }, (_, i) => "段落" + (i + 1)).join("\n\n");
const expectedA = {
  "夢.md": SYNTAX_DEFAULT,
  "xss_converted.md": XSS,
  "empty.md": "",
  "many.md": MANY,
  "big.md": BIG,
  "near.md": NEAR,
};
const inputsA = [
  ["夢.txt", SYNTAX_SOURCE],
  ["xss.md", XSS],
  ["empty.txt", ""],
  ["many.txt", MANY_SOURCE],
  ["big.txt", BIG],
  ["near.txt", NEAR],
];

// ---- Node public API cross-check of the handwritten bytes ----------------
{
  const r = await prepareImport(
    inputsA.map(([name, text], i) => ({
      id: "n" + i,
      kind: name.endsWith(".md") ? "md" : "txt",
      name,
      bytes: utf8(text),
    })),
    { conversion: structuredClone(DEFAULT_OPTIONS) },
  );
  check("node default status", r.status, "completed");
  check(
    "node default artifacts equal handwritten bytes",
    Object.fromEntries(
      r.artifacts.map((a) => [a.relativePath, Buffer.from(a.bytes).toString()]),
    ),
    expectedA,
  );
  const n = await prepareImport(
    [{ id: "y", kind: "txt", name: "夢.txt", bytes: utf8(SYNTAX_SOURCE) }],
    {
      conversion: {
        ...structuredClone(DEFAULT_OPTIONS),
        convertNyozeIndent: true,
        convertNyozeAlignEnd: true,
        convertNyozePageBreak: true,
      },
    },
  );
  check(
    "node Nyoze artifact equals handwritten bytes",
    Buffer.from(n.artifacts[0].bytes).toString(),
    SYNTAX_NYOZE,
  );
  check("big output is above 4 MiB", utf8(BIG).length > 4 * 1048576, true);
  check("near output is below 4 MiB", utf8(NEAR).length < 4 * 1048576, true);
}

// ---- Static build facts ---------------------------------------------------
const baseline = JSON.parse(
  await readFile("tests/fixtures/s8-bundle-baseline.json", "utf8"),
);
const bundles = JSON.parse(await readFile("reports/bundle-sizes.json", "utf8"));
check(
  "existing 9 bundles: hash, size and inputs unchanged",
  bundles.entries,
  baseline.entries,
);
const webBuild = JSON.parse(await readFile("reports/web-build.json", "utf8"));
for (const name of ["import.worker.js", "export.worker.js", "LICENSE.txt"])
  check(
    name + " unchanged from the S8 baseline",
    sha256(await readFile("web-dist/" + name)),
    baseline.webAssetsBefore[name],
  );
for (const [name, info] of Object.entries(webBuild.assets))
  check(
    "web-build hash matches web-dist " + name,
    sha256(await readFile("web-dist/" + name)),
    info.sha256,
  );
const noticeFiles = (await readdir("notices"))
  .filter((n) => n.endsWith(".txt"))
  .sort();
check(
  "static allowlist includes the preview Worker and notices only",
  (await readdir("web-dist", { recursive: true })).sort(),
  [
    "LICENSE.txt",
    "export.worker.js",
    "import.worker.js",
    "index.html",
    "main.js",
    "notices",
    "notices/index.html",
    ...noticeFiles.map((n) => "notices/" + n),
    "preview.worker.js",
    "preview.worker.js.LEGAL.txt",
    "styles.css",
  ].sort(),
);
for (const pkg of [
  "markdown-it",
  "mdurl",
  "uc.micro",
  "entities",
  "linkify-it",
  "punycode.js",
])
  check(
    "notice present for " + pkg,
    noticeFiles.includes(pkg + "-LICENSE.txt"),
    true,
  );
check(
  "main graph has no parser",
  webBuild.inputs.filter(
    (p) => p.includes("markdown-it") || p === "web/preview/parse.ts",
  ),
  [],
);
check(
  "preview Worker graph has the parser but no UI/adapters",
  [
    webBuild.previewWorker.inputs.includes(
      "node_modules/markdown-it/dist/markdown-it.mjs",
    ),
    webBuild.previewWorker.inputs.filter(
      (p) =>
        /^web\/(?!preview\/)/.test(p) ||
        /^web\/preview\/(client|session|render|messages|source)\.ts$/.test(p) ||
        p.startsWith("src/adapters/"),
    ),
  ],
  [true, []],
);
check(
  "no Web module in the existing bundle graph",
  Object.values(bundles.entries)
    .flatMap((e) => e.inputs)
    .filter((p) => p.startsWith("web/")),
  [],
);
check(
  "main.js does not contain the parser",
  (await readFile("web-dist/main.js", "utf8")).includes("markdown-it"),
  false,
);

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

const observe = () => {
  const obs = (window.__s8 = { workers: [], urls: 0, live: 0 });
  const Native = window.Worker;
  window.Worker = class extends Native {
    constructor(url, options) {
      super(url, options);
      this.__s8 = obs.workers.length;
      obs.workers.push({
        url: String(url),
        type: options?.type ?? "classic",
        terminated: false,
      });
    }
    terminate() {
      obs.workers[this.__s8].terminated = true;
      return super.terminate();
    }
  };
  const create = URL.createObjectURL.bind(URL),
    revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (b) => {
    obs.urls++;
    obs.live++;
    return create(b);
  };
  URL.revokeObjectURL = (u) => {
    obs.live--;
    return revoke(u);
  };
};
const ALLOWED_TAGS = [
  "DIV",
  "SECTION",
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "BLOCKQUOTE",
  "UL",
  "OL",
  "LI",
  "HR",
  "PRE",
  "CODE",
  "STRONG",
  "EM",
  "U",
  "RUBY",
  "RT",
  "RP",
  "SPAN",
  "DL",
  "DT",
  "DD",
  "DETAILS",
  "SUMMARY",
];
async function auditSurface(page) {
  return page.evaluate((allowed) => {
    const tags = new Set(allowed);
    const attrs = new Set(["class", "role", "aria-label", "start"]);
    const bad = [];
    for (const el of document.querySelectorAll("#preview-surface *")) {
      if (!tags.has(el.tagName)) bad.push(el.tagName);
      for (const a of el.attributes)
        if (!attrs.has(a.name)) bad.push(el.tagName + "@" + a.name);
    }
    return {
      bad,
      scripts: document.scripts.length,
      dangerous: document.querySelectorAll(
        "main img, main svg, main math, main iframe, main object, main embed, main style, main base, main form, #preview a",
      ).length,
      xss: window.__xss ?? null,
      bodyVisible: getComputedStyle(document.body).display !== "none",
    };
  }, ALLOWED_TAGS);
}

// Injected delay: the Worker script response is withheld until released.
let release;
let gate = Promise.resolve();
const held = async (route) => {
  await gate;
  await route.continue().catch(() => {});
};
const temp = await mkdtemp(join(tmpdir(), "aozora-s8-"));
await mkdir("reports/s8-screenshots", { recursive: true });
let browser, web, sub;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  report.chrome = browser.version();
  web = await createWebServer();

  // ---- Serving: module MIME and missing asset --------------------------
  const head = await fetch(web.url + "preview.worker.js");
  check("preview Worker served", head.status, 200);
  check(
    "preview Worker module MIME",
    head.headers.get("content-type"),
    "text/javascript; charset=utf-8",
  );
  check(
    "preview Worker bytes are the built asset",
    sha256(Buffer.from(await head.arrayBuffer())),
    webBuild.assets["preview.worker.js"].sha256,
  );
  check(
    "missing asset is 404",
    (await fetch(web.url + "preview.worker.missing.js")).status,
    404,
  );

  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 1100 },
  });
  await context.addInitScript(observe);
  const pages = [];
  context.on("page", (p) => pages.push(p.url()));
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [],
    network = [],
    consoleText = [],
    dialogs = [];
  let navigations = 0;
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => network.push(r.url()));
  page.on("console", (m) => consoleText.push(m.text()));
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  page.on("framenavigated", (f) => {
    if (f === page.mainFrame()) navigations++;
  });
  await page.goto(web.url);
  await page.waitForFunction(
    () => document.querySelector("#boot-error").hidden,
  );
  const button = (name) => page.getByRole("button", { name, exact: true });
  const idle = () =>
    page.waitForFunction(() => document.querySelector("#cancel").disabled);
  const status = () =>
    page.evaluate(() => document.querySelector("#preview").dataset.status);
  const waitStatus = (statuses, timeout = 20000) =>
    page.waitForFunction(
      (s) => s.includes(document.querySelector("#preview").dataset.status),
      statuses,
      { timeout },
    );
  const previewWorkers = () =>
    page.evaluate(() =>
      window.__s8.workers
        .filter((w) => w.url.endsWith("/preview.worker.js"))
        .map((w) => ({ type: w.type, terminated: w.terminated })),
    );
  const open = async (path) => {
    await button(path + "をプレビュー").click();
  };
  const timed = async (label, path, statuses) => {
    const t0 = Date.now();
    await open(path);
    await waitStatus(statuses);
    report.timings[label] = Date.now() - t0;
  };
  const acquire = async (label, expectedName) => {
    const [d] = await Promise.all([
      page.waitForEvent("download"),
      button("ダウンロード").click(),
    ]);
    check(label + " filename", d.suggestedFilename(), expectedName);
    const path = join(temp, report.downloads.length + "-" + expectedName);
    await d.saveAs(path);
    check(label + " acquisition", await d.failure(), null);
    const bytes = await readFile(path);
    report.downloads.push({
      label,
      filename: expectedName,
      bytes: bytes.length,
      sha256: sha256(bytes),
    });
    return bytes;
  };
  const shot = async (name, locator = page.locator("#preview")) => {
    const path = `reports/s8-screenshots/${name}.png`;
    await locator.screenshot({ path });
    report.screenshots.push(path);
  };

  // ---- Round A: default options, six inputs -----------------------------
  check(
    "preview panel hidden before any result",
    await page.locator("#preview").isHidden(),
    true,
  );
  await page.locator("#files").setInputFiles(
    inputsA.map(([name, text]) => ({
      name,
      mimeType: "application/octet-stream",
      buffer: utf8(text),
    })),
  );
  await button("変換を開始").click();
  await idle();
  check(
    "six outputs, each with a preview and a warnings button",
    await page.evaluate(() =>
      [...document.querySelectorAll("#results > li")].map((li) =>
        [...li.querySelectorAll(".result-actions button")].map((b) =>
          b.textContent.trim(),
        ),
      ),
    ),
    Array.from({ length: 6 }, () => ["プレビュー", "警告・注記を確認"]),
  );
  const summary = await page.locator("#result-summary").textContent();
  check(
    "summary counts zero failed inputs",
    summary.includes("失敗した入力 0件"),
    true,
  );

  // A ready single download before any viewing.
  await button("選択を解除").click();
  await page.getByLabel("出力を選択: 夢.md", { exact: true }).check();
  await page.locator("#delivery-single").check();
  await button("ダウンロード用ファイルを作成").click();
  await idle();
  const selection = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("#results input[type=checkbox]")].map(
        (c) => c.checked,
      ),
    );
  const selectedBefore = await selection();
  const liveBefore = await page.evaluate(() => window.__s8.live);
  check("ready shown", await page.locator("#ready").isVisible(), true);

  // XSS fixture through the real Worker.
  const scriptsBefore = await page.evaluate(() => document.scripts.length);
  const requestsBefore = network.length;
  const navsBefore = navigations;
  await timed("xss preview", "xss_converted.md", ["ready"]);
  check(
    "preview requests only the preview Worker",
    network.slice(requestsBefore).map((u) => u.slice(web.url.length)),
    ["preview.worker.js"],
  );
  check(
    "focus moves to the preview heading",
    await page.evaluate(() => document.activeElement.id),
    "preview-title",
  );
  const audit = await auditSurface(page);
  check("XSS: only allowlisted tags/attributes", audit.bad, []);
  check("XSS: no dangerous element in the app", audit.dangerous, 0);
  check("XSS: no new script elements", audit.scripts, scriptsBefore);
  check("XSS: no script flag", audit.xss, null);
  check("XSS: body style untouched", audit.bodyVisible, true);
  check("XSS: no dialogs", dialogs, []);
  const surfaceText = await page.locator("#preview-surface").textContent();
  for (const literal of [
    "<script>window.__xss=1;alert(1)</script>",
    '<img src=x onerror="window.__xss=2">',
    "[link](javascript:window.__xss=3)",
    "[enc](javascript:window.__xss=8)",
    "[data](data:text/html,<script>parent.__xss=9</script>)",
    "[vb](vbscript:msgbox(1)) [file](file:///etc/passwd)",
    '<iframe srcdoc="<script>parent.__xss=4</script>"></iframe>',
    "<style>body{display:none}</style>",
    '<u onclick="window.__xss=7">u</u>',
    "<javascript:window.__xss=10>",
    "</script> \" ' ",
  ])
    check("XSS literal text: " + literal, surfaceText.includes(literal), true);
  check(
    "XSS links become label + URL text",
    await page.evaluate(() =>
      [...document.querySelectorAll("#preview-surface .preview-link")].map(
        (e) => e.textContent,
      ),
    ),
    [
      "rel〈リンク先: //evil.invalid/x〉",
      "ok〈リンク先: https://example.invalid/?q=1 “t”〉",
      "https://example.invalid/auto〈リンク先: https://example.invalid/auto〉",
    ],
  );
  check(
    "XSS image becomes alt + not-loaded text",
    await page.locator("#preview-surface .preview-image").textContent(),
    "［画像: 画像］〈画像は読み込みません: https://example.invalid/a.png〉",
  );
  check(
    "XSS exact <u> only",
    await page.locator("#preview-surface u").allTextContents(),
    ["下線"],
  );
  check(
    "preview notices are separate from conversion warnings",
    await page.locator("#preview-note-list li").allTextContents(),
    [
      "画像は読み込みません。代替テキストと画像の場所を文字で表示しています。",
      "リンクは開けません。表示名とリンク先を文字で表示しています。",
    ],
  );
  await page.locator("#preview-surface .preview-link-label").first().click();
  await page.locator("#preview-surface .preview-url").first().click();
  await page.locator("#preview-surface .preview-image").click();
  check("XSS: clicks do not navigate", navigations, navsBefore);
  check("XSS: no page besides the app", pages.length, 1);
  check(
    "XSS: still no script flag after clicks",
    (await auditSurface(page)).xss,
    null,
  );
  await shot("xss-1440");
  // Source tab by keyboard.
  await page.locator("#preview-tab-preview").focus();
  await page.keyboard.press("ArrowRight");
  check(
    "ArrowRight selects and focuses the text tab",
    await page.evaluate(() => [
      document.activeElement.id,
      document
        .querySelector("#preview-tab-source")
        .getAttribute("aria-selected"),
      document.querySelector("#preview-panel-source").hidden,
      document.querySelector("#preview-panel-preview").hidden,
    ]),
    ["preview-tab-source", "true", false, true],
  );
  check(
    "text tab is the exact artifact text",
    await page.locator("#source-text").textContent(),
    XSS,
  );
  check(
    "text tab has no child elements",
    await page.evaluate(
      () => document.querySelector("#source-text").children.length,
    ),
    0,
  );
  check(
    "text tab says full text",
    await page.locator("#source-status").textContent(),
    `全文（${utf8(XSS).length.toLocaleString("ja-JP")} bytes）を表示しています。ダウンロードされる内容と同じです。`,
  );
  await page.keyboard.press("Home");
  check(
    "Home returns to the preview tab",
    await page.evaluate(() => [
      document.activeElement.id,
      document
        .querySelector("#preview-tab-preview")
        .getAttribute("aria-selected"),
    ]),
    ["preview-tab-preview", "true"],
  );

  // Viewing left selection, ready file and URLs alone.
  check("selection unchanged after viewing", await selection(), selectedBefore);
  check(
    "ready still shown after viewing",
    await page.locator("#ready").isVisible(),
    true,
  );
  check(
    "no URL created or revoked by viewing",
    await page.evaluate(() => window.__s8.live),
    liveBefore,
  );
  check(
    "single download after viewing",
    await acquire("A single 夢.md", "夢.md"),
    utf8(SYNTAX_DEFAULT),
  );

  // Default syntax: unsupported notes stay literal; U+3000 in the heading.
  await timed("syntax default preview", "夢.md", ["ready"]);
  const syntaxText = await page.locator("#preview-surface").textContent();
  for (const literal of [
    "［＃ここから２字下げ］",
    "［＃地付き］署名",
    "［＃改ページ］",
  ])
    check(
      "unsupported note literal: " + literal,
      syntaxText.includes(literal),
      true,
    );
  check(
    "heading DOM text keeps five U+3000",
    await page.locator("#preview-surface h3").textContent(),
    IDEOGRAPHIC_SPACE.repeat(5) + "第一夜",
  );

  // Empty and >4 MiB never start a Worker.
  const workersBefore = (await previewWorkers()).length;
  await open("empty.md");
  await waitStatus(["empty"]);
  check(
    "empty message",
    await page.locator("#preview-status").textContent(),
    "空の文書です。表示する本文がありません（エラーではありません）。",
  );
  await open("big.md");
  await waitStatus(["limit"]);
  check(
    "4 MiB limit message",
    await page.locator("#preview-status").textContent(),
    `この出力は${utf8(BIG).length.toLocaleString("ja-JP")} bytesで、プレビューの上限（4 MiB）を超えるため、表示の準備をしません。「出力テキスト」で先頭を確認するか、ダウンロードして全文を確認してください。`,
  );
  check(
    "empty/limit started no Worker",
    (await previewWorkers()).length,
    workersBefore,
  );
  await button("出力テキストを見る").click();
  const window128 = await page.locator("#source-text").textContent();
  const shown = utf8(window128).length;
  check(
    "text window is a prefix of the artifact",
    BIG.startsWith(window128),
    true,
  );
  check(
    "text window within 128 KiB at a character boundary",
    shown <= 131072 && shown > 131072 - 4,
    true,
  );
  check(
    "truncation is stated",
    await page.locator("#source-status").textContent(),
    `先頭の${shown.toLocaleString("ja-JP")} bytesだけを表示しています（全体は${utf8(BIG).length.toLocaleString("ja-JP")} bytes）。全文ではありません。全文はダウンロードで確認してください。`,
  );
  await page.locator("#preview-tab-preview").click();

  // Node limit (12,000 paragraphs) and near-4 MiB success.
  await timed("many paragraphs (node limit)", "many.md", ["limit"]);
  check(
    "node limit message",
    (await page.locator("#preview-status").textContent()).startsWith(
      "表示の上限（要素20,000個）",
    ),
    true,
  );
  check(
    "limit leaves no partial DOM",
    await page.locator("#preview-surface *").count(),
    0,
  );
  report.memoryBeforeNear = await page.evaluate(
    () => performance.memory?.usedJSHeapSize ?? null,
  );
  await timed("near 4 MiB preview", "near.md", ["ready"]);
  report.memoryAfterNear = await page.evaluate(
    () => performance.memory?.usedJSHeapSize ?? null,
  );
  check(
    "near 4 MiB DOM text equals the artifact",
    await page.locator("#preview-surface .preview-body").textContent(),
    NEAR,
  );
  const probe = Date.now();
  await page.evaluate(() => 1);
  report.timings["main thread responds after near render"] = Date.now() - probe;

  // Export start cancels a loading preview (Worker script withheld: injected delay).
  gate = new Promise((r) => (release = r));
  await page.route("**/preview.worker.js", held);
  await open("xss_converted.md");
  await waitStatus(["loading"]);
  await page.getByRole("radio", { name: "ZIPにまとめる", exact: true }).check();
  await button("ZIPファイルを作成（1件）").click();
  await waitStatus(["cancelled"]);
  check(
    "busy cancel message",
    await page.locator("#preview-status").textContent(),
    "変換または出力の作成を始めたため、プレビューを中止しました。処理が終わったら、もう一度表示できます。",
  );
  release();
  await idle();
  independentZip(
    "A ZIP after busy cancel",
    await acquire("A ZIP", "aozora-markdown.zip"),
    [["夢.md", SYNTAX_DEFAULT]],
  );
  check(
    "cancelled Worker terminated",
    (await previewWorkers()).every((w) => w.terminated),
    true,
  );

  // File switch while loading: the old job is discarded.
  gate = new Promise((r) => (release = r));
  await open("xss_converted.md");
  await waitStatus(["loading"]);
  await open("夢.md");
  const afterSwitch = await previewWorkers();
  check(
    "switch terminates the older Worker",
    afterSwitch.slice(0, -1).every((w) => w.terminated),
    true,
  );
  release();
  await waitStatus(["ready"]);
  await page.unroute("**/preview.worker.js");
  check(
    "switch shows only the new file",
    [
      await page.locator("#preview-target").textContent(),
      (await page.locator("#preview-surface").textContent()).includes("__xss"),
    ],
    [
      `閲覧中: 夢.md（.md · ${utf8(SYNTAX_DEFAULT).length.toLocaleString()} bytes）`,
      false,
    ],
  );

  // Missing Worker (injected 404), then recovery.
  await page.route("**/preview.worker.js", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await open("夢.md");
  await waitStatus(["failed"]);
  check(
    "missing Worker message",
    await page.locator("#preview-status").textContent(),
    "プレビュー用のWorkerを読み込めませんでした（配信を確認してください）。変換結果とダウンロードには影響しません。",
  );
  await page.unroute("**/preview.worker.js");
  await button("もう一度表示する").click();
  await waitStatus(["ready"]);
  check("recovers after 404", await status(), "ready");

  // Never-replying Worker (injected script), 5 s watchdog, then recovery.
  await page.route("**/preview.worker.js", (route) =>
    route.fulfill({
      contentType: "text/javascript; charset=utf-8",
      body: 'self.addEventListener("message", () => {});',
    }),
  );
  const t0 = Date.now();
  await open("xss_converted.md");
  await waitStatus(["timeout"], 12000);
  report.timings["injected never-reply until timeout"] = Date.now() - t0;
  check(
    "injected never-reply ends at the 5 s watchdog",
    report.timings["injected never-reply until timeout"] >= 4900 &&
      report.timings["injected never-reply until timeout"] < 9000,
    true,
  );
  check(
    "timed-out Worker terminated",
    (await previewWorkers()).at(-1).terminated,
    true,
  );
  await page.unroute("**/preview.worker.js");
  await button("もう一度表示する").click();
  await waitStatus(["ready"]);
  check("recovers after timeout", await status(), "ready");
  check(
    "preview failures are not import failures",
    await page.locator("#result-summary").textContent(),
    summary,
  );

  // Natural resource measurements with the real Worker (no injection).
  report.resources = await page.evaluate(async (url) => {
    const cases = [
      ["kana lines (near 4 MiB)", "あいうえおかきくけこ\n", 130000],
      ["unclosed :::indent-1 lines", ":::indent-1\n", 300000],
      ["[ × 4 MiB", "[", 4194304],
      ["![ × 4 MiB", "![", 2097152],
      ["*_ × 4 MiB", "*_", 2097152],
      ["||* × 4 MiB", "||*", 1398101],
      ["> a lines", "> a\n", 1048576],
      ["｜漢《 × 4 MiB", "｜漢《", 466033],
    ];
    const out = [];
    for (const [name, unit, count] of cases) {
      const bytes = new TextEncoder().encode(unit.repeat(count));
      const w = new Worker(url, { type: "module" });
      const t = performance.now();
      const outcome = await new Promise((resolve) => {
        const timer = setTimeout(
          () => resolve({ status: "no reply within 5000 ms" }),
          5000,
        );
        w.onmessage = (e) => {
          clearTimeout(timer);
          resolve({
            status: e.data.outcome.status,
            reason: e.data.outcome.reason ?? null,
          });
        };
        w.onerror = () => {
          clearTimeout(timer);
          resolve({ status: "error" });
        };
        w.postMessage(
          {
            contract: "aozora-preview-v1",
            type: "preview",
            requestId: name,
            generation: 1,
            bytes,
          },
          [bytes.buffer],
        );
      });
      w.terminate();
      out.push({
        name,
        bytes: count * new TextEncoder().encode(unit).length,
        ms: Math.round(performance.now() - t),
        ...outcome,
      });
    }
    return out;
  }, web.url + "preview.worker.js");
  for (const r of report.resources)
    check(
      "natural run ends in ok/limit or is stopped at 5 s: " + r.name,
      ["ok", "limit", "no reply within 5000 ms"].includes(r.status) &&
        r.bytes <= 4 * 1048576,
      true,
    );

  // pagehide during a (held) preview terminates every Worker.
  gate = new Promise((r) => (release = r));
  await page.route("**/preview.worker.js", held);
  await open("夢.md");
  await waitStatus(["loading"]);
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pagehide")),
  );
  check(
    "pagehide terminates every Worker and revokes URLs",
    await page.evaluate(() => [
      window.__s8.workers.every((w) => w.terminated),
      window.__s8.live,
    ]),
    [true, 0],
  );
  release();
  await page.unroute("**/preview.worker.js");
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pageshow")),
  );
  await page.waitForFunction(
    () => document.querySelector("#boot-error").hidden,
  );
  check(
    "pageshow starts with no preview",
    await page.locator("#preview").isHidden(),
    true,
  );

  // ---- Round B: Nyoze structural output --------------------------------
  await page.locator("#files").setInputFiles({
    name: "夢.txt",
    mimeType: "application/octet-stream",
    buffer: utf8(SYNTAX_SOURCE),
  });
  await page.locator("#advanced > summary").click();
  for (const key of [
    "convertNyozeIndent",
    "convertNyozeAlignEnd",
    "convertNyozePageBreak",
  ])
    await page.locator("#option-" + key).check();
  await button("変換を開始").click();
  await idle();
  await timed("syntax Nyoze preview", "夢.md", ["ready"]);
  const dom = await page.evaluate(() => {
    const s = document.querySelector("#preview-surface");
    const texts = (q) => [...s.querySelectorAll(q)].map((e) => e.textContent);
    return {
      dt: texts("dt"),
      dd: texts("dd"),
      h3: texts("h3"),
      ruby: [...s.querySelectorAll("ruby")].map((r) => [
        r.firstChild.textContent,
        r.querySelector("rt").textContent,
      ]),
      tcy: texts(".preview-tcy"),
      strong: texts("strong"),
      u: texts("u"),
      indent: texts(".preview-indent-2"),
      alignEnd: texts(".preview-align-end"),
      breaks: [...s.querySelectorAll("[role=separator]")].map((e) => [
        e.className,
        e.getAttribute("aria-label"),
      ]),
      paragraphs: texts(".preview-body > p"),
    };
  });
  check("Nyoze preview DOM", dom, {
    dt: ["題名（title）", "著者（author）"],
    dd: ["夢十夜", "夏目漱石"],
    h3: [IDEOGRAPHIC_SPACE.repeat(5) + "第一夜"],
    ruby: [
      ["夢", "ゆめ"],
      ["腕組", "うでぐみ"],
      ["静", "﹅"],
    ],
    tcy: ["12"],
    strong: ["太字"],
    u: ["傍線"],
    indent: ["字下げの段落。"],
    alignEnd: ["署名"],
    breaks: [["preview-page-break", "改ページ"]],
    paragraphs: [
      "こんな夢《ゆめ》を見た。腕組《うでぐみ》をして坐っていると、\n女が静《﹅》かな声で云う。\n12月、太字と傍線。",
      "次のページ。",
    ],
  });
  check(
    "TCY horizontal notice",
    await page.locator("#preview-note-list li").allTextContents(),
    [
      "縦中横（｟｠）は横書きでは普通の横並びで表示します。縦書きでの見た目ではありません。",
    ],
  );
  const indentGeometry = await page.evaluate(() => {
    const h3 = document.querySelector("#preview-surface h3");
    const text = h3.firstChild;
    const range = document.createRange();
    range.setStart(text, 5);
    range.setEnd(text, 6);
    const size = parseFloat(getComputedStyle(h3).fontSize);
    return (
      (range.getBoundingClientRect().left - h3.getBoundingClientRect().left) /
      size
    );
  });
  report.headingIndentEm = indentGeometry;
  check(
    "five U+3000 render as about 5em of indent",
    indentGeometry > 4.5 && indentGeometry < 5.5,
    true,
  );
  check(
    "Nyoze single download",
    await (async () => {
      await page.locator("#delivery-single").check();
      await button("ダウンロード用ファイルを作成").click();
      await idle();
      return acquire("B single 夢.md", "夢.md");
    })(),
    utf8(SYNTAX_NYOZE),
  );
  await page.getByRole("radio", { name: "ZIPにまとめる", exact: true }).check();
  await button("ZIPファイルを作成（1件）").click();
  await idle();
  independentZip("B ZIP", await acquire("B ZIP", "aozora-markdown.zip"), [
    ["夢.md", SYNTAX_NYOZE],
  ]);
  check("preview still ready after export", await status(), "ready");

  // Responsive layout: 1440 / 768 / 390.
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.locator("#preview").scrollIntoViewIfNeeded();
    const geometry = await page.evaluate(() => {
      const panel = document.querySelector("#preview");
      const r = panel.getBoundingClientRect();
      return {
        page: document.documentElement.scrollWidth <= innerWidth + 1,
        panel: r.left >= -1 && r.right <= innerWidth + 1,
        surface:
          document.querySelector("#preview-surface").scrollWidth <=
          document.querySelector("#preview-surface").clientWidth + 1,
      };
    });
    check(`no horizontal overflow at ${width}px`, geometry, {
      page: true,
      panel: true,
      surface: true,
    });
    await shot(`nyoze-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator("#preview-tab-source").click();
  await shot("nyoze-source-1440");
  await page.locator("#preview-tab-preview").click();

  // Close returns focus to the row button; settings change invalidates.
  await button("閲覧を閉じる").click();
  check(
    "close returns focus to the row's preview button",
    await page.evaluate(() =>
      document.activeElement.getAttribute("aria-label"),
    ),
    "夢.mdをプレビュー",
  );
  await open("夢.md");
  await waitStatus(["ready"]);
  await page.locator("#option-convertTcy").uncheck();
  check(
    "settings change invalidates the preview",
    [await page.locator("#preview").isHidden(), await status()],
    [true, "idle"],
  );

  // ---- Global observations -------------------------------------------
  check(
    "every preview Worker was a module Worker and is terminated",
    (await previewWorkers()).every((w) => w.type === "module" && w.terminated),
    true,
  );
  check("page errors", errors, []);
  check("no dialogs", dialogs, []);
  check(
    "no network outside the app origin",
    network.filter((u) => !u.startsWith(web.url)),
    [],
  );
  check(
    "only allowlisted app assets requested",
    [...new Set(network.map((u) => u.slice(web.url.length)))].filter(
      (p) =>
        ![
          "",
          "main.js",
          "styles.css",
          "import.worker.js",
          "export.worker.js",
          "preview.worker.js",
        ].includes(p),
    ),
    [],
  );
  check(
    "console never carries document text",
    consoleText.filter((t) =>
      ["夢十夜", "__xss", LINE, "段落1"].some((m) => t.includes(m)),
    ),
    [],
  );
  await context.close();

  // ---- Subpath --------------------------------------------------------
  sub = await createWebServer({ prefix: "/aozora-markdown/" });
  const sp = await browser.newPage();
  const subNetwork = [];
  sp.on("request", (r) => subNetwork.push(r.url()));
  await sp.goto(sub.url);
  await sp.waitForFunction(() => document.querySelector("#boot-error").hidden);
  await sp.locator("#files").setInputFiles({
    name: "sub.txt",
    mimeType: "text/plain",
    buffer: utf8("SUB｜字《じ》"),
  });
  await sp.getByRole("button", { name: "変換を開始", exact: true }).click();
  await sp.waitForFunction(() => document.querySelector("#cancel").disabled);
  await sp
    .getByRole("button", { name: "sub.mdをプレビュー", exact: true })
    .click();
  await sp.waitForFunction(
    () => document.querySelector("#preview").dataset.status === "ready",
  );
  check(
    "subpath preview ruby",
    await sp.locator("#preview-surface ruby").textContent(),
    "字《じ》",
  );
  check(
    "subpath Worker under the prefix",
    subNetwork.filter((u) => u.endsWith("preview.worker.js")),
    [sub.url + "preview.worker.js"],
  );
  await sp.close();

  // ---- S8-F01 / S8-F02 regressions (real Worker, real DOM) -------------
  {
    const FENCED = ":::indent-1\n```txt\n:::\n```\n本文\n:::";
    // With the default header option the first paragraph becomes the header.
    const SPANNED_BODY =
      ":::indent-1\n`code\n:::\nend`\n本文\n:::\n\n" +
      ":::align-end\n``a\n:::\n`b``\n署名\n:::";
    const SPANNED = "---\ntitle: 題\nauthor: 著\n---\n" + SPANNED_BODY;
    const FM_COUNT = 19000;
    const FM =
      "---\nauthors:\n" +
      Array.from({ length: FM_COUNT }, (_, i) => `  - 著者${i}`).join("\n") +
      "\n---\n本文";
    const rc = await browser.newContext({ acceptDownloads: true });
    const rp = await rc.newPage();
    await rp.goto(web.url);
    await rp.waitForFunction(
      () => document.querySelector("#boot-error").hidden,
    );
    await rp.locator("#files").setInputFiles([
      { name: "case.md", mimeType: "text/markdown", buffer: utf8(FENCED) },
      { name: "fm.md", mimeType: "text/markdown", buffer: utf8(FM) },
      {
        name: "span.md",
        mimeType: "text/markdown",
        buffer: utf8("題\n著\n\n" + SPANNED_BODY),
      },
    ]);
    await rp.getByRole("button", { name: "変換を開始", exact: true }).click();
    await rp.waitForFunction(() => document.querySelector("#cancel").disabled);
    const status = (s) =>
      rp.waitForFunction(
        (want) => document.querySelector("#preview").dataset.status === want,
        s,
      );

    await rp
      .getByRole("button", { name: "case_converted.mdをプレビュー" })
      .click();
    await status("ready");
    check(
      "S8-F01 fenced ::: stays inside the indent block",
      await rp.locator("#preview-surface .preview-body").evaluate((root) => ({
        indents: root.querySelectorAll(".preview-indent").length,
        code: [...root.querySelectorAll(".preview-indent pre code")].map(
          (n) => n.textContent,
        ),
        paragraphs: [...root.querySelectorAll(".preview-indent p")].map(
          (n) => n.textContent,
        ),
        outside: root.querySelectorAll(":scope > .preview-code").length,
      })),
      { indents: 1, code: [":::\n"], paragraphs: ["本文"], outside: 0 },
    );
    const single = async (id, name, expected) => {
      await rp.getByRole("button", { name: "選択を解除", exact: true }).click();
      await rp.getByLabel("出力を選択: " + name, { exact: true }).check();
      await rp.locator("#delivery-single").check();
      await rp
        .getByRole("button", { name: "ダウンロード用ファイルを作成" })
        .click();
      await rp.waitForFunction(
        () => document.querySelector("#cancel").disabled,
      );
      const [d] = await Promise.all([
        rp.waitForEvent("download"),
        rp.getByRole("button", { name: "ダウンロード", exact: true }).click(),
      ]);
      const saved = join(temp, `${id}-${name}`);
      await d.saveAs(saved);
      const bytes = await readFile(saved);
      check(`${id} download bytes`, bytes.toString("utf8"), expected);
      report.downloads.push({
        label: `${id} single ${name}`,
        filename: d.suggestedFilename(),
        bytes: bytes.length,
        sha256: sha256(bytes),
      });
    };
    await single("S8-F01", "case_converted.md", FENCED);

    await rp
      .getByRole("button", { name: "span_converted.mdをプレビュー" })
      .click();
    await status("ready");
    check(
      "S8-F03 multi-line code spans stay inside their blocks",
      await rp.locator("#preview-surface .preview-body").evaluate((root) => ({
        blocks: [...root.children].map((n) => n.className),
        indent: [...root.querySelectorAll(".preview-indent p")].map((p) =>
          [...p.childNodes].map((n) =>
            n.nodeName === "CODE" ? { code: n.textContent } : n.textContent,
          ),
        ),
        alignEnd: [...root.querySelectorAll(".preview-align-end p")].map((p) =>
          [...p.childNodes].map((n) =>
            n.nodeName === "CODE" ? { code: n.textContent } : n.textContent,
          ),
        ),
      })),
      {
        blocks: ["preview-indent preview-indent-1", "preview-align-end"],
        indent: [[{ code: "code ::: end" }, "\n本文"]],
        alignEnd: [[{ code: "a ::: `b" }, "\n署名"]],
      },
    );
    await single("S8-F03", "span_converted.md", SPANNED);

    // Before the fix all frontmatter DOM was built in one task, so the
    // status went from rendering to ready without a macrotask in between.
    const watch = () =>
      rp.evaluate(() => {
        const panel = document.querySelector("#preview");
        const seen = (window.__f02 = { statuses: [], afterTask: null });
        new MutationObserver(() => {
          const s = panel.dataset.status;
          if (seen.statuses.at(-1) !== s) seen.statuses.push(s);
          if (s === "rendering" && seen.afterTask === null) {
            seen.afterTask = "";
            setTimeout(() => {
              seen.afterTask = panel.dataset.status;
              if (window.__f02close && panel.dataset.status === "rendering")
                document.querySelector("#preview-close").click();
            }, 0);
          }
        }).observe(panel, {
          attributes: true,
          attributeFilter: ["data-status"],
        });
      });
    const fmButton = rp.getByRole("button", {
      name: "fm_converted.mdをプレビュー",
    });
    await watch();
    await rp.evaluate(() => (window.__f02close = true));
    await fmButton.click();
    await rp.waitForFunction(() => {
      const panel = document.querySelector("#preview");
      return panel.hidden || panel.dataset.status === "ready";
    });
    const cancelled = await rp.evaluate(() => ({
      ...window.__f02,
      surfaceChildren:
        document.querySelector("#preview-surface").childElementCount,
    }));
    check(
      "S8-F02 large frontmatter still rendering after one task",
      {
        afterTask: cancelled.afterTask,
        readySeen: cancelled.statuses.includes("ready"),
        surfaceChildren: cancelled.surfaceChildren,
      },
      { afterTask: "rendering", readySeen: false, surfaceChildren: 0 },
    );

    await watch();
    await rp.evaluate(() => (window.__f02close = false));
    const started = Date.now();
    await fmButton.click();
    await status("ready");
    report.timings["19,000-field frontmatter preview"] = Date.now() - started;
    const full = await rp.evaluate(() => ({
      afterTask: window.__f02.afterTask,
      dd: document.querySelectorAll("#preview-surface dd").length,
      last: document.querySelector("#preview-surface dd:last-of-type")
        .textContent,
      body: document.querySelector("#preview-surface .preview-body")
        .textContent,
    }));
    check("S8-F02 full frontmatter render", full, {
      afterTask: "rendering",
      dd: FM_COUNT,
      last: `著者${FM_COUNT - 1}`,
      body: "本文",
    });
    await rc.close();
  }

  // ---- 200% native zoom ------------------------------------------------
  const profile = join(temp, "zoom-profile");
  await mkdir(join(profile, "Default"), { recursive: true });
  await writeFile(
    join(profile, "Default", "Preferences"),
    JSON.stringify({
      partition: { default_zoom_level: { x: Math.log(2) / Math.log(1.2) } },
    }),
  );
  const zoom = await chromium.launchPersistentContext(profile, {
    channel: "chrome",
    headless: true,
    viewport: null,
    args: ["--window-size=1440,1100"],
  });
  try {
    const zp = await zoom.newPage();
    await zp.goto(web.url);
    await zp.waitForFunction(
      () => document.querySelector("#boot-error").hidden,
    );
    await zp.locator("#files").setInputFiles({
      name: "夢.txt",
      mimeType: "text/plain",
      buffer: utf8(SYNTAX_SOURCE),
    });
    await zp.getByRole("button", { name: "変換を開始", exact: true }).click();
    await zp.waitForFunction(() => document.querySelector("#cancel").disabled);
    await zp
      .getByRole("button", { name: "夢.mdをプレビュー", exact: true })
      .click();
    await zp.waitForFunction(
      () => document.querySelector("#preview").dataset.status === "ready",
    );
    await zp.locator("#preview").scrollIntoViewIfNeeded();
    const z = await zp.evaluate(() => ({
      inner: innerWidth,
      dpr: devicePixelRatio,
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      focus: document.activeElement.id,
    }));
    check("200% zoom preview geometry", z, {
      inner: 720,
      dpr: 2,
      overflow: false,
      focus: "preview-title",
    });
    const path = "reports/s8-screenshots/zoom-200.png";
    // Playwright clips are misplaced under native zoom (same CDP route as web-smoke).
    const cdp = await zoom.newCDPSession(zp);
    const clip = await zp.evaluate(() => {
      const r = document.querySelector("#preview").getBoundingClientRect();
      const k = devicePixelRatio;
      return {
        x: r.left * k,
        y: (r.top + scrollY) * k,
        width: r.width * k,
        height: r.height * k,
        scale: 1,
      };
    });
    const capture = await cdp.send("Page.captureScreenshot", {
      captureBeyondViewport: true,
      clip,
    });
    await writeFile(path, Buffer.from(capture.data, "base64"));
    report.screenshots.push(path);
  } finally {
    await zoom.close();
  }
  report.completed = true;
} finally {
  await browser?.close();
  await web?.close();
  await sub?.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(
    "reports/s8-browser-smoke.json",
    JSON.stringify(report, null, 2) + "\n",
  );
}
console.log(
  JSON.stringify({
    checks: report.checks.length,
    downloads: report.downloads.length,
    timings: report.timings,
    resources: report.resources.map(
      (r) =>
        `${r.name}: ${r.status}${r.reason ? "/" + r.reason : ""} ${r.ms}ms`,
    ),
    completed: report.completed,
  }),
);
