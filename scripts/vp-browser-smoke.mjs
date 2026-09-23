// VP: vertical reference preview in real Chrome against the
// built Web app. Artifact bytes are handwritten and cross-checked against the
// Node public API before the browser runs. Expectations are DOM, computed
// style and scroll facts, never screenshots alone. Rows are labelled:
// "native" = real Chrome input (Playwright mouse/keyboard); "synthetic" = a
// dispatched WheelEvent or CDP touch gesture, which is NOT real-device evidence;
// "injected" = a replaced or withheld Worker script.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createWebServer } from "./serve-web.mjs";
import { DEFAULT_OPTIONS } from "../dist/index.js";
import { prepareImport } from "../dist/import/index.js";

const report = {
  slice: "VP",
  contract: "aozora-web-v6",
  previewContract: "aozora-preview-v1",
  startedAt: new Date().toISOString(),
  node: process.version,
  checks: [],
  downloads: [],
  timings: {},
  measurements: {},
  screenshots: [],
  unverified: [
    "real touch devices (touch rows are CDP-synthesized)",
    "browsers other than Chrome",
    "assistive technology output",
    "trackpad momentum and OS-level smooth scrolling",
  ],
  completed: false,
};
const check = (label, actual, expected) => {
  assert.deepEqual(actual, expected, label);
  report.checks.push(label);
};
const near = (label, actual, expected, tolerance) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: ${actual} not within ${tolerance} of ${expected}`,
  );
  report.checks.push(label);
};
const utf8 = (s) => Buffer.from(s, "utf8");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const FM = (title, author) => `---\ntitle: ${title}\nauthor: ${author}\n---\n`;

// ---- Handwritten fixtures -------------------------------------------------
const PROSE = Array.from(
  { length: 36 },
  (_, i) =>
    `その${i + 1}。腕組をして枕元に坐っていると、仰向に寝た女が、静かな声でもう死にますと云う。女は長い髪を枕に敷いて、輪郭の柔らかな瓜実顔をその中に横たえている。`,
);
const YUME_SOURCE = [
  "夢十夜",
  "夏目漱石",
  "",
  "［＃５字下げ］第一夜［＃「第一夜」は中見出し］",
  "こんな｜夢《ゆめ》を見た。腕組《うでぐみ》をして坐っていると、",
  "女が静［＃「静」に傍点］かな声で云う。",
  "12［＃「12」は縦中横］月、1234［＃「1234」は縦中横］号、太字［＃「太字」は太字］と傍線［＃「傍線」に傍線］。",
  ...PROSE,
  "［＃ここから２字下げ］",
  "字下げの段落。",
  "［＃ここで字下げ終わり］",
  "［＃地付き］署名",
].join("\n");
// Header → frontmatter; heading keeps five U+3000; bouten ｜字《﹅》; TCY ｟｠.
const YUME =
  FM("夢十夜", "夏目漱石") +
  "### " +
  "\u3000".repeat(5) +
  "第一夜\n" +
  "こんな｜夢《ゆめ》を見た。腕組《うでぐみ》をして坐っていると、\n" +
  "女が｜静《﹅》かな声で云う。\n" +
  "｟12｠月、｟1234｠号、**太字**と||傍線||。\n" +
  PROSE.join("\n") +
  "\n［＃ここから２字下げ］\n字下げの段落。\n［＃ここで字下げ終わり］\n［＃地付き］署名";
const SHORT_SOURCE =
  "短い話\n著者\n\nこれは短い本文です。｜縦《たて》書きの参考表示。";
const SHORT =
  FM("短い話", "著者") + "これは短い本文です。｜縦《たて》書きの参考表示。";
const LONG_URL = "https://example.invalid/" + "a".repeat(260);
const CODE_LINES = [
  "const veryLongLine = " + JSON.stringify("x".repeat(240)) + ";",
  ...Array.from({ length: 79 }, (_, i) => `line${i + 2}();`),
];
const BLOCKS_BODY = [
  "## 見出しと字下げ",
  "",
  ":::indent-3",
  "字下げ三字の段落。縦書きでは行の頭が三字分下がります。",
  ":::",
  "",
  ":::align-end",
  "地付きの署名",
  ":::",
  "",
  ":::page-break",
  ":::",
  "",
  "改ページの後。*強調*と**太字**、||傍線||、<u>下線</u>、<b>生のHTML</b>、｟1234｠号、｜漢字《かんじ》。［＃「残り」に傍点］",
  "",
  ":::blank-page",
  ":::",
  "",
  "長いURL: " + LONG_URL,
  "",
  "[リンク](https://example.invalid/" + "b".repeat(120) + ")",
  "",
  "```js",
  ...CODE_LINES,
  "```",
  "",
  "    indented code line",
  "",
  "- 一",
  "  - 二",
  "    1. 三",
  "",
  "> 引用の段落。",
  "",
].join("\n");
const BLOCKS_SOURCE = "題\n著\n\n" + BLOCKS_BODY;
const BLOCKS = FM("題", "著") + BLOCKS_BODY;
// Just under the 20,000-node budget (S8's 12,000 paragraphs is the limit case).
const MANY_SOURCE = Array.from({ length: 9800 }, (_, i) => "段落" + i).join(
  "\n\n",
);
const MANY =
  "---\ntitle: 段落0\n---\n" +
  Array.from({ length: 9799 }, (_, i) => "段落" + (i + 1)).join("\n\n");
const LINE = "あいうえおかきくけこ";
const NEAR = Array.from({ length: 130000 }, () => LINE).join("\n");
const inputs = [
  ["夢.txt", YUME_SOURCE],
  ["短.txt", SHORT_SOURCE],
  ["blocks.md", BLOCKS_SOURCE],
  ["many.txt", MANY_SOURCE],
  ["near.txt", NEAR],
];
const expected = {
  "夢.md": YUME,
  "短.md": SHORT,
  "blocks_converted.md": BLOCKS,
  "many.md": MANY,
  "near.md": NEAR,
};

// ---- Node public API cross-check ------------------------------------------
{
  const r = await prepareImport(
    inputs.map(([name, text], i) => ({
      id: "n" + i,
      kind: name.endsWith(".md") ? "md" : "txt",
      name,
      bytes: utf8(text),
    })),
    { conversion: structuredClone(DEFAULT_OPTIONS) },
  );
  check("node status", r.status, "completed");
  check(
    "node artifacts equal handwritten bytes",
    Object.fromEntries(
      r.artifacts.map((a) => [a.relativePath, Buffer.from(a.bytes).toString()]),
    ),
    expected,
  );
  check("near output is below 4 MiB", utf8(NEAR).length < 4 * 1048576, true);
}

// ---- Static build facts ---------------------------------------------------
const s8 = JSON.parse(
  await readFile("tests/fixtures/s8-bundle-baseline.json", "utf8"),
);
const vpBase = JSON.parse(
  await readFile("tests/fixtures/vp-baseline.json", "utf8"),
);
const bundles = JSON.parse(await readFile("reports/bundle-sizes.json", "utf8"));
check("existing 9 bundles unchanged", bundles.entries, s8.entries);
for (const name of Object.keys(vpBase.webAssetsBefore))
  check(
    name + " unchanged by the vertical preview",
    sha256(await readFile("web-dist/" + name)),
    vpBase.webAssetsBefore[name],
  );
{
  const sources = await Promise.all(
    ["web/views.ts", "web/preview/vertical.ts", "web/preview/messages.ts"].map(
      (p) => readFile(p, "utf8"),
    ),
  );
  check(
    "no HTML string sinks in the vertical code path",
    sources.some((s) =>
      /innerHTML|outerHTML|insertAdjacentHTML|srcdoc|document\.write/.test(s),
    ),
    false,
  );
  const css = await readFile("web/styles.css", "utf8");
  check(
    "no external fonts, imports or URLs in CSS",
    /@import|@font-face|url\(/.test(css),
    false,
  );
}

const observe = () => {
  const obs = (window.__s8 = { workers: [], urls: 0, live: 0 });
  const Native = window.Worker;
  window.Worker = class extends Native {
    constructor(url, options) {
      super(url, options);
      this.__s8 = obs.workers.length;
      obs.workers.push({ url: String(url), terminated: false });
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
  // Bubble-phase log at window: runs after the surface listener.
  window.__wheel = [];
  addEventListener(
    "wheel",
    (e) =>
      window.__wheel.push({
        dy: e.deltaY,
        dx: e.deltaX,
        prevented: e.defaultPrevented,
        inSurface: !!e.target.closest?.("#preview-surface"),
      }),
    { passive: true },
  );
  window.__longtasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        window.__longtasks.push({ start: e.startTime, ms: e.duration });
    }).observe({ type: "longtask", buffered: true });
  } catch {}
};

let release;
let gate = Promise.resolve();
const held = async (route) => {
  await gate;
  await route.continue().catch(() => {});
};
const temp = await mkdtemp(join(tmpdir(), "aozora-vp-"));
await mkdir("reports/vp-screenshots", { recursive: true });
let browser, web;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  report.chrome = browser.version();
  web = await createWebServer();
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript(observe);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [],
    network = [],
    dialogs = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => network.push(r.url()));
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
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
  const waitStatus = (statuses, timeout = 30000) =>
    page.waitForFunction(
      (s) => s.includes(document.querySelector("#preview").dataset.status),
      statuses,
      { timeout },
    );
  const open = (path) => button(path + "をプレビュー").click();
  const previewWorkers = () =>
    page.evaluate(() =>
      window.__s8.workers.filter((w) => w.url.endsWith("/preview.worker.js")),
    );
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
    const path = `reports/vp-screenshots/${name}.png`;
    await locator.screenshot({ path });
    report.screenshots.push(path);
  };
  const geo = () =>
    page.evaluate(() => {
      const s = document.getElementById("preview-surface");
      const r = s.getBoundingClientRect();
      return {
        mode: getComputedStyle(s).writingMode,
        sl: s.scrollLeft,
        st: s.scrollTop,
        sw: s.scrollWidth,
        cw: s.clientWidth,
        sh: s.scrollHeight,
        ch: s.clientHeight,
        y: scrollY,
        docW: document.documentElement.scrollWidth,
        vw: innerWidth,
        panelRight: document.getElementById("preview").getBoundingClientRect()
          .right,
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
      };
    });
  /** Start of the current mode: rightmost for vertical, top for horizontal. */
  const atStart = () =>
    page.evaluate(() => {
      const s = document.getElementById("preview-surface");
      if (getComputedStyle(s).writingMode === "horizontal-tb")
        return s.scrollTop === 0 && s.scrollLeft === 0;
      const v = s.scrollLeft;
      s.scrollLeft = 1e9;
      const start = s.scrollLeft;
      s.scrollLeft = v;
      return Math.abs(v - start) <= 1;
    });
  const modeState = () =>
    page.evaluate(() => ({
      horizontal: document
        .getElementById("preview-mode-horizontal")
        .getAttribute("aria-pressed"),
      vertical: document
        .getElementById("preview-mode-vertical")
        .getAttribute("aria-pressed"),
      dataset: document.getElementById("preview").dataset.mode,
      writing: getComputedStyle(document.getElementById("preview-surface"))
        .writingMode,
      opsHidden: document.getElementById("preview-vertical-ops").hidden,
      hint: document.getElementById("preview-mode-hint").textContent.trim(),
      notes: [...document.querySelectorAll("#preview-note-list li")].map(
        (li) => li.textContent,
      ),
    }));
  const toSurface = async () => {
    await page.evaluate(() => {
      const s = document.getElementById("preview-surface");
      window.scrollTo(0, s.getBoundingClientRect().top + scrollY - 120);
    });
    const g = await geo();
    await page.mouse.move((g.left + g.right) / 2, (g.top + g.bottom) / 2);
    return g;
  };
  const wheelLog = () => page.evaluate(() => window.__wheel.splice(0));
  const settle = () => page.waitForTimeout(350);

  // ---- Convert, and a ready download before any viewing -----------------
  await page.locator("#files").setInputFiles(
    inputs.map(([name, text]) => ({
      name,
      mimeType: "application/octet-stream",
      buffer: utf8(text),
    })),
  );
  await button("変換を開始").click();
  await idle();
  await button("選択を解除").click();
  await page.getByLabel("出力を選択: 夢.md", { exact: true }).check();
  await page.locator("#delivery-single").check();
  await button("ダウンロード用ファイルを作成").click();
  await idle();
  const before = await acquire("夢.md before viewing", "夢.md");
  check(
    "download before viewing equals handwritten bytes",
    before.toString(),
    YUME,
  );
  const selection = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("#results input[type=checkbox]")].map(
        (c) => c.checked,
      ),
    );
  const selectedBefore = await selection();

  // ---- Default horizontal ------------------------------------------------
  await open("夢.md");
  await waitStatus(["ready"]);
  const horizontalState = await modeState();
  check(
    "default mode is horizontal (aria-pressed, class, ops button, hint)",
    [
      horizontalState.horizontal,
      horizontalState.vertical,
      horizontalState.dataset,
      horizontalState.writing,
      horizontalState.opsHidden,
      horizontalState.hint.startsWith("横書きの参考表示です。"),
    ],
    ["true", "false", "horizontal", "horizontal-tb", true, true],
  );
  check(
    "horizontal lists the tcy-horizontal notice",
    horizontalState.notes.includes(
      "縦中横（｟｠）は横書きでは普通の横並びで表示します。縦書きでの見た目ではありません。",
    ),
    true,
  );
  check(
    "toggle is a labelled group of two buttons inside the preview tab",
    await page.evaluate(() => {
      const g = document.querySelector(".preview-mode");
      return [
        g.getAttribute("role"),
        g.closest("#preview-panel-preview") !== null,
        [...g.querySelectorAll("button")].map((b) => b.textContent.trim()),
      ];
    }),
    ["group", true, ["横書き", "縦書き"]],
  );
  const hTcy = await page.evaluate(
    () =>
      getComputedStyle(document.querySelector("#preview-surface .preview-tcy"))
        .textCombineUpright,
  );
  check("horizontal TCY is not combined", hTcy, "none");
  await shot("yume-horizontal-1440");

  // ---- Switch to vertical: display only ----------------------------------
  await page.evaluate(() => {
    document.getElementById("preview-surface").firstElementChild.__vp = "same";
  });
  const workersBefore = (await previewWorkers()).length;
  const liveBefore = await page.evaluate(() => window.__s8.live);
  const requestsBefore = network.length;
  const summaryBefore = await page.locator("#result-summary").textContent();
  const sourceView = async () => {
    await page.getByRole("tab", { name: "出力テキスト" }).click();
    const r = await page.evaluate(() => ({
      text: document.getElementById("source-text").textContent,
      writing: getComputedStyle(document.getElementById("source-text"))
        .writingMode,
      toggleVisible: !!document.querySelector(".preview-mode").offsetParent,
    }));
    await page.getByRole("tab", { name: "プレビュー" }).click();
    return r;
  };
  const sourceBefore = await sourceView();
  await button("縦書き").click();
  const verticalState = await modeState();
  check(
    "vertical: aria-pressed, dataset, writing-mode, ops button",
    [
      verticalState.horizontal,
      verticalState.vertical,
      verticalState.dataset,
      verticalState.writing,
      verticalState.opsHidden,
    ],
    ["false", "true", "vertical", "vertical-rl", false],
  );
  check(
    "vertical hint is reference-only and names page/kinsoku differences",
    [
      verticalState.hint.startsWith("縦書きの参考表示です。"),
      verticalState.hint.includes("ページ割り"),
      verticalState.hint.includes("禁則"),
    ],
    [true, true, true],
  );
  await button("縦書きの操作").click();
  check(
    "vertical guide opens from the button and states start and direction",
    await page.evaluate(() => {
      const t = document.getElementById("help-popover").textContent;
      const ops = document.getElementById("preview-vertical-ops");
      return [
        document.getElementById("help-popover").hidden,
        ops.getAttribute("aria-expanded"),
        t.includes("右端の行から読み始め"),
        t.includes("右から左"),
        t.includes("ホイールはページのスクロールに戻ります"),
        t.includes("frontmatter"),
      ];
    }),
    [false, "true", true, true, true, true],
  );
  await button("縦書きの操作").click();
  check(
    "the same vertical-ops button closes the guide",
    await page.locator("#help-popover").isHidden(),
    true,
  );
  check(
    "tcy-horizontal notice is horizontal-only; vertical wording replaces it",
    [
      verticalState.notes.some((n) => n.includes("横書きでは普通の横並び")),
      verticalState.notes.some((n) => n.startsWith("縦中横（｟｠）は1文字分")),
      verticalState.notes.length,
    ],
    [false, true, horizontalState.notes.length],
  );
  check(
    "mode switch: no Worker, no request, same DOM, same status",
    [
      (await previewWorkers()).length,
      network.length,
      await page.evaluate(
        () => document.getElementById("preview-surface").firstElementChild.__vp,
      ),
      await status(),
    ],
    [workersBefore, requestsBefore, "same", "ready"],
  );
  check(
    "mode switch keeps selection, ready and object URLs",
    [
      await selection(),
      await page.locator("#ready").isVisible(),
      await page.evaluate(() => window.__s8.live),
    ],
    [selectedBefore, true, liveBefore],
  );
  check(
    "result summary (counts) unchanged by the mode",
    await page.locator("#result-summary").textContent(),
    summaryBefore,
  );

  // ---- Vertical geometry -------------------------------------------------
  let g = await toSurface();
  check(
    "surface width is fixed; no page overflow; no vertical overflow",
    [g.right <= g.panelRight, g.docW <= g.vw, g.sw > g.cw, g.sh <= g.ch + 1],
    [true, true, true, true],
  );
  report.measurements.yume1440 = g;
  check("vertical opens at the reading start", await atStart(), true);
  const typo = await page.evaluate(() => {
    const s = document.getElementById("preview-surface");
    const sr = s.getBoundingClientRect();
    const tcy = [...s.querySelectorAll(".preview-tcy")];
    const h3 = s.querySelector("h3");
    const fs = parseFloat(getComputedStyle(s).fontSize);
    const fm = s.querySelector(".preview-frontmatter").getBoundingClientRect();
    return {
      fmRight: sr.right - fm.right,
      h3AfterFm: fm.left - h3.getBoundingClientRect().right,
      tcy: tcy.map((t) => ({
        text: t.textContent,
        combine: getComputedStyle(t).textCombineUpright,
        width: t.getBoundingClientRect().width / fs,
        height: t.getBoundingClientRect().height / fs,
      })),
      rt: [...s.querySelectorAll("ruby rt")].map((r) => r.textContent),
      rtRightOfBase: (() => {
        const ruby = s.querySelector("ruby");
        const rt = ruby.querySelector("rt").getBoundingClientRect();
        const base = ruby.getBoundingClientRect();
        return rt.left >= base.left + base.width / 2 - 1;
      })(),
      underline: getComputedStyle(s.querySelector(".preview-underline"))
        .textUnderlinePosition,
      literalNotes: s.textContent.includes("［＃ここから２字下げ］"),
    };
  });
  report.measurements.readingStart = {
    fmRight: typo.fmRight,
    h3AfterFm: typo.h3AfterFm,
  };
  check(
    "frontmatter island at the right edge, heading is the next column to its left",
    [
      typo.fmRight >= 0 && typo.fmRight < 20,
      typo.h3AfterFm >= 0 && typo.h3AfterFm < 60,
    ],
    [true, true],
  );
  check(
    "TCY combined upright within one em",
    typo.tcy.map((t) => [t.text, t.combine, t.width <= 1.3, t.height <= 1.3]),
    [
      ["12", "all", true, true],
      ["1234", "all", true, true],
    ],
  );
  check("ruby readings kept (explicit, kanji, bouten)", typo.rt, [
    "ゆめ",
    "うでぐみ",
    "﹅",
  ]);
  check("ruby text sits on the right of its base", typo.rtRightOfBase, true);
  check("underline on the right side", typo.underline, "right");
  check("remaining notes stay literal", typo.literalNotes, true);
  await shot("yume-vertical-1440");

  // ---- Wheel (native Playwright wheel over the surface) -----------------
  await wheelLog();
  const y0 = (await geo()).y;
  const sl0 = (await geo()).sl;
  await page.mouse.wheel(0, 200);
  await settle();
  g = await geo();
  near("native wheel down advances 200px leftward", sl0 - g.sl, 200, 1);
  check("wheel down inside does not scroll the page", g.y, y0);
  await page.mouse.wheel(0, -100);
  await settle();
  near(
    "native wheel up returns 100px rightward",
    sl0 - (await geo()).sl,
    100,
    1,
  );
  check(
    "handled wheels were cancelled",
    (await wheelLog()).map((w) => [w.inSurface, w.prevented]),
    [
      [true, true],
      [true, true],
    ],
  );
  await page.mouse.wheel(0, -500);
  await settle();
  check("wheel up reaches the start", await atStart(), true);
  await wheelLog();
  const yStart = (await geo()).y;
  await page.mouse.wheel(0, -120);
  await settle();
  g = await geo();
  check(
    "wheel up at the start is not cancelled and scrolls the page",
    [(await wheelLog()).map((w) => w.prevented), g.y < yStart],
    [[false], true],
  );
  await toSurface();
  await page.evaluate(
    () => (document.getElementById("preview-surface").scrollLeft = -1e9),
  );
  const slEnd = (await geo()).sl;
  const yEnd = (await geo()).y;
  await wheelLog();
  await page.mouse.wheel(0, 150);
  await settle();
  g = await geo();
  check(
    "wheel down at the end is not cancelled and scrolls the page",
    [(await wheelLog()).map((w) => w.prevented), g.sl, g.y > yEnd],
    [[false], slEnd, true],
  );
  // Ten native wheel notches: exact sum, no page movement (no double scroll).
  await toSurface();
  await page.evaluate(
    () => (document.getElementById("preview-surface").scrollLeft = 1e9),
  );
  const a0 = await geo();
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 100);
  await settle();
  const a1 = await geo();
  near("ten wheel notches move exactly 1000px", a0.sl - a1.sl, 1000, 2);
  check("no page scroll during continuous wheel", a1.y, a0.y);
  await wheelLog();
  // Modifiers and horizontal gestures are left to the browser.
  const slMod = (await geo()).sl;
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, 100);
  await page.keyboard.up("Control");
  await page.keyboard.down("Meta");
  await page.mouse.wheel(0, 100);
  await page.keyboard.up("Meta");
  await settle();
  check(
    "Ctrl/Meta wheel: not cancelled, no mapped advance",
    [(await wheelLog()).map((w) => w.prevented), (await geo()).sl],
    [[false, false], slMod],
  );
  await page.keyboard.down("Shift");
  await page.mouse.wheel(0, 100);
  await page.keyboard.up("Shift");
  await settle();
  check(
    "Shift wheel: not cancelled by the preview",
    (await wheelLog()).map((w) => w.prevented),
    [false],
  );
  const slX = (await geo()).sl;
  await page.mouse.wheel(-120, 0);
  await settle();
  const xLog = await wheelLog();
  check(
    "horizontal gesture: not cancelled; the browser scrolls it natively",
    [xLog.map((w) => w.prevented), (await geo()).sl < slX],
    [[false], true],
  );
  // Synthetic WheelEvents: deltaMode and cancelable (handler mapping only).
  const synthetic = await page.evaluate(() => {
    const s = document.getElementById("preview-surface");
    const line = parseFloat(getComputedStyle(s).lineHeight);
    s.scrollLeft = 1e9;
    const out = { line, cw: s.clientWidth };
    const fire = (init) => {
      const b = s.scrollLeft;
      const e = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        ...init,
      });
      s.dispatchEvent(e);
      return { moved: b - s.scrollLeft, prevented: e.defaultPrevented };
    };
    out.lines = fire({ deltaY: 3, deltaMode: 1 });
    out.page = fire({ deltaY: 1, deltaMode: 2 });
    out.small = fire({ deltaY: 0.4 });
    out.uncancelable = fire({ deltaY: 100, cancelable: false });
    out.back = fire({ deltaY: -1, deltaMode: 2 });
    return out;
  });
  report.measurements.syntheticWheel = synthetic;
  near(
    "synthetic line mode: 3 lines",
    synthetic.lines.moved,
    3 * synthetic.line,
    1,
  );
  near(
    "synthetic page mode keeps one line",
    synthetic.page.moved,
    synthetic.cw - synthetic.line,
    1,
  );
  check(
    "synthetic small delta and non-cancelable",
    [
      synthetic.small.moved >= 0.5,
      synthetic.small.prevented,
      synthetic.uncancelable,
    ],
    [true, true, { moved: 0, prevented: false }],
  );
  // Wheel outside the surface is never taken.
  await wheelLog();
  await page.locator("#preview-target").scrollIntoViewIfNeeded();
  const outside = await page.locator("#preview-target").boundingBox();
  await page.mouse.move(outside.x + 10, outside.y + outside.height / 2);
  const slOut = (await geo()).sl;
  await page.mouse.wheel(0, 100);
  await settle();
  check(
    "wheel outside the surface: not cancelled, surface unchanged",
    [
      (await wheelLog()).map((w) => [w.inSurface, w.prevented]),
      (await geo()).sl,
    ],
    [[[false, false]], slOut],
  );

  // ---- Keyboard ----------------------------------------------------------
  await toSurface();
  await page.locator("#preview-mode-vertical").focus();
  const tabStops = [];
  for (let i = 0; i < 6 && tabStops.at(-1)?.[0] !== "preview-surface"; i++) {
    await page.keyboard.press("Tab");
    tabStops.push(
      await page.evaluate(() => {
        const a = document.activeElement;
        return [a.id, a.getAttribute("role"), a.getAttribute("aria-label")];
      }),
    );
  }
  check(
    "Tab from the toggle passes the face and ops buttons, then the vertical region",
    tabStops,
    [
      ["preview-face-gothic", null, null],
      ["preview-face-mincho", null, null],
      ["preview-vertical-ops", null, "縦書きの操作"],
      ["preview-surface", "region", "縦書きのプレビュー本文"],
    ],
  );
  const focus = await page.evaluate(() => {
    const a = document.activeElement;
    return [a.matches(":focus-visible"), getComputedStyle(a).outlineStyle];
  });
  check("the vertical region shows a focus ring", focus, [true, "solid"]);
  const k0 = await geo();
  const line = synthetic.line;
  const keyStep = async (key) => {
    const b = (await geo()).sl;
    await page.keyboard.press(key);
    return b - (await geo()).sl;
  };
  await page.evaluate(
    () => (document.getElementById("preview-surface").scrollLeft = 1e9),
  );
  near("ArrowLeft advances one line", await keyStep("ArrowLeft"), line, 1);
  near("ArrowRight goes back one line", await keyStep("ArrowRight"), -line, 1);
  near(
    "PageDown advances a page minus one line",
    await keyStep("PageDown"),
    k0.cw - line,
    1,
  );
  near("PageUp goes back a page", await keyStep("PageUp"), -(k0.cw - line), 1);
  await page.keyboard.press("End");
  check(
    "End reaches the end",
    await page.evaluate(() => {
      const s = document.getElementById("preview-surface");
      const v = s.scrollLeft;
      s.scrollLeft = -1e9;
      const end = s.scrollLeft;
      s.scrollLeft = v;
      return Math.abs(v - end) <= 1;
    }),
    true,
  );
  await page.keyboard.press("Home");
  check("Home returns to the start", await atStart(), true);
  check("page did not move during keyboard paging", (await geo()).y, k0.y);
  // Toggle and tabs remain keyboard operable.
  await page.locator("#preview-mode-horizontal").focus();
  await page.keyboard.press("Enter");
  check("Enter on 横書き switches", (await modeState()).horizontal, "true");
  await page.locator("#preview-mode-vertical").focus();
  await page.keyboard.press("Space");
  check("Space on 縦書き switches", (await modeState()).vertical, "true");
  await page.getByRole("tab", { name: "プレビュー" }).focus();
  await page.keyboard.press("ArrowRight");
  check(
    "tab arrow keys still work",
    await page.evaluate(() => document.activeElement.id),
    "preview-tab-source",
  );
  await page.keyboard.press("ArrowLeft");
  // Text selection inside the vertical area.
  await page.locator("#preview-surface h3").click({ clickCount: 3 });
  check(
    "text selection works in vertical mode",
    await page.evaluate(() => getSelection().toString().includes("第一夜")),
    true,
  );
  await page.evaluate(() => getSelection().removeAllRanges());

  // ---- Mode switch and file switch return to the reading start -----------
  await page.evaluate(
    () => (document.getElementById("preview-surface").scrollLeft = -600),
  );
  check("scrolled away from the start", await atStart(), false);
  await button("横書き").click();
  check("switch to horizontal starts at the top", await atStart(), true);
  await page.evaluate(
    () => (document.getElementById("preview-surface").scrollTop = 500),
  );
  await button("縦書き").click();
  check(
    "switch back to vertical starts at the right edge",
    await atStart(),
    true,
  );
  await page.evaluate(
    () => (document.getElementById("preview-surface").scrollLeft = -600),
  );
  // Blocks: kept vertical, reading start, islands.
  await open("blocks_converted.md");
  await waitStatus(["ready"]);
  check(
    "vertical kept across file switch, opened at the start",
    [(await modeState()).vertical, await atStart()],
    ["true", true],
  );
  g = await toSurface();
  const islands = await page.evaluate(() => {
    const s = document.getElementById("preview-surface");
    const sr = s.getBoundingClientRect();
    const box = (e) => e.getBoundingClientRect();
    const code = s.querySelector(".preview-code");
    const pre = code.querySelector("pre");
    const fm = s.querySelector(".preview-frontmatter");
    const fs = parseFloat(getComputedStyle(s).fontSize);
    const within = [...s.querySelectorAll(".preview-body > *")].map((e) => {
      const r = box(e);
      return (
        r.width > 0 &&
        r.height > 0 &&
        r.top >= sr.top - 1 &&
        r.bottom <= sr.bottom + 1
      );
    });
    const indent = s.querySelector(".preview-indent-3");
    const end = s.querySelector(".preview-align-end p");
    const range = document.createRange();
    range.selectNodeContents(end);
    const er = range.getBoundingClientRect();
    const endBox = box(end);
    return {
      codeMode: getComputedStyle(code).writingMode,
      fmMode: getComputedStyle(fm).writingMode,
      codeFits: box(code).height <= s.clientHeight + 1,
      codeWidthLimited: box(code).width <= s.clientWidth * 0.9 + 1,
      preScrollsX: pre.scrollWidth > pre.clientWidth,
      preScrollsY: pre.scrollHeight > pre.clientHeight,
      preText: pre.textContent,
      allBlocksInsideColumn: within.every(Boolean),
      blocks: within.length,
      indentTop: parseFloat(getComputedStyle(indent).marginTop) / fs,
      alignEndGap: endBox.bottom - er.bottom,
      separators: [...s.querySelectorAll('[role="separator"]')].map((e) => [
        e.textContent,
        box(e).height > box(e).width,
      ]),
      url: (() => {
        const u = s.querySelector(".preview-body > p .preview-url") ?? null;
        return u ? box(u).bottom <= sr.bottom + 1 : null;
      })(),
      rawHtml: s.textContent.includes("<b>生のHTML</b>"),
      underlines: [...s.querySelectorAll("u")].map((u) => u.textContent),
      noticeCount: document.querySelectorAll("#preview-note-list li").length,
    };
  });
  report.measurements.islands = islands;
  check(
    "islands: code and frontmatter are horizontal inside vertical text",
    [islands.codeMode, islands.fmMode],
    ["horizontal-tb", "horizontal-tb"],
  );
  check(
    "code island bounded; long line and many lines scroll inside",
    [
      islands.codeFits,
      islands.codeWidthLimited,
      islands.preScrollsX,
      islands.preScrollsY,
    ],
    [true, true, true, true],
  );
  check(
    "code island text is complete",
    islands.preText,
    CODE_LINES.join("\n") + "\n",
  );
  check(
    "every body block is visible inside the column length",
    islands.allBlocksInsideColumn,
    true,
  );
  near(
    "indent-3 is 3em from the top of the column",
    islands.indentTop,
    3,
    0.05,
  );
  check("align-end text ends at the bottom", islands.alignEndGap <= 2, true);
  check(
    "page separators run vertically",
    islands.separators.map(([, v]) => v),
    [true, true],
  );
  check(
    "raw HTML stays literal; exact <u> underlines",
    [islands.rawHtml, islands.underlines],
    [true, ["傍線", "下線"]],
  );
  check(
    "no page overflow with long URL and code",
    (await geo()).docW <= (await geo()).vw,
    true,
  );
  // A vertical wheel over the code island scrolls the island first.
  await page.evaluate(() =>
    document
      .querySelector("#preview-surface .preview-code pre")
      .scrollIntoView({ block: "center", inline: "center" }),
  );
  const preBox = await page
    .locator("#preview-surface .preview-code pre")
    .first()
    .boundingBox();
  await page.mouse.move(
    preBox.x + preBox.width / 2,
    preBox.y + preBox.height / 2,
  );
  await wheelLog();
  const beforeIsland = await page.evaluate(() => [
    document.getElementById("preview-surface").scrollLeft,
    document.querySelector("#preview-surface .preview-code pre").scrollTop,
  ]);
  await page.mouse.wheel(0, 100);
  await settle();
  const afterIsland = await page.evaluate(() => [
    document.getElementById("preview-surface").scrollLeft,
    document.querySelector("#preview-surface .preview-code pre").scrollTop,
  ]);
  check(
    "wheel over a vertically scrollable island scrolls the island, not the columns",
    [afterIsland[0], afterIsland[1] > beforeIsland[1]],
    [beforeIsland[0], true],
  );
  await shot("blocks-vertical-1440");
  await page.evaluate(
    () => (document.getElementById("preview-surface").scrollLeft = -1e9),
  );
  await shot("blocks-vertical-end-1440");

  // Short text: no horizontal scroll needed, opens at the start.
  await open("短.md");
  await waitStatus(["ready"]);
  g = await geo();
  check(
    "short text: fits without scrolling, at start",
    [g.sw <= g.cw + 1, await atStart()],
    [true, true],
  );
  await shot("short-vertical-1440");

  // ---- Close / reopen / source tab / horizontal back ---------------------
  await button("閲覧を閉じる").click();
  check(
    "close terminates every preview Worker",
    (await previewWorkers()).every((w) => w.terminated),
    true,
  );
  await open("夢.md");
  await waitStatus(["ready"]);
  check(
    "reopen keeps vertical and starts at the right edge",
    [(await modeState()).vertical, await atStart()],
    ["true", true],
  );
  const sourceAfter = await sourceView();
  check(
    "出力テキスト tab is horizontal, unchanged and hides the toggle",
    [sourceAfter.text, sourceAfter.writing, sourceAfter.toggleVisible],
    [sourceBefore.text, "horizontal-tb", false],
  );
  check("source text is the full artifact", sourceAfter.text, YUME);
  await page.getByRole("tab", { name: "出力テキスト" }).click();
  await wheelLog();
  const src = await page.locator("#source-text").boundingBox();
  await page.mouse.move(
    src.x + src.width / 2,
    src.y + Math.min(40, src.height / 2),
  );
  await page.mouse.wheel(0, 100);
  await settle();
  check(
    "source tab wheel is never cancelled",
    (await wheelLog()).map((w) => w.prevented),
    [false],
  );
  await page.getByRole("tab", { name: "プレビュー" }).click();
  check(
    "preview tab returns in vertical",
    (await modeState()).writing,
    "vertical-rl",
  );
  await button("横書き").click();
  g = await toSurface();
  await wheelLog();
  await page.mouse.wheel(0, 100);
  await settle();
  check(
    "horizontal: wheel is native (not cancelled), surface scrolls vertically",
    [(await wheelLog()).map((w) => w.prevented), (await geo()).st > 0],
    [[false], true],
  );
  check(
    "horizontal again lists tcy-horizontal",
    (await modeState()).notes.some((n) => n.includes("横書きでは普通の横並び")),
    true,
  );
  check(
    "horizontal surface has no vertical-only attributes",
    await page.evaluate(() => {
      const s = document.getElementById("preview-surface");
      return [s.hasAttribute("tabindex"), s.getAttribute("role")];
    }),
    [false, null],
  );
  await button("縦書き").click();

  // ---- Stale results, failure and timeout recovery in vertical ----------
  gate = new Promise((r) => (release = r));
  await page.route("**/preview.worker.js", held);
  await open("blocks_converted.md");
  await waitStatus(["loading"]);
  await button("横書き").click();
  await button("縦書き").click();
  check("mode switch while loading keeps loading", await status(), "loading");
  await open("夢.md");
  const switched = await previewWorkers();
  check(
    "file switch while loading terminates the older Worker",
    switched.slice(0, -1).every((w) => w.terminated),
    true,
  );
  release();
  await waitStatus(["ready"]);
  await page.unroute("**/preview.worker.js");
  check(
    "only the newer file is shown, vertical, at start",
    [
      (await page.locator("#preview-target").textContent()).includes("夢.md"),
      (await page.locator("#preview-surface").textContent()).includes(
        "生のHTML",
      ),
      await atStart(),
    ],
    [true, false, true],
  );
  await page.route("**/preview.worker.js", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await open("短.md");
  await waitStatus(["failed"]);
  check(
    "injected 404 in vertical: failed, toggle usable",
    await button("横書き").isEnabled(),
    true,
  );
  await page.unroute("**/preview.worker.js");
  await button("もう一度表示する").click();
  await waitStatus(["ready"]);
  check(
    "recovers after 404 in vertical at the start",
    [(await modeState()).vertical, await atStart()],
    ["true", true],
  );
  await page.route("**/preview.worker.js", (route) =>
    route.fulfill({
      contentType: "text/javascript; charset=utf-8",
      body: 'self.addEventListener("message", () => {});',
    }),
  );
  const t0 = Date.now();
  await open("夢.md");
  await waitStatus(["timeout"], 12000);
  report.timings["injected never-reply until timeout (vertical)"] =
    Date.now() - t0;
  await page.unroute("**/preview.worker.js");
  await button("もう一度表示する").click();
  await waitStatus(["ready"]);
  check(
    "recovers after timeout in vertical at the start",
    [(await modeState()).vertical, await atStart()],
    ["true", true],
  );

  // ---- Measurements: normal and near-limit text --------------------------
  const switchTime = (to) =>
    page.evaluate(async (to) => {
      const b = document.getElementById("preview-mode-" + to);
      const s = document.getElementById("preview-surface");
      const t0 = performance.now();
      b.click();
      void s.scrollWidth;
      const t1 = performance.now();
      await new Promise((r) =>
        requestAnimationFrame(() => requestAnimationFrame(r)),
      );
      return {
        clickToLayoutMs: Math.round(t1 - t0),
        clickToSecondFrameMs: Math.round(performance.now() - t0),
      };
    }, to);
  const wheelTime = () =>
    page.evaluate(async () => {
      const s = document.getElementById("preview-surface");
      s.scrollLeft = -Math.floor((s.scrollWidth - s.clientWidth) / 2);
      const samples = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        s.dispatchEvent(
          new WheelEvent("wheel", {
            deltaY: 300,
            bubbles: true,
            cancelable: true,
          }),
        );
        await new Promise((r) =>
          requestAnimationFrame(() => requestAnimationFrame(r)),
        );
        samples.push(Math.round(performance.now() - t0));
      }
      return samples;
    });
  const measure = async (name, file) => {
    const m = {};
    await button("横書き").click();
    let t = Date.now();
    await open(file);
    await waitStatus(["ready", "limit", "timeout", "failed"], 60000);
    m.horizontalOpenMs = Date.now() - t;
    m.horizontalStatus = await status();
    report.measurements[name] = m;
    if (m.horizontalStatus !== "ready") return m;
    await page.evaluate(() => (window.__longtasks.length = 0));
    m.toVertical = await switchTime("vertical");
    m.toHorizontal = await switchTime("horizontal");
    m.toVerticalAgain = await switchTime("vertical");
    m.verticalScrollWidth = await page.evaluate(
      () => document.getElementById("preview-surface").scrollWidth,
    );
    m.wheelToSecondFrameMs = await wheelTime();
    t = Date.now();
    await open(file);
    await waitStatus(["ready", "limit", "timeout", "failed"], 60000);
    m.verticalOpenMs = Date.now() - t;
    m.verticalStatus = await status();
    const p = Date.now();
    await page.evaluate(() => 1);
    m.mainThreadAfterVerticalOpenMs = Date.now() - p;
    m.longestTaskMs = await page.evaluate(() =>
      Math.round(Math.max(0, ...window.__longtasks.map((l) => l.ms))),
    );
    m.atStart = await atStart();
    report.measurements[name] = m;
    return m;
  };
  const mYume = await measure("normal (夢.md)", "夢.md");
  const mMany = await measure("many paragraphs (many.md, 9,800)", "many.md");
  const mNear = await measure("near limit (near.md, 130,000 lines)", "near.md");
  for (const [label, m] of [
    ["夢", mYume],
    ["many", mMany],
    ["near", mNear],
  ])
    check(
      `${label}: vertical ready, at the start`,
      [m.verticalStatus, m.atStart],
      ["ready", true],
    );
  check(
    "normal text switches within one second",
    mYume.toVertical.clickToSecondFrameMs < 1000,
    true,
  );
  await button("縦書き").click();
  await shot("near-vertical-1440");

  // ---- Final download: bytes unchanged -----------------------------------
  const after = await acquire("夢.md after viewing", "夢.md");
  check(
    "download bytes identical before/after vertical viewing",
    sha256(after),
    sha256(before),
  );
  check("selection unchanged at the end", await selection(), selectedBefore);

  // ---- Widths 768 / 390 --------------------------------------------------
  await open("夢.md");
  await waitStatus(["ready"]);
  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await open("夢.md");
    await waitStatus(["ready"]);
    g = await toSurface();
    check(
      `${width}: vertical fits the page, column-bounded`,
      [g.docW <= g.vw, g.sh <= g.ch + 1, await atStart()],
      [true, true, true],
    );
    await shot(`yume-vertical-${width}`);
    await open("blocks_converted.md");
    await waitStatus(["ready"]);
    g = await geo();
    check(`${width}: islands do not widen the page`, g.docW <= g.vw, true);
    await shot(`blocks-vertical-${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 900 });

  // ---- Reload resets to horizontal ---------------------------------------
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector("#boot-error").hidden,
  );
  await page.locator("#files").setInputFiles({
    name: "短.txt",
    mimeType: "text/plain",
    buffer: utf8(SHORT_SOURCE),
  });
  await button("変換を開始").click();
  await idle();
  await open("短.md");
  await waitStatus(["ready"]);
  check(
    "reload resets the mode to horizontal",
    (await modeState()).horizontal,
    "true",
  );
  check("no page errors or dialogs", [errors, dialogs], [[], []]);
  await context.close();

  // ---- Synthetic touch (CDP gesture, not a real device) -----------------
  const touch = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
  });
  await touch.addInitScript(observe);
  try {
    const tp = await touch.newPage();
    await tp.goto(web.url);
    await tp.waitForFunction(
      () => document.querySelector("#boot-error").hidden,
    );
    await tp.locator("#files").setInputFiles({
      name: "夢.txt",
      mimeType: "text/plain",
      buffer: utf8(YUME_SOURCE),
    });
    await tp.getByRole("button", { name: "変換を開始", exact: true }).click();
    await tp.waitForFunction(() => document.querySelector("#cancel").disabled);
    await tp
      .getByRole("button", { name: "夢.mdをプレビュー", exact: true })
      .click();
    await tp.waitForFunction(
      () => document.querySelector("#preview").dataset.status === "ready",
    );
    await tp.getByRole("button", { name: "縦書き", exact: true }).tap();
    const box = await tp.evaluate(() => {
      const s = document.getElementById("preview-surface");
      s.scrollIntoView({ block: "center" });
      const r = s.getBoundingClientRect();
      return {
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        sl: s.scrollLeft,
        y0: scrollY,
      };
    });
    const cdp = await touch.newCDPSession(tp);
    await cdp.send("Input.synthesizeScrollGesture", {
      x: Math.round(box.x),
      y: Math.round(box.y),
      xDistance: 200,
      yDistance: 0,
      gestureSourceType: "touch",
      speed: 600,
    });
    await tp.waitForTimeout(400);
    const afterSwipe = await tp.evaluate(() => ({
      sl: document.getElementById("preview-surface").scrollLeft,
      wheels: window.__wheel.length,
      x: scrollX,
      docW: document.documentElement.scrollWidth,
      vw: innerWidth,
    }));
    report.measurements.syntheticTouch = { before: box, after: afterSwipe };
    check(
      "synthetic touch swipe scrolls columns natively; no wheel handling; no page overflow",
      [
        afterSwipe.sl < box.sl - 50,
        afterSwipe.wheels,
        afterSwipe.x,
        afterSwipe.docW <= afterSwipe.vw,
      ],
      [true, 0, 0, true],
    );
    await cdp.send("Input.synthesizeScrollGesture", {
      x: Math.round(box.x),
      y: Math.round(box.y),
      xDistance: 0,
      yDistance: -200,
      gestureSourceType: "touch",
      speed: 600,
    });
    await tp.waitForTimeout(400);
    check(
      "synthetic vertical swipe on the surface scrolls the page",
      await tp.evaluate((y0) => scrollY > y0, box.y0),
      true,
    );
  } finally {
    await touch.close();
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
    await zp.locator("#files").setInputFiles([
      { name: "夢.txt", mimeType: "text/plain", buffer: utf8(YUME_SOURCE) },
      {
        name: "blocks.md",
        mimeType: "text/plain",
        buffer: utf8(BLOCKS_SOURCE),
      },
    ]);
    await zp.getByRole("button", { name: "変換を開始", exact: true }).click();
    await zp.waitForFunction(() => document.querySelector("#cancel").disabled);
    const cdp = await zoom.newCDPSession(zp);
    for (const [file, name] of [
      ["夢.md", "zoom-200-yume"],
      ["blocks_converted.md", "zoom-200-blocks"],
    ]) {
      await zp
        .getByRole("button", { name: file + "をプレビュー", exact: true })
        .click();
      await zp.waitForFunction(
        () => document.querySelector("#preview").dataset.status === "ready",
      );
      if (
        (await zp
          .locator("#preview-mode-vertical")
          .getAttribute("aria-pressed")) !== "true"
      )
        await zp.getByRole("button", { name: "縦書き", exact: true }).click();
      await zp.locator("#preview-surface").scrollIntoViewIfNeeded();
      const z = await zp.evaluate(() => {
        const s = document.getElementById("preview-surface");
        return {
          inner: innerWidth,
          dpr: devicePixelRatio,
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          writing: getComputedStyle(s).writingMode,
          columnBounded: s.scrollHeight <= s.clientHeight + 1,
        };
      });
      check(`200% zoom ${file} vertical geometry`, z, {
        inner: 720,
        dpr: 2,
        overflow: false,
        writing: "vertical-rl",
        columnBounded: true,
      });
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
      const path = `reports/vp-screenshots/${name}.png`;
      await writeFile(path, Buffer.from(capture.data, "base64"));
      report.screenshots.push(path);
    }
  } finally {
    await zoom.close();
  }
  report.completed = true;
} finally {
  await browser?.close();
  await web?.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(
    "reports/vp-browser-smoke.json",
    JSON.stringify(report, null, 2) + "\n",
  );
}
console.log(
  JSON.stringify({
    checks: report.checks.length,
    downloads: report.downloads.length,
    timings: report.timings,
    completed: report.completed,
  }),
);
