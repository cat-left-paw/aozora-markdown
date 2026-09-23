// FUI: preview guide, typeface, and the intro note (aozora-web-v6) in real
// Chrome against the built Web app. Artifact bytes are handwritten and
// cross-checked against the Node public API before the browser runs.
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
  slice: "FUI",
  contract: "aozora-web-v6",
  previewContract: "aozora-preview-v1",
  startedAt: new Date().toISOString(),
  node: process.version,
  checks: [],
  downloads: [],
  measurements: {},
  screenshots: [],
  unverified: [
    "real touch devices",
    "browsers other than Chrome",
    "assistive technology output",
    "glyph identity across machines that lack the named OS fonts",
  ],
  completed: false,
};
const check = (label, actual, expected) => {
  assert.deepEqual(actual, expected, label);
  report.checks.push(label);
};
const utf8 = (s) => Buffer.from(s, "utf8");
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const FM = (title, author) => `---\ntitle: ${title}\nauthor: ${author}\n---\n`;
const NOTE =
  "青空文庫の注記や組版は、標準的なMarkdownだけでは完全に再現できません。一部は近い表現やNyoze向け記法に変換します。対応しない注記が残る場合は、出力後に警告・未変換注記をご確認ください。";

const PROSE = Array.from(
  { length: 28 },
  (_, i) => `長い段落${i}。窓の外には雨が降っている。`,
);
const CODE = Array.from({ length: 30 }, (_, i) => `code ${i}`);
const HAND_SOURCE = [
  "試験の題",
  "試験の著者",
  "",
  "［＃３字下げ］本文の見出し［＃「本文の見出し」は大見出し］",
  "これは｜漢字《かんじ》と傍点［＃「傍点」に傍点］の文です。",
  "A［＃「A」は縦中横］、12［＃「12」は縦中横］、123［＃「123」は縦中横］、1234［＃「1234」は縦中横］。",
  ...PROSE,
  "```txt",
  ...CODE,
  "```",
].join("\n");
const HAND =
  FM("試験の題", "試験の著者") +
  "## " +
  "\u3000".repeat(3) +
  "本文の見出し\n" +
  "これは｜漢字《かんじ》と｜傍《﹅》｜点《﹅》の文です。\n" +
  "｟A｠、｟12｠、｟123｠、｟1234｠。\n" +
  PROSE.join("\n") +
  "\n```txt\n" +
  CODE.join("\n") +
  "\n```";
const CONTROL_SOURCE = "対照題\n対照著者\n\n何も注記のない一行です。\n";
const CONTROL = FM("対照題", "対照著者") + "何も注記のない一行です。\n";

{
  const r = await prepareImport(
    [
      ["試験.txt", HAND_SOURCE],
      ["対照.txt", CONTROL_SOURCE],
    ].map(([name, text], i) => ({
      id: "n" + i,
      kind: "txt",
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
    { "試験.md": HAND, "対照.md": CONTROL },
  );
}

const observe = () => {
  const obs = (window.__fui = { workers: [], urls: 0, live: 0 });
  const Native = window.Worker;
  window.Worker = class extends Native {
    constructor(url, options) {
      super(url, options);
      this.__fui = obs.workers.length;
      obs.workers.push({ url: String(url), terminated: false });
    }
    terminate() {
      obs.workers[this.__fui].terminated = true;
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

const temp = await mkdtemp(join(tmpdir(), "aozora-fui-"));
await mkdir("reports/fui-screenshots", { recursive: true });
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
  const network = [];
  page.on("pageerror", (e) => {
    throw e;
  });
  page.on("request", (r) => network.push(r.url()));
  await page.goto(web.url);
  await page.waitForFunction(
    () => document.querySelector("#boot-error").hidden,
  );
  const button = (name) => page.getByRole("button", { name, exact: true });
  const idle = () =>
    page.waitForFunction(() => document.querySelector("#cancel").disabled);
  const waitStatus = (statuses) =>
    page.waitForFunction(
      (s) => s.includes(document.querySelector("#preview").dataset.status),
      statuses,
    );
  const previewWorkers = () =>
    page.evaluate(() =>
      window.__fui.workers.filter((w) => w.url.endsWith("/preview.worker.js")),
    );
  const selection = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("#results input[type=checkbox]")].map(
        (c) => c.checked,
      ),
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
    const path = `reports/fui-screenshots/${name}.png`;
    await locator.screenshot({ path });
    report.screenshots.push(path);
  };
  const reading = () =>
    page.evaluate(() => {
      const s = document.getElementById("preview-surface");
      const pop = document.getElementById("help-popover");
      const ops = document.getElementById("preview-vertical-ops");
      const body = s.querySelector(".preview-body p");
      const heading = s.querySelector(".preview-body h2");
      const ruby = s.querySelector(".preview-body ruby");
      const tcy = [...s.querySelectorAll(".preview-tcy")].map((n) => ({
        text: n.textContent,
        combine: getComputedStyle(n).textCombineUpright,
      }));
      const code = s.querySelector(".preview-code code");
      const fm = s.querySelector(".preview-frontmatter");
      const source = document.getElementById("source-text");
      const oldPx = Math.min(
        innerHeight * 0.7,
        40 * parseFloat(getComputedStyle(document.documentElement).fontSize),
      );
      return {
        ch: s.clientHeight,
        sh: s.scrollHeight,
        sl: s.scrollLeft,
        st: s.scrollTop,
        oldPx,
        taller: s.clientHeight > oldPx + 16,
        writing: getComputedStyle(s).writingMode,
        face: document.getElementById("preview").dataset.face,
        gothicPressed: document
          .getElementById("preview-face-gothic")
          .getAttribute("aria-pressed"),
        minchoPressed: document
          .getElementById("preview-face-mincho")
          .getAttribute("aria-pressed"),
        bodyFamily: body ? getComputedStyle(body).fontFamily : "",
        headingFamily: heading ? getComputedStyle(heading).fontFamily : "",
        rubyFamily: ruby ? getComputedStyle(ruby).fontFamily : "",
        codeFamily: code ? getComputedStyle(code).fontFamily : "",
        fmFamily: fm ? getComputedStyle(fm).fontFamily : "",
        sourceFamily: getComputedStyle(source).fontFamily,
        uiFamily: getComputedStyle(document.body).fontFamily,
        tcy,
        opsHidden: ops.hidden,
        opsExpanded: ops.getAttribute("aria-expanded"),
        popHidden: pop.hidden,
        popText: pop.hidden ? "" : pop.textContent,
        docW: document.documentElement.scrollWidth,
        vw: innerWidth,
        vh: innerHeight,
      };
    });

  const note = await page.evaluate(() => {
    const n = document.getElementById("conversion-limits");
    const privacy = document.querySelector(".privacy");
    return {
      text: n.textContent.trim(),
      live: n.getAttribute("aria-live"),
      role: n.getAttribute("role"),
      beforePrivacy:
        n.compareDocumentPosition(privacy) & Node.DOCUMENT_POSITION_FOLLOWING,
      visible: n.getClientRects().length > 0,
    };
  });
  check("intro note is the approved sentence, before privacy, not live", note, {
    text: NOTE,
    live: null,
    role: null,
    beforePrivacy: 4,
    visible: true,
  });
  await page.screenshot({
    path: "reports/fui-screenshots/notice-1440.png",
    clip: { x: 0, y: 0, width: 1440, height: 520 },
  });
  report.screenshots.push("reports/fui-screenshots/notice-1440.png");

  await page.locator("#files").setInputFiles([
    {
      name: "試験.txt",
      mimeType: "text/plain",
      buffer: utf8(HAND_SOURCE),
    },
    {
      name: "対照.txt",
      mimeType: "text/plain",
      buffer: utf8(CONTROL_SOURCE),
    },
  ]);
  await button("変換を開始").click();
  await idle();
  await button("選択を解除").click();
  await page.getByLabel("出力を選択: 試験.md", { exact: true }).check();
  await page.locator("#delivery-single").check();
  await button("ダウンロード用ファイルを作成").click();
  await idle();
  const before = await acquire("試験.md before viewing", "試験.md");
  check(
    "download before viewing equals handwritten bytes",
    before.toString(),
    HAND,
  );
  const selectedBefore = await selection();
  const urlsBefore = await page.evaluate(() => window.__fui.urls);

  await button("試験.mdをプレビュー").click();
  await waitStatus(["ready"]);
  const horizontal = await reading();
  report.measurements.horizontal1440 = {
    clientHeight: horizontal.ch,
    previousCapPx: horizontal.oldPx,
    scrollHeight: horizontal.sh,
  };
  check(
    "horizontal surface is taller than the previous 70vh/40rem cap",
    [
      horizontal.writing,
      horizontal.taller,
      horizontal.opsHidden,
      horizontal.face,
    ],
    ["horizontal-tb", true, true, "gothic"],
  );
  check(
    "gothic is pressed and the reading face is the gothic stack",
    [
      horizontal.gothicPressed,
      horizontal.minchoPressed,
      horizontal.bodyFamily.includes("sans-serif"),
      horizontal.bodyFamily.includes("Yu Gothic") ||
        horizontal.bodyFamily.includes("Hiragino"),
      horizontal.headingFamily,
      horizontal.rubyFamily,
      horizontal.codeFamily.includes("monospace"),
      horizontal.fmFamily.includes("sans-serif"),
      !horizontal.fmFamily.includes("Yu Mincho"),
      horizontal.sourceFamily.includes("monospace"),
      !horizontal.uiFamily.includes("Yu Mincho"),
    ],
    [
      "true",
      "false",
      true,
      true,
      horizontal.bodyFamily,
      horizontal.bodyFamily,
      true,
      true,
      true,
      true,
      true,
    ],
  );
  await shot("hand-gothic-horizontal-1440");

  await page.locator("#preview-face-gothic").hover();
  await page.locator("#preview-surface").hover();
  await page.locator("#preview-face-gothic").focus();
  check(
    "hover and focus do not open a guide while horizontal",
    await page.locator("#help-popover").isHidden(),
    true,
  );
  await button("縦書き").click();
  const vertical = await reading();
  report.measurements.vertical1440 = {
    clientHeight: vertical.ch,
    previousCapPx: vertical.oldPx,
    scrollHeight: vertical.sh,
  };
  check(
    "vertical surface is taller than the previous cap and shows the ops button",
    [
      vertical.writing,
      vertical.taller,
      vertical.ch > 640,
      vertical.opsHidden,
      vertical.docW <= vertical.vw,
      vertical.tcy.map((t) => t.text + ":" + t.combine),
    ],
    [
      "vertical-rl",
      true,
      true,
      false,
      true,
      ["A:all", "12:all", "123:all", "1234:all"],
    ],
  );
  const atStart = await page.evaluate(() => {
    const s = document.getElementById("preview-surface");
    const v = s.scrollLeft;
    s.scrollLeft = 1e9;
    const start = s.scrollLeft;
    s.scrollLeft = v;
    return Math.abs(v - start) <= 1;
  });
  check("vertical opens at the reading start", atStart, true);
  await page.locator("#preview-vertical-ops").hover();
  await page.locator("#preview-vertical-ops").focus();
  await page.locator("#preview-surface").hover();
  check(
    "hover and focus on the ops button do not open the guide",
    await page.locator("#help-popover").isHidden(),
    true,
  );
  await shot("hand-gothic-vertical-1440");

  const beforeHelp = await reading();
  const census = () =>
    page.evaluate(() => ({
      preview: window.__fui.workers.filter((w) =>
        w.url.endsWith("/preview.worker.js"),
      ).length,
      urls: window.__fui.urls,
      live: window.__fui.live,
    }));
  const beforeHelpCensus = await census();
  await button("縦書きの操作").click();
  const opened = await page.evaluate(() => {
    const pop = document.getElementById("help-popover");
    const ops = document.getElementById("preview-vertical-ops");
    const s = document.getElementById("preview-surface");
    const pr = pop.getBoundingClientRect();
    const br = ops.getBoundingClientRect();
    const overlap =
      pr.left < br.right &&
      pr.right > br.left &&
      pr.top < br.bottom &&
      pr.bottom > br.top;
    return {
      hidden: pop.hidden,
      expanded: ops.getAttribute("aria-expanded"),
      text: pop.textContent,
      overlap,
      inside:
        pr.top >= -1 &&
        pr.left >= -1 &&
        pr.bottom <= innerHeight + 1 &&
        pr.right <= innerWidth + 1,
      belowOrAbove: pr.top >= br.bottom - 1 || pr.bottom <= br.top + 1,
      ch: s.clientHeight,
      sl: s.scrollLeft,
      st: s.scrollTop,
      preview: window.__fui.workers.filter((w) =>
        w.url.endsWith("/preview.worker.js"),
      ).length,
      urls: window.__fui.urls,
      live: window.__fui.live,
    };
  });
  check(
    "ops button opens the existing guide under or over itself",
    [
      opened.hidden,
      opened.expanded,
      opened.text.includes("右端の行から読み始め"),
      opened.text.includes("右から左"),
      opened.text.includes("ホイールはページのスクロールに戻ります"),
      opened.text.includes("frontmatter"),
      opened.overlap,
      opened.inside,
      opened.belowOrAbove,
      opened.ch,
      opened.sl,
      opened.st,
      opened.preview,
      opened.urls,
      opened.live,
    ],
    [
      false,
      "true",
      true,
      true,
      true,
      true,
      false,
      true,
      true,
      beforeHelp.ch,
      beforeHelp.sl,
      beforeHelp.st,
      beforeHelpCensus.preview,
      beforeHelpCensus.urls,
      beforeHelpCensus.live,
    ],
  );
  await button("縦書きの操作").click();
  check(
    "the same button closes the guide",
    [
      await page.locator("#help-popover").isHidden(),
      await page.locator("#preview-vertical-ops").getAttribute("aria-expanded"),
    ],
    [true, "false"],
  );
  await page.locator("#preview-vertical-ops").focus();
  await page.keyboard.press("Enter");
  check(
    "Enter opens the guide",
    await page.locator("#preview-vertical-ops").getAttribute("aria-expanded"),
    "true",
  );
  await page.keyboard.press("Space");
  check(
    "Space closes the guide",
    await page.locator("#help-popover").isHidden(),
    true,
  );
  await button("縦書きの操作").click();
  await page.locator("h1").click();
  check(
    "an outside click closes the guide",
    await page.locator("#help-popover").isHidden(),
    true,
  );
  await button("縦書きの操作").click();
  await page.keyboard.press("Escape");
  check(
    "Escape closes the guide",
    await page.locator("#help-popover").isHidden(),
    true,
  );
  await button("縦書きの操作").click();
  await button("横書き").click();
  check(
    "switching to horizontal closes the guide and hides the button",
    [
      await page.locator("#help-popover").isHidden(),
      await page.locator("#preview-vertical-ops").isHidden(),
    ],
    [true, true],
  );
  await button("縦書き").click();
  await button("縦書きの操作").click();
  await page.getByRole("tab", { name: "出力テキスト" }).click();
  check(
    "the source tab closes the guide and keeps monospace",
    [
      await page.locator("#help-popover").isHidden(),
      (
        await page
          .locator("#source-text")
          .evaluate((n) => getComputedStyle(n).fontFamily)
      ).includes("monospace"),
    ],
    [true, true],
  );
  const guideState = () =>
    page.evaluate(() => ({
      sourceSelected: document
        .getElementById("preview-tab-source")
        .getAttribute("aria-selected"),
      expanded: document
        .getElementById("preview-vertical-ops")
        .getAttribute("aria-expanded"),
      popHidden: document.getElementById("help-popover").hidden,
    }));
  const openOpsOnPreview = async () => {
    await page.locator("#preview-tab-preview").click();
    if (
      (await page
        .locator("#preview-vertical-ops")
        .getAttribute("aria-expanded")) !== "true"
    )
      await button("縦書きの操作").click();
  };
  for (const key of ["ArrowRight", "ArrowLeft", "End"]) {
    await openOpsOnPreview();
    await page.locator("#preview-tab-preview").focus();
    await page.keyboard.press(key);
    check(
      `keyboard ${key} from the preview tab closes the guide`,
      await guideState(),
      { sourceSelected: "true", expanded: "false", popHidden: true },
    );
  }
  await page.locator("#preview-tab-source").focus();
  await page.keyboard.press("Home");
  check(
    "Home returns to the preview tab with the guide still closed",
    await guideState(),
    { sourceSelected: "false", expanded: "false", popHidden: true },
  );
  await openOpsOnPreview();
  await page.locator("#preview-tab-preview").focus();
  await page.keyboard.press("Home");
  check(
    "Home while already on the preview tab keeps the open guide",
    await guideState(),
    { sourceSelected: "false", expanded: "true", popHidden: false },
  );
  await button("閲覧を閉じる").click();
  check(
    "closing the preview closes the guide",
    await page.locator("#help-popover").isHidden(),
    true,
  );

  await button("試験.mdをプレビュー").click();
  await waitStatus(["ready"]);
  await button("縦書き").click();
  await page.evaluate(() => {
    const s = document.getElementById("preview-surface");
    s.scrollLeft = 1e9;
    s.scrollLeft -= 400;
  });
  const moved = await page.evaluate(
    () => document.getElementById("preview-surface").scrollLeft,
  );
  const workersBeforeFace = (await previewWorkers()).length;
  await button("明朝").click();
  const afterFace = await reading();
  check(
    "mincho changes the reading face and does not jump to the start",
    [
      afterFace.face,
      afterFace.minchoPressed,
      afterFace.gothicPressed,
      afterFace.bodyFamily.includes("serif"),
      afterFace.bodyFamily.includes("Mincho") ||
        afterFace.bodyFamily.includes("serif"),
      afterFace.headingFamily,
      afterFace.rubyFamily,
      afterFace.codeFamily.includes("monospace"),
      afterFace.fmFamily.includes("Mincho"),
      afterFace.sourceFamily.includes("monospace"),
      afterFace.uiFamily.includes("Mincho"),
      Math.abs(afterFace.sl - moved) < 80,
      (await previewWorkers()).length,
    ],
    [
      "mincho",
      "true",
      "false",
      true,
      true,
      afterFace.bodyFamily,
      afterFace.bodyFamily,
      true,
      false,
      true,
      false,
      true,
      workersBeforeFace,
    ],
  );
  await shot("hand-mincho-vertical-1440");
  await button("横書き").click();
  const minchoH = await reading();
  check(
    "mincho applies in horizontal mode",
    [minchoH.writing, minchoH.bodyFamily.includes("serif"), minchoH.tcy.length],
    ["horizontal-tb", true, 4],
  );
  await shot("hand-mincho-horizontal-1440");
  await button("対照.mdをプレビュー").click();
  await waitStatus(["ready"]);
  check(
    "face is kept for another file",
    await page.locator("#preview").getAttribute("data-face"),
    "mincho",
  );
  await button("試験.mdをプレビュー").click();
  await waitStatus(["ready"]);
  check(
    "face is kept when returning, and mode stays horizontal from the last switch",
    [
      await page.locator("#preview").getAttribute("data-face"),
      await page.locator("#preview").getAttribute("data-mode"),
    ],
    ["mincho", "horizontal"],
  );

  const selectedAfter = await selection();
  check(
    "selection unchanged by viewing and face",
    selectedAfter,
    selectedBefore,
  );
  check(
    "issued URL count unchanged by face and help",
    await page.evaluate(() => window.__fui.urls),
    urlsBefore,
  );
  const again = await acquire("試験.md after viewing", "試験.md");
  check("download bytes unchanged", again.toString(), before.toString());
  check(
    "no font or CDN request",
    network.some((u) => /font|cdn|googleapis/i.test(u)),
    false,
  );
  check(
    "localStorage stays empty",
    await page.evaluate(() => localStorage.length),
    0,
  );

  const named = await page.evaluate(async () => {
    const faces = [
      "Yu Mincho",
      "YuMincho",
      "Hiragino Mincho ProN",
      "Hiragino Mincho Pro",
      "Noto Serif CJK JP",
      "Source Han Serif JP",
      "Hiragino Kaku Gothic ProN",
      "Yu Gothic",
    ];
    await document.fonts.ready;
    return Object.fromEntries(
      faces.map((name) => [name, document.fonts.check(`16px "${name}"`)]),
    );
  });
  report.measurements.fontAvailability = named;
  check(
    "mincho and gothic stacks name a generic fallback",
    await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.className = "preview-surface preview-mincho";
      probe.textContent = "あ";
      document.body.append(probe);
      const mincho = getComputedStyle(probe).fontFamily;
      probe.className = "preview-surface";
      const gothic = getComputedStyle(probe).fontFamily;
      probe.remove();
      return [mincho.endsWith("serif"), gothic.endsWith("sans-serif")];
    }),
    [true, true],
  );

  await page.setViewportSize({ width: 768, height: 900 });
  await button("縦書き").click();
  await button("明朝").click();
  const at768 = await reading();
  report.measurements.vertical768 = {
    clientHeight: at768.ch,
    previousCapPx: at768.oldPx,
  };
  check(
    "768px vertical surface is taller and does not widen the page",
    [at768.taller, at768.docW <= at768.vw, at768.writing],
    [true, true, "vertical-rl"],
  );
  await shot("hand-mincho-vertical-768");

  await page.setViewportSize({ width: 390, height: 844 });
  const narrow = await page.evaluate(() => {
    const buttons = [
      ...document.querySelectorAll(".preview-tools button"),
    ].filter((b) => !b.hidden);
    const boxes = buttons.map((b) => {
      const r = b.getBoundingClientRect();
      return {
        text: b.textContent.trim(),
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
      };
    });
    const overlaps = [];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i],
          b = boxes[j];
        if (
          a.left < b.right - 1 &&
          a.right > b.left + 1 &&
          a.top < b.bottom - 1 &&
          a.bottom > b.top + 1
        )
          overlaps.push([a.text, b.text]);
      }
    const note = document
      .getElementById("conversion-limits")
      .getBoundingClientRect();
    return {
      boxes,
      overlaps,
      clipped: boxes.some((b) => b.left < -1 || b.right > innerWidth + 1),
      noteRight: note.right <= innerWidth + 1,
      noteWidth: note.width,
    };
  });
  report.measurements.tools390 = narrow;
  check(
    "390px tools do not overlap or clip, and the note fits",
    [narrow.overlaps, narrow.clipped, narrow.noteRight, narrow.noteWidth > 200],
    [[], false, true, true],
  );
  const at390 = await reading();
  report.measurements.vertical390 = {
    clientHeight: at390.ch,
    previousCapPx: at390.oldPx,
  };
  check(
    "390px vertical surface is taller than the previous cap",
    [at390.taller, at390.docW <= at390.vw],
    [true, true],
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "reports/fui-screenshots/notice-390.png",
    clip: { x: 0, y: 0, width: 390, height: 700 },
  });
  report.screenshots.push("reports/fui-screenshots/notice-390.png");
  await shot("hand-mincho-vertical-390");

  await page.setViewportSize({ width: 390, height: 320 });
  await page.evaluate(() => {
    const b = document.getElementById("preview-vertical-ops");
    const r = b.getBoundingClientRect();
    window.scrollBy(0, r.top - (innerHeight - r.height) / 2);
  });
  await button("縦書きの操作").click();
  const cramped = await page.evaluate(() => {
    const pop = document.getElementById("help-popover");
    const ops = document.getElementById("preview-vertical-ops");
    const pr = pop.getBoundingClientRect();
    const br = ops.getBoundingClientRect();
    const overlap =
      pr.left < br.right &&
      pr.right > br.left &&
      pr.top < br.bottom &&
      pr.bottom > br.top;
    return {
      hidden: pop.hidden,
      overlap,
      inside: pr.top >= -1 && pr.bottom <= innerHeight + 1,
      scrolls: pop.scrollHeight > pop.clientHeight + 1,
      ch: document.getElementById("preview-surface").clientHeight,
    };
  });
  report.measurements.crampedPopover = cramped;
  check(
    "a short viewport keeps the popover on screen, off the button, and scrollable",
    [cramped.hidden, cramped.overlap, cramped.inside, cramped.scrolls],
    [false, false, true, true],
  );
  const heightWhileOpen = cramped.ch;
  await button("縦書きの操作").click();
  check(
    "closing the popover does not change the surface height",
    (await reading()).ch,
    heightWhileOpen,
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/preview.worker.js", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await button("閲覧を閉じる").click();
  await button("試験.mdをプレビュー").click();
  await waitStatus(["failed"]);
  await page.unroute("**/preview.worker.js");
  await button("もう一度表示する").click();
  await waitStatus(["ready"]);
  await button("明朝").click();
  check(
    "face still switches after a preview failure",
    await page.locator("#preview").getAttribute("data-face"),
    "mincho",
  );
  await button("縦書き").click();
  await button("縦書きの操作").click();
  check(
    "the guide still opens after recovery",
    await page.locator("#help-popover").isHidden(),
    false,
  );
  await button("縦書きの操作").click();

  await button("縦書きの操作").click();
  await page.locator("#option-addFrontmatter").focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(() => document.querySelector("#preview").hidden);
  check(
    "invalidating the result closes the guide",
    await page.locator("#help-popover").isHidden(),
    true,
  );
  await button("変換を開始").click();
  await idle();
  await button("試験.mdをプレビュー").click();
  await waitStatus(["ready"]);
  await button("縦書き").click();
  await button("縦書きの操作").click();
  await button("全クリア").click();
  check(
    "clear closes the guide",
    await page.locator("#help-popover").isHidden(),
    true,
  );
  check(
    "the intro note remains with no file selected",
    (await page.locator("#conversion-limits").textContent()).trim(),
    NOTE,
  );
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector("#boot-error").hidden,
  );
  check(
    "reload returns the face to gothic",
    await page.evaluate(() => ({
      gothic: document
        .getElementById("preview-face-gothic")
        .getAttribute("aria-pressed"),
      mincho: document
        .getElementById("preview-face-mincho")
        .getAttribute("aria-pressed"),
      face: document.getElementById("preview").dataset.face,
    })),
    { gothic: "true", mincho: "false", face: "gothic" },
  );

  const clockPage = await context.newPage();
  await clockPage.goto(web.url);
  await clockPage.waitForFunction(
    () => document.querySelector("#boot-error").hidden,
  );
  await clockPage.locator("#files").setInputFiles({
    name: "試験.txt",
    mimeType: "text/plain",
    buffer: utf8(HAND_SOURCE),
  });
  await clockPage
    .getByRole("button", { name: "変換を開始", exact: true })
    .click();
  await clockPage.waitForFunction(
    () => document.querySelector("#cancel").disabled,
  );
  await clockPage
    .getByRole("button", { name: "試験.mdをプレビュー", exact: true })
    .click();
  await clockPage.waitForFunction(
    () => document.querySelector("#preview").dataset.status === "ready",
  );
  await clockPage.getByRole("button", { name: "縦書き", exact: true }).click();
  await clockPage.clock.install();
  await clockPage
    .getByRole("button", { name: "縦書きの操作", exact: true })
    .click();
  await clockPage.clock.fastForward(10_000);
  await clockPage.getByRole("button", { name: "使い方", exact: true }).click();
  await clockPage.clock.fastForward(6_000);
  check(
    "an older 15s timer does not close the newer explanation",
    await clockPage.evaluate(() => ({
      hidden: document.getElementById("help-popover").hidden,
      usage: document
        .querySelector('[data-help-for="usage"]')
        .getAttribute("aria-expanded"),
      ops: document
        .getElementById("preview-vertical-ops")
        .getAttribute("aria-expanded"),
    })),
    { hidden: false, usage: "true", ops: "false" },
  );
  await clockPage.clock.fastForward(10_000);
  check(
    "the newer explanation closes after its own 15 seconds",
    await clockPage.locator("#help-popover").isHidden(),
    true,
  );
  check(
    "pagehide closes a guide that was open",
    await clockPage.evaluate(() => {
      document.getElementById("preview-vertical-ops").click();
      const open = !document.getElementById("help-popover").hidden;
      window.dispatchEvent(new Event("pagehide"));
      return {
        opened: open,
        hidden: document.getElementById("help-popover").hidden,
      };
    }),
    { opened: true, hidden: true },
  );
  await clockPage.close();

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
      name: "試験.txt",
      mimeType: "text/plain",
      buffer: utf8(HAND_SOURCE),
    });
    await zp.getByRole("button", { name: "変換を開始", exact: true }).click();
    await zp.waitForFunction(() => document.querySelector("#cancel").disabled);
    await zp
      .getByRole("button", { name: "試験.mdをプレビュー", exact: true })
      .click();
    await zp.waitForFunction(
      () => document.querySelector("#preview").dataset.status === "ready",
    );
    await zp.getByRole("button", { name: "縦書き", exact: true }).click();
    await zp.getByRole("button", { name: "明朝", exact: true }).click();
    const z = await zp.evaluate(() => {
      const s = document.getElementById("preview-surface");
      const root = parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );
      const oldPx = Math.min(innerHeight * 0.7, 40 * root);
      return {
        inner: innerWidth,
        dpr: devicePixelRatio,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        writing: getComputedStyle(s).writingMode,
        taller: s.clientHeight > oldPx + 8,
        ch: s.clientHeight,
        oldPx,
        family: getComputedStyle(s.querySelector(".preview-body p")).fontFamily,
      };
    });
    report.measurements.zoom200 = z;
    check(
      "200% zoom vertical geometry",
      {
        inner: z.inner,
        dpr: z.dpr,
        overflow: z.overflow,
        writing: z.writing,
        taller: z.taller,
        serif: z.family.includes("serif"),
      },
      {
        inner: 720,
        dpr: 2,
        overflow: false,
        writing: "vertical-rl",
        taller: true,
        serif: true,
      },
    );
    const cdp = await zoom.newCDPSession(zp);
    const clip = await zp.evaluate(() => {
      const r = document.querySelector("#preview").getBoundingClientRect();
      const k = devicePixelRatio;
      return {
        x: r.left * k,
        y: (r.top + scrollY) * k,
        width: r.width * k,
        height: Math.min(r.height, innerHeight) * k,
        scale: 1,
      };
    });
    const capture = await cdp.send("Page.captureScreenshot", {
      captureBeyondViewport: true,
      clip,
    });
    const path = "reports/fui-screenshots/zoom-200-mincho-vertical.png";
    await writeFile(path, Buffer.from(capture.data, "base64"));
    report.screenshots.push(path);
    await zp.locator("#preview-surface").scrollIntoViewIfNeeded();
    const surfaceClip = await zp.evaluate(() => {
      const r = document
        .getElementById("preview-surface")
        .getBoundingClientRect();
      const k = devicePixelRatio;
      return {
        x: (r.left + scrollX) * k,
        y: (r.top + scrollY) * k,
        width: r.width * k,
        height: r.height * k,
        scale: 1,
      };
    });
    const surfaceShot = await cdp.send("Page.captureScreenshot", {
      captureBeyondViewport: true,
      clip: surfaceClip,
    });
    const surfacePath = "reports/fui-screenshots/zoom-200-surface.png";
    await writeFile(surfacePath, Buffer.from(surfaceShot.data, "base64"));
    report.screenshots.push(surfacePath);
    await zp.evaluate(() => window.scrollTo(0, 0));
    const top = await cdp.send("Page.captureScreenshot", {
      clip: { x: 0, y: 0, width: 1440, height: 700, scale: 1 },
    });
    const topPath = "reports/fui-screenshots/zoom-200-notice.png";
    await writeFile(topPath, Buffer.from(top.data, "base64"));
    report.screenshots.push(topPath);
  } finally {
    await zoom.close();
  }

  report.completed = true;
} finally {
  await browser?.close();
  await web?.close();
  report.finishedAt = new Date().toISOString();
  await writeFile(
    "reports/fui-browser-smoke.json",
    JSON.stringify(report, null, 2) + "\n",
  );
}
console.log(
  JSON.stringify({
    checks: report.checks.length,
    downloads: report.downloads.length,
    measurements: report.measurements,
    completed: report.completed,
  }),
);
