import { chromium } from "playwright";
import assert from "node:assert/strict";
import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  rm,
  readdir,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { createWebServer } from "./serve-web.mjs";

const generated = spawnSync("python3", ["scripts/web-fixtures.py"], {
  encoding: "utf8",
  maxBuffer: 8 * 1048576,
});
assert.equal(generated.status, 0, generated.stderr);
const fixtures = JSON.parse(generated.stdout),
  temp = await mkdtemp(join(tmpdir(), "aozora-web-"));
await mkdir("reports/web-screenshots", { recursive: true });
const report = {
  contract: "aozora-web-v6",
  startedAt: new Date().toISOString(),
  node: process.version,
  checks: [],
  downloads: [],
  screenshots: [],
  completed: false,
};
const check = (label, actual, expected) => {
  assert.deepEqual(actual, expected, label);
  report.checks.push(label);
};
async function advancedHelpStaysByButton() {
  const frame = () =>
    new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  const buttons = [...document.querySelectorAll("#advanced-settings .help")];
  const failures = [];
  const measure = (button, edge) => {
    const popEl = document.querySelector("#help-popover");
    const pop = popEl.getBoundingClientRect();
    const btn = button.getBoundingClientRect();
    const dx = Math.max(0, pop.left - btn.right, btn.left - pop.right);
    const dy = Math.max(0, pop.top - btn.bottom, btn.top - pop.bottom);
    const hit = document.elementFromPoint(
      Math.min(Math.max(1, btn.left + btn.width / 2), innerWidth - 2),
      Math.min(Math.max(1, btn.top + btn.height / 2), innerHeight - 2),
    );
    return {
      id: button.getAttribute("data-help-for") + ":" + edge,
      open: popEl.hidden === false && popEl.textContent.length > 0,
      near:
        dx < 1 &&
        dy <= 16 &&
        pop.left < btn.right - 1 &&
        pop.right > btn.left + 1,
      inside:
        pop.left >= -1 &&
        pop.top >= -1 &&
        pop.right <= innerWidth + 1 &&
        pop.bottom <= innerHeight + 1 &&
        pop.width > 40 &&
        pop.height > 16,
      reachable: !!hit && button.contains(hit),
    };
  };
  const park = (button, edge) => {
    const box = button.getBoundingClientRect();
    const top = box.top + window.scrollY;
    const target =
      edge === "bottom"
        ? top - (window.innerHeight - box.height - 20)
        : top - 20;
    window.scrollTo(0, Math.max(0, target));
  };
  for (let index = 0; index < buttons.length; index++) {
    const button = buttons[index];
    button.scrollIntoView({ block: "center", inline: "nearest" });
    await frame();
    button.click();
    for (const edge of ["bottom", "top"]) {
      park(button, edge);
      await frame();
      const result = measure(button, edge);
      if (!result.open || !result.near || !result.inside || !result.reachable)
        failures.push(result.id);
    }
    if (index % 3 === 1) {
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    } else if (index % 3 === 2) document.querySelector("h1").click();
    else button.click();
    if (!document.querySelector("#help-popover").hidden)
      failures.push(button.getAttribute("data-help-for") + ":still-open");
  }
  return { count: buttons.length, failures };
}
const payload = (name, body) => ({
  name,
  mimeType: "application/octet-stream",
  buffer: Buffer.isBuffer(body) ? body : Buffer.from(body),
});
const fixture = (name) => payload(name, Buffer.from(fixtures[name], "base64"));
let browser, server;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  report.chrome = browser.version();
  const outputs = await readdir("web-dist", { recursive: true });
  check(
    "no private/source-map assets",
    outputs.filter((p) =>
      /\.map$|\.py$|fixtures|reports|design|package|README/.test(p),
    ),
    [],
  );
  for (const name of ["import", "export"])
    check(
      "fresh " + name + " Worker",
      await readFile(`web-dist/${name}.worker.js`),
      await readFile(`dist/adapters/browser/${name}.worker.min.js`),
    );
  const noticeFiles = (await readdir("notices")).filter((n) =>
    n.endsWith(".txt"),
  );
  check(
    "published asset allowlist",
    [...outputs].sort(),
    [
      "LICENSE.txt",
      "index.html",
      "styles.css",
      "main.js",
      "import.worker.js",
      "export.worker.js",
      "preview.worker.js",
      "preview.worker.js.LEGAL.txt",
      "notices",
      "notices/index.html",
      ...noticeFiles.map((n) => "notices/" + n),
    ].sort(),
  );
  for (const name of noticeFiles)
    check(
      "notice original bytes " + name,
      await readFile("web-dist/notices/" + name),
      await readFile("notices/" + name),
    );
  const bundles = JSON.parse(
    await readFile("reports/bundle-sizes.json", "utf8"),
  );
  check(
    "no Web in existing bundle graph",
    Object.values(bundles.entries)
      .flatMap((e) => e.inputs)
      .filter((p) => p.startsWith("web/")),
    [],
  );
  server = await createWebServer();
  const context = await browser.newContext({
    acceptDownloads: true,
    hasTouch: true,
    viewport: { width: 1440, height: 1100 },
  });
  await context.addInitScript(() => {
    const obs = (window.__webObservation = {
      started: [],
      terminated: [],
      urls: 0,
      revokes: 0,
      liveUrls: 0,
      downloads: 0,
      timers: new Set(),
      errors: [],
    });
    const Native = Worker;
    window.Worker = class extends Native {
      constructor(url, options) {
        super(url, options);
        this.observationId = obs.started.length;
        obs.started.push(String(url));
      }
      terminate() {
        obs.terminated.push(this.observationId);
        return super.terminate();
      }
    };
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (b) => {
      obs.urls++;
      obs.liveUrls++;
      return create(b);
    };
    URL.revokeObjectURL = (u) => {
      obs.revokes++;
      obs.liveUrls--;
      return revoke(u);
    };
    const set = window.setTimeout.bind(window),
      clear = window.clearTimeout.bind(window);
    window.setTimeout = (cb, ms, ...args) => {
      const owned = new Error().stack.includes("main.js");
      let id;
      id = set(() => {
        obs.timers.delete(id);
        cb(...args);
      }, ms);
      if (owned) obs.timers.add(id);
      return id;
    };
    window.clearTimeout = (id) => {
      obs.timers.delete(id);
      return clear(id);
    };
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const network = [],
    errors = [],
    downloads = [];
  page.on("request", (r) => network.push(r.url()));
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("download", (d) => downloads.push(d));
  const button = (name) => page.getByRole("button", { name, exact: true });
  const setFiles = (files) => page.locator("#files").setInputFiles(files);
  const chooseZip = () =>
    page.getByRole("radio", { name: "ZIPにまとめる", exact: true }).check();
  const idle = () =>
    page.waitForFunction(() => document.querySelector("#cancel").disabled);
  const start = async () => {
    await button("変換を開始").click();
    await idle();
  };
  const plain = async () => {
    await page
      .getByLabel("タイトル・著者などを文書先頭の情報欄に記録", { exact: true })
      .uncheck();
  };
  const dragOff = async (locator) => {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    const before = await locator.isChecked();
    await page.mouse.down();
    const onDown = await locator.isChecked();
    await page.mouse.move(x + 180, y + 75, { steps: 5 });
    await page.mouse.up();
    return { before, onDown, after: await locator.isChecked() };
  };
  const snapshot = async (name) => {
    const path = `reports/web-screenshots/${name}.png`;
    await page.screenshot({ path, fullPage: true });
    report.screenshots.push(path);
  };
  const acquire = async (label, expectedName, expectedBytes, entries) => {
    const [d] = await Promise.all([
      page.waitForEvent("download"),
      button("ダウンロード").click(),
    ]);
    check(label + " filename", d.suggestedFilename(), expectedName);
    const path = join(temp, String(report.downloads.length));
    await d.saveAs(path);
    check(label + " acquisition", await d.failure(), null);
    const bytes = await readFile(path);
    if (expectedBytes !== undefined)
      check(label + " bytes", bytes, Buffer.from(expectedBytes));
    if (entries) {
      const independent = spawnSync(
        "python3",
        ["scripts/check_export_zip.py"],
        {
          input: JSON.stringify({
            zip: bytes.toString("base64"),
            entries: entries.map(([relativePath, text]) => ({
              relativePath,
              base64: Buffer.from(text).toString("base64"),
            })),
          }),
          encoding: "utf8",
        },
      );
      check(label + " independent ZIP", independent.status, 0);
      if (independent.status) throw Error(independent.stderr);
    }
    report.downloads.push({
      label,
      filename: d.suggestedFilename(),
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    return bytes;
  };
  await page.goto(server.url);
  await page.waitForFunction(
    () => document.querySelector("#boot-error").hidden,
  );
  check(
    "Japanese document",
    await page.locator("html").getAttribute("lang"),
    "ja",
  );
  check("empty cannot start", await button("変換を開始").isDisabled(), true);
  const usage = button("使い方");
  check("usage button in the header", await usage.isVisible(), true);
  await usage.click();
  check(
    "usage explains the short workflow",
    (await page.locator("#help-popover").textContent()).includes(
      "変換を開始",
    ) &&
      (await page.locator("#help-popover").textContent()).includes(
        "ダウンロード",
      ),
    true,
  );
  check("usage expanded", await usage.getAttribute("aria-expanded"), "true");
  await snapshot("00-usage-1440");
  await usage.click();
  check(
    "usage closes on second click",
    await page.locator("#help-popover").isHidden(),
    true,
  );
  await usage.press("Enter");
  await page.locator("h1").click();
  check(
    "usage closes on outside click",
    await page.locator("#help-popover").isHidden(),
    true,
  );
  await usage.click();
  await usage.press("Escape");
  check(
    "usage closes on Escape",
    await page.locator("#help-popover").isHidden(),
    true,
  );
  await snapshot("01-empty-1440");
  for (const [width, height] of [
    [390, 844],
    [720, 550],
  ]) {
    await page.setViewportSize({ width, height });
    check(`usage remains visible at ${width}px`, await usage.isVisible(), true);
    await button("設定を初期値に戻す").click();
    check(
      "reset does not open help " + width,
      await page.locator("#help-popover").isHidden(),
      true,
    );
    await page
      .getByRole("button", { name: "出力拡張子の説明", exact: true })
      .click();
    check(
      "explanation button still opens " + width,
      await page.locator("#help-popover").isVisible(),
      true,
    );
    await page.evaluate(() => {
      const box = document.querySelector("#option-addFrontmatter");
      const top = box.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(
        0,
        Math.max(
          0,
          top - window.innerHeight + box.getBoundingClientRect().height + 12,
        ),
      );
    });
    check(
      "help leaves a bottom checkbox hittable " + width,
      await page.evaluate(() => {
        const box = document
          .querySelector("#option-addFrontmatter")
          .getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.left + box.width / 2,
          Math.min(box.top + box.height / 2, window.innerHeight - 2),
        );
        return document.querySelector("#help-popover").contains(hit);
      }),
      false,
    );
    await page.evaluate(() => {
      document.querySelector("#option-addFrontmatter").scrollIntoView({
        block: "center",
        inline: "nearest",
      });
    });
    const covered = await page.evaluate(() => {
      const box = document
        .querySelector("#option-addFrontmatter")
        .getBoundingClientRect();
      const hit = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      );
      return document.querySelector("#help-popover").contains(hit);
    });
    check("help leaves next checkbox hittable " + width, covered, false);
    const checked = await page.locator("#option-addFrontmatter").isChecked();
    const point = await page.locator("#option-addFrontmatter").boundingBox();
    const x = point.x + point.width / 2,
      y = point.y + point.height / 2;
    if (width === 390) await page.touchscreen.tap(x, y);
    else await page.mouse.click(x, y);
    check(
      "pointer changes visible checkbox " + width,
      await page.locator("#option-addFrontmatter").isChecked(),
      !checked,
    );
    check(
      "outside click closes help " + width,
      await page.locator("#help-popover").isHidden(),
      true,
    );
    await page
      .getByRole("button", { name: "出力拡張子の説明", exact: true })
      .click();
    await page.keyboard.press("Escape");
    check(
      "escape still closes " + width,
      await page.locator("#help-popover").isHidden(),
      true,
    );
    await page.locator("#option-addFrontmatter").setChecked(checked);
    const stayed = await dragOff(page.locator("#option-addFrontmatter"));
    check("drag away keeps checkbox " + width, stayed, {
      before: checked,
      onDown: checked,
      after: checked,
    });
    if (width === 720) {
      await page
        .locator("label.check:has(#option-addFrontmatter) > span")
        .click();
      check(
        "label click changes checkbox",
        await page.locator("#option-addFrontmatter").isChecked(),
        !checked,
      );
      await page.locator("#option-addFrontmatter").focus();
      await page.keyboard.press("Space");
      check(
        "keyboard space changes checkbox",
        await page.locator("#option-addFrontmatter").isChecked(),
        checked,
      );
    }
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.evaluate(() => window.scrollTo(0, 0));
  check(
    "empty selection status",
    await page.locator("#file-selection-status").textContent(),
    "未選択",
  );
  check(
    "empty picker label",
    await page.locator("#pick-files").textContent(),
    "ファイルを選ぶ",
  );
  check(
    "picker explains formats and replacement",
    [
      await page.locator("#picker-formats").textContent(),
      await page.locator("#picker-replace").textContent(),
    ],
    [
      "TXT・MD・ZIP／複数選択可",
      "選び直すと一覧を置換。取消は現在の選択を保持。",
    ],
  );
  check(
    "hidden file input is not a tab stop",
    await page.evaluate(() => ({
      tab: document.querySelector("#files").tabIndex,
      hidden: document.querySelector("#files").getAttribute("aria-hidden"),
    })),
    { tab: -1, hidden: "true" },
  );
  await page.locator("#pick-files").focus();
  await page.keyboard.press("Tab");
  check(
    "keyboard skips hidden file input",
    await page.evaluate(() => ({
      tag: document.activeElement.tagName,
      id: document.activeElement.id,
      help: document.activeElement.getAttribute("data-help-for"),
    })),
    { tag: "BUTTON", id: "", help: "pick-files" },
  );
  await page.locator("#pick-files").focus();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator("#pick-files").press("Enter"),
  ]);
  await chooser.setFiles([payload("keyboard.txt", "K")]);
  check(
    "keyboard Enter opens native picker",
    await page.locator("#inputs > li").count(),
    1,
  );
  check(
    "status follows controller count",
    await page.locator("#file-selection-status").textContent(),
    "1ファイル選択済み",
  );
  check(
    "picker relabels after selection",
    await page.locator("#pick-files").textContent(),
    "ファイルを選び直す",
  );
  const [clicked] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator("#pick-files").click(),
  ]);
  await clicked.setFiles([payload("same.txt", "A"), payload("same.txt", "B")]);
  check(
    "click opens picker and replaces list",
    await page.locator("#inputs > li").count(),
    2,
  );
  check(
    "same-name files stay distinct",
    await page.locator("#file-selection-status").textContent(),
    "2ファイル選択済み",
  );
  await page.locator("#pick-files").focus();
  const [spaced] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator("#pick-files").press("Space"),
  ]);
  await spaced.setFiles([]);
  check(
    "space opens picker and empty choice keeps files",
    await page.locator("#inputs > li").count(),
    2,
  );
  await page.locator("#files").dispatchEvent("cancel");
  check(
    "cancel event keeps selection",
    await page.locator("#file-selection-status").textContent(),
    "2ファイル選択済み",
  );
  await page
    .getByRole("button", { name: "same.txt（入力1）を削除", exact: true })
    .click();
  check(
    "delete one keeps the other",
    await page.locator("#file-selection-status").textContent(),
    "1ファイル選択済み",
  );
  await page
    .getByRole("button", { name: "same.txt（入力1）を削除", exact: true })
    .click();
  check(
    "deleting the last file shows unselected",
    await page.locator("#file-selection-status").textContent(),
    "未選択",
  );
  check(
    "delete focuses the visible picker",
    await page.evaluate(() => document.activeElement.id),
    "pick-files",
  );
  await setFiles([
    payload("bad.png", "x"),
    payload("same.txt", "A"),
    payload("same.txt", "B"),
  ]);
  check("unsupported retained", await page.locator("#inputs > li").count(), 3);
  check(
    "unsupported blocks start",
    await button("変換を開始").isDisabled(),
    true,
  );
  await page
    .getByRole("button", { name: "bad.png（入力1）を削除", exact: true })
    .click();
  check("same name preserved", await page.locator("#inputs > li").count(), 2);
  await setFiles([]);
  check(
    "picker cancellation preserves files",
    await page.locator("#inputs > li").count(),
    2,
  );
  await setFiles([payload("same.txt", "A")]);
  await setFiles([payload("same.txt", "A")]);
  check("same file reselection", await page.locator("#inputs > li").count(), 1);
  check(
    "details entry closed label",
    await page.locator("#details-title").textContent(),
    "詳細設定を開く",
  );
  check(
    "details stays closed before the summary click",
    await page.locator("#advanced").evaluate((node) => node.open),
    false,
  );
  await page.locator("#advanced > summary").click();
  await page.getByLabel("Nyozeの字下げ記法に変換", { exact: true }).check();
  await page.getByLabel("字下げの元注記を保持", { exact: true }).check();
  await page.getByLabel("Nyozeの字下げ記法に変換", { exact: true }).uncheck();
  check(
    "disabled child keeps value",
    await page.getByLabel("字下げの元注記を保持", { exact: true }).isChecked(),
    true,
  );
  check(
    "child disabled",
    await page.getByLabel("字下げの元注記を保持", { exact: true }).isDisabled(),
    true,
  );
  check(
    "details brief",
    await page.locator("#details-brief").textContent(),
    "外字・末尾情報・注記説明の整理、装飾と見出し、Nyoze向けの配置を調整します。",
  );
  check(
    "body group",
    await page.locator("#group-body-title").isVisible(),
    true,
  );
  check(
    "decoration group",
    await page.locator("#group-decoration-title").isVisible(),
    true,
  );
  check(
    "nyoze group",
    await page.locator("#group-nyoze-title").isVisible(),
    true,
  );
  check(
    "details entry open label",
    await page.locator("#details-title").textContent(),
    "詳細設定を閉じる",
  );
  const beforeDetailsValue = await page
    .getByLabel("字下げの元注記を保持", { exact: true })
    .isChecked();
  await page.locator("#advanced > summary").click();
  await page.locator("#advanced > summary").click();
  check(
    "details toggle keeps the child value",
    await page.getByLabel("字下げの元注記を保持", { exact: true }).isChecked(),
    beforeDetailsValue,
  );
  check(
    "details entry open again",
    await page.locator("#advanced").evaluate((node) => node.open),
    true,
  );
  check(
    "disabled child help remains enabled",
    await page
      .getByRole("button", { name: "字下げの元注記を保持の説明", exact: true })
      .isEnabled(),
    true,
  );
  await page
    .getByRole("button", { name: "字下げの元注記を保持の説明", exact: true })
    .click();
  check(
    "help click keeps disabled child checked",
    await page.getByLabel("字下げの元注記を保持", { exact: true }).isChecked(),
    true,
  );
  check(
    "help click opens supplemental text",
    await page.locator("#help-popover").isVisible(),
    true,
  );
  await page.keyboard.press("Escape");
  check(
    "escape closes help without moving focus off the button",
    await page.locator("#help-popover").isHidden(),
    true,
  );
  await page.getByRole("radio", { name: ".md", exact: true }).hover();
  check(
    "hover does not open help",
    await page.locator("#help-popover").isHidden(),
    true,
  );
  await page.getByRole("radio", { name: ".md", exact: true }).focus();
  check(
    "focus does not open help",
    await page.locator("#help-popover").isHidden(),
    true,
  );
  const emphasisHelp = page.getByRole("button", {
    name: "太字・斜体を変換の説明",
    exact: true,
  });
  await emphasisHelp.focus();
  check(
    "focus on the explanation button does not open help",
    await page.locator("#help-popover").isHidden(),
    true,
  );
  await page.keyboard.press("Enter");
  check(
    "enter on the explanation button opens help",
    await page.locator("#help-popover").isVisible(),
    true,
  );
  await page.keyboard.press(" ");
  check(
    "space on the same explanation button closes help",
    await page.locator("#help-popover").isHidden(),
    true,
  );
  await emphasisHelp.click();
  await emphasisHelp.click();
  check(
    "the same explanation button closes help immediately",
    await page.locator("#help-popover").isHidden(),
    true,
  );
  await emphasisHelp.click();
  await page
    .getByRole("button", { name: "傍点に使う文字の説明", exact: true })
    .click();
  check(
    "another explanation button switches the text",
    (await page.locator("#help-popover").textContent()).includes("傍点"),
    true,
  );
  check(
    "switched explanation expands only the new button",
    [
      await emphasisHelp.getAttribute("aria-expanded"),
      await page
        .locator('[data-help-for="boutenChar"]')
        .getAttribute("aria-expanded"),
    ],
    ["false", "true"],
  );
  await page.locator("#help-popover").click();
  check(
    "click inside the explanation keeps it open",
    await page.locator("#help-popover").isVisible(),
    true,
  );
  await page.locator("#help-popover").hover();
  await page.waitForTimeout(400);
  check(
    "pointer on the explanation does not extend or dismiss it early",
    await page.locator("#help-popover").isVisible(),
    true,
  );
  const boutenBefore = await page.locator("#bouten").inputValue();
  await page.locator("#bouten").click();
  check(
    "same-host field click keeps its value",
    await page.locator("#bouten").inputValue(),
    boutenBefore,
  );
  check(
    "same-host field click closes help",
    await page.locator("#help-popover").isHidden(),
    true,
  );
  await emphasisHelp.click();
  await page.locator("h1").click();
  check(
    "click on empty page content closes help",
    await page.locator("#help-popover").isHidden(),
    true,
  );
  await emphasisHelp.click();
  const frontmatterBefore = await page
    .locator("#option-addFrontmatter")
    .isChecked();
  await page.locator("label.check:has(#option-addFrontmatter) > span").click();
  check(
    "same-host label click changes the checkbox once",
    await page.locator("#option-addFrontmatter").isChecked(),
    !frontmatterBefore,
  );
  check(
    "same-host label click closes help",
    await page.locator("#help-popover").isHidden(),
    true,
  );
  await page.locator("#option-addFrontmatter").setChecked(frontmatterBefore);
  await emphasisHelp.click();
  const gesture = await page.evaluate(() => {
    const box = document.querySelector("#option-addFrontmatter");
    const rect = box.getBoundingClientRect();
    const before = box.checked;
    const helpBefore = document.querySelector("#help-popover").hidden;
    box.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 7,
        pointerType: "mouse",
        button: 0,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }),
    );
    const onDown = box.checked;
    box.dispatchEvent(
      new PointerEvent("pointercancel", {
        bubbles: true,
        cancelable: true,
        pointerId: 7,
        pointerType: "mouse",
        button: 0,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }),
    );
    return {
      before,
      onDown,
      after: box.checked,
      helpHidden: document.querySelector("#help-popover").hidden,
      helpBefore,
    };
  });
  check("pointer cancel does not change the checkbox", gesture.before, true);
  check(
    "pointer cancel does not change on press",
    gesture.onDown,
    gesture.before,
  );
  check("pointer cancel leaves the checkbox", gesture.after, gesture.before);
  check("pointer cancel is not an outside click", gesture.helpHidden, false);
  const touchScroll = await page.evaluate(() => {
    window.scrollTo(0, 240);
    const box = document.querySelector("#option-addFrontmatter");
    const rect = box.getBoundingClientRect();
    const before = box.checked;
    const start = window.scrollY;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    box.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerId: 8,
        pointerType: "touch",
        button: 0,
        clientX: x,
        clientY: y,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        pointerId: 8,
        pointerType: "touch",
        button: 0,
        clientX: x,
        clientY: y + 80,
      }),
    );
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: 8,
        pointerType: "touch",
        button: 0,
        clientX: x,
        clientY: y + 80,
      }),
    );
    return {
      same: box.checked === before,
      helpOpen: document.querySelector("#help-popover").hidden === false,
      scrolled: window.scrollY !== start,
    };
  });
  check("touch scroll does not change the checkbox", touchScroll.same, true);
  check("touch scroll is not an outside click", touchScroll.helpOpen, true);
  check("touch scroll moves the page", touchScroll.scrolled, true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.keyboard.press("Escape");
  const autoStarted = Date.now();
  await emphasisHelp.click();
  await page.waitForFunction(
    () => document.querySelector("#help-popover").hidden,
    null,
    { timeout: 20000 },
  );
  const autoElapsed = Date.now() - autoStarted;
  check(
    "help auto closes after 15 seconds",
    autoElapsed >= 14000 && autoElapsed < 19000,
    true,
  );
  const emphasis = await page
    .getByLabel("太字・斜体を変換", { exact: true })
    .isChecked();
  await page
    .getByRole("button", { name: "太字・斜体を変換の説明", exact: true })
    .tap();
  check(
    "touch tap does not toggle the checkbox",
    await page.getByLabel("太字・斜体を変換", { exact: true }).isChecked(),
    emphasis,
  );
  await page.keyboard.press("Escape");
  check(
    "output extension summary is visible without help",
    (await page.locator("#summary-outputExtension").textContent()).includes(
      "拡張子が変わっても変換内容は同じです。TXTにもMarkdown・Nyozeの記法が含まれます。",
    ),
    true,
  );
  const columnsAt = async (width) => {
    await page.setViewportSize({ width, height: 1100 });
    return page.evaluate(() => {
      const sectionOf = (id) => document.querySelector(id).parentElement;
      const tracks = (section) => {
        const columns = getComputedStyle(section).gridTemplateColumns;
        if (columns === "none") return 1;
        return columns.split(" ").filter((part) => part !== "0px").length;
      };
      const placed = (section) => {
        const blocks = [
          ...section.querySelectorAll(
            ":scope > .setting-grid > .setting-block, :scope > .setting",
          ),
        ];
        const sectionBox = section.getBoundingClientRect();
        const boxes = blocks.map((node) => node.getBoundingClientRect());
        return {
          count: boxes.length,
          distinctLefts: new Set(boxes.map((box) => Math.round(box.left))).size,
          widest: Math.max(...boxes.map((box) => box.width), 0),
          section: sectionBox.width,
          overflow: section.scrollWidth > section.clientWidth + 1,
        };
      };
      const body = sectionOf("#body-controls");
      const decoration = sectionOf("#decoration-controls");
      const nyoze = sectionOf("#nyoze-controls");
      const parent = document
        .querySelector("#option-convertUnderline")
        .closest(".setting-block")
        .getBoundingClientRect();
      const child = document
        .querySelector("#setting-underline-format")
        .getBoundingClientRect();
      const nested = document
        .querySelector("#option-approximateOtherUnderlineStyles")
        .getBoundingClientRect();
      return {
        tracks: tracks(body),
        body: placed(body),
        decoration: placed(decoration),
        nyoze: placed(nyoze),
        family:
          child.left >= parent.left - 1 &&
          child.right <= parent.right + 1 &&
          nested.left >= parent.left - 1 &&
          nested.right <= parent.right + 1,
      };
    });
  };
  for (const [width, tracks] of [
    [1440, 2],
    [900, 2],
    [899, 1],
    [768, 1],
    [390, 1],
  ]) {
    const placed = await columnsAt(width);
    check("details columns at " + width, placed.tracks, tracks);
    check(
      "details groups stay within the page at " + width,
      placed.body.overflow ||
        placed.decoration.overflow ||
        placed.nyoze.overflow,
      false,
    );
    check(
      "underline children stay inside the parent at " + width,
      placed.family,
      true,
    );
    const sideBySide = (group) =>
      group.count >= 2 &&
      group.distinctLefts >= 2 &&
      group.widest < group.section * 0.72;
    if (tracks === 2) {
      check(
        "body items use two columns at " + width,
        sideBySide(placed.body),
        true,
      );
      check(
        "decoration items use two columns at " + width,
        sideBySide(placed.decoration),
        true,
      );
      check(
        "nyoze items use two columns at " + width,
        sideBySide(placed.nyoze),
        true,
      );
    } else {
      check(
        "body items use one column at " + width,
        placed.body.distinctLefts,
        1,
      );
      check(
        "decoration items use one column at " + width,
        placed.decoration.distinctLefts,
        1,
      );
      check(
        "nyoze items use one column at " + width,
        placed.nyoze.distinctLefts,
        1,
      );
    }
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  check(
    "advanced reading order matches the visual order",
    await page.evaluate(() => {
      const sections = [
        ...document.querySelectorAll("#advanced-settings .settings-group"),
      ];
      let previousSection = null;
      for (const section of sections) {
        const sectionBox = section.getBoundingClientRect();
        if (previousSection && sectionBox.top < previousSection.bottom - 20)
          return false;
        previousSection = sectionBox;
        const items = [
          ...section.querySelectorAll(
            ":scope > .setting-grid > .setting-block, :scope > .setting",
          ),
        ];
        let previous = null;
        for (const item of items) {
          if (getComputedStyle(item).order !== "0") return false;
          const box = item.getBoundingClientRect();
          if (previous) {
            const sameRow = Math.abs(box.top - previous.top) <= 20;
            if (sameRow && box.left <= previous.left + 20) return false;
            if (!sameRow && box.top < previous.top + 20) return false;
          }
          previous = box;
          const controls = [
            ...item.querySelectorAll("input, select, button, textarea"),
          ];
          for (let index = 1; index < controls.length; index++) {
            const before = controls[index - 1].getBoundingClientRect();
            const after = controls[index].getBoundingClientRect();
            if (after.top < before.top - 20) return false;
            if (
              Math.abs(after.top - before.top) <= 20 &&
              after.left < before.left - 1
            )
              return false;
          }
        }
      }
      return sections.length === 3;
    }),
    true,
  );
  check(
    "bouten and heading levels stay in the decoration group under their parents",
    await page.evaluate(
      () =>
        document
          .querySelector("#group-decoration-title")
          .parentElement.contains(document.querySelector("#setting-bouten")) &&
        document
          .querySelector("#children-convertUnderline")
          .contains(document.querySelector("#setting-underline-format")) &&
        document
          .querySelector("#children-convertBouten")
          .contains(document.querySelector("#setting-bouten")) &&
        document
          .querySelector("#children-convertHeadings")
          .contains(document.querySelector("#setting-heading-levels")) &&
        document
          .querySelector("#children-convertHeadings")
          .querySelectorAll("select").length === 3 &&
        document
          .querySelector("#group-body-title")
          .parentElement.contains(
            document.querySelector("#option-convertGaiji"),
          ),
    ),
    true,
  );
  await snapshot("07-details-open-1440");
  await page.setViewportSize({ width: 900, height: 1100 });
  await snapshot("07-details-open-900");
  await page.setViewportSize({ width: 768, height: 1100 });
  await snapshot("07-details-open-768");
  for (const [width, height] of [
    [1440, 900],
    [900, 900],
    [390, 900],
  ]) {
    await page.setViewportSize({ width, height });
    const placed = await page.evaluate(advancedHelpStaysByButton);
    check("advanced help count at " + width, placed.count, 24);
    check("advanced help stays by its button at " + width, placed.failures, []);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page
    .locator('[data-help-for="removeAozoraFooter"]')
    .scrollIntoViewIfNeeded();
  await page.locator('[data-help-for="removeAozoraFooter"]').click();
  await page.screenshot({
    path: "reports/web-screenshots/08-help-near-1440.png",
  });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 900, height: 900 });
  await page
    .locator('[data-help-for="underlineOutputFormat"]')
    .scrollIntoViewIfNeeded();
  await page.locator('[data-help-for="underlineOutputFormat"]').click();
  await page.screenshot({
    path: "reports/web-screenshots/08-help-near-900.png",
  });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 900 });
  await page.evaluate(async () => {
    const frame = () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    const button = document.querySelector(
      '[data-help-for="approximateOtherUnderlineStyles"]',
    );
    button.scrollIntoView({ block: "center" });
    await frame();
    button.click();
    const box = button.getBoundingClientRect();
    window.scrollTo(
      0,
      Math.max(
        0,
        box.top + window.scrollY - (window.innerHeight - box.height - 20),
      ),
    );
    await frame();
  });
  await page.screenshot({
    path: "reports/web-screenshots/08-help-near-390.png",
  });
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.scrollTo(0, 0));
  await snapshot("07-details-open-390");
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator("#advanced > summary").click();
  await page.waitForFunction(
    () =>
      !document.querySelector("#advanced").open &&
      document.querySelector("#details-title").textContent === "詳細設定を開く",
  );
  await snapshot("07-details-summary-closed");
  await button("設定を初期値に戻す").click();
  check(
    "reset child default",
    await page.getByLabel("字下げの元注記を保持", { exact: true }).isChecked(),
    false,
  );
  check(
    "reset does not open help by itself",
    await page.locator("#help-popover").isHidden(),
    true,
  );
  await plain();
  await setFiles([payload("same.txt", "A"), payload("same.txt", "B")]);
  await start();
  check(
    "same-name inputs have distinct visible sources",
    (await page.locator("#results").textContent()).includes(
      "入力1: same.txt",
    ) &&
      (await page.locator("#results").textContent()).includes(
        "入力2: same.txt",
      ),
    true,
  );
  const safe = "青［＃「青」は太字］\n［＃未対応］",
    literal =
      '<img src="https://invalid.example/image" onerror="alert(1)">\n本文';
  await setFiles([
    payload("安全.txt", safe),
    payload("保持.md", literal),
    payload("normal.zip", await readFile("tests/fixtures/zip/normal.zip")),
    payload("bad.zip", await readFile("tests/fixtures/zip/bad-crc.zip")),
  ]);
  await start();
  check(
    "partial message",
    (await page.locator("#status").textContent()).includes("一部の入力で失敗"),
    true,
  );
  check(
    "summary authoritative",
    await page.locator("#result-summary").textContent(),
    "出力 6件 · 失敗した入力 1件 · 未変換注記（OFFにした処理の注記を含む） 1箇所",
  );
  check(
    "positive summary counts are visibly distinguished",
    [
      await page
        .locator("#result-summary .attention-count--error")
        .textContent(),
      await page
        .locator("#result-summary .attention-count--note")
        .textContent(),
    ],
    ["1件", "1箇所"],
  );
  check(
    "only the output with remaining notes has a highlighted count",
    await page.locator("#results .attention-count--note").allTextContents(),
    ["1箇所"],
  );
  check("no automatic downloads", downloads.length, 0);
  check(
    "import diagnostic present",
    (await page.locator("#import-diagnostic-list").textContent()).includes(
      "ZIP_INVALID",
    ),
    true,
  );
  await page
    .getByRole("button", { name: "安全.mdの警告・注記を確認", exact: true })
    .click();
  check(
    "remaining output line",
    (await page.locator("#notes").textContent()).includes("出力 2行"),
    true,
  );
  check(
    "note exact text",
    await page.locator("#notes pre").textContent(),
    "［＃未対応］",
  );
  await snapshot("02-partial-warning-1440");
  const expected = [
    ["安全.md", "**青**\n［＃未対応］"],
    ["保持_converted.md", literal],
    ["normal/same.md", "FIRST"],
    ["normal/same_converted.md", "SECOND"],
    ["normal/a/book.md", "｜青《﹅》"],
    ["normal/b/book.md", "OTHER"],
  ];
  const helpWorkers = await page.evaluate(
    () => window.__webObservation.started.length,
  );
  const helpSummary = await page.locator("#result-summary").textContent();
  await page
    .getByRole("button", { name: "全出力を選択の説明", exact: true })
    .click();
  check(
    "help does not change the result summary",
    await page.locator("#result-summary").textContent(),
    helpSummary,
  );
  check(
    "help does not start a worker",
    await page.evaluate(() => window.__webObservation.started.length),
    helpWorkers,
  );
  await page.keyboard.press("Escape");
  check(
    "partial zip label",
    await page.locator("#create-output").textContent(),
    "ZIPファイルを作成（6件）",
  );
  await button("ZIPファイルを作成（6件）").click();
  await idle();
  check("preparation still no downloads", downloads.length, 0);
  await snapshot("03-ready-1440");
  await acquire("partial ZIP", "aozora-markdown.zip", undefined, expected);
  const summary = await page.locator("#result-summary").textContent();
  const issued = await page.evaluate(() => window.__webObservation.liveUrls);
  await page
    .getByRole("button", { name: "出力拡張子の説明", exact: true })
    .click();
  await button("選択を解除").click();
  check(
    "selection invalidates ready",
    await page.locator("#ready").isHidden(),
    true,
  );
  check(
    "clear-selection click closes settings help",
    await page.locator("#help-popover").isHidden(),
    true,
  );
  check(
    "clear-selection click collapses the explanation button",
    await page
      .locator('[data-help-for="outputExtension"]')
      .getAttribute("aria-expanded"),
    "false",
  );
  check(
    "always-visible summary remains after help closes",
    (await page.locator("#summary-outputExtension").textContent()).includes(
      "拡張子が変わっても変換内容は同じ",
    ),
    true,
  );
  check(
    "hidden delivery help keeps the result",
    await page.locator("#result-summary").textContent(),
    summary,
  );
  check(
    "hidden delivery help keeps issued URLs",
    await page.evaluate(() => window.__webObservation.liveUrls),
    issued,
  );
  await page.getByLabel("出力を選択: 安全.md", { exact: true }).check();
  await page
    .getByRole("button", { name: "ZIPにまとめるの説明", exact: true })
    .click();
  await button("選択を解除").click();
  check(
    "zip choice hides with no selection",
    await page.locator("#delivery-zip-choice").isHidden(),
    true,
  );
  check(
    "zip help closes with its choice",
    await page.locator("#help-popover").isHidden(),
    true,
  );
  check(
    "zip help button collapses",
    await page
      .locator('[data-help-for="delivery-zip"]')
      .getAttribute("aria-expanded"),
    "false",
  );
  check(
    "closing zip help keeps the result",
    await page.locator("#result-summary").textContent(),
    summary,
  );
  check(
    "closing zip help keeps issued URLs",
    await page.evaluate(() => window.__webObservation.liveUrls),
    issued,
  );
  await page.getByLabel("出力を選択: 安全.md", { exact: true }).check();
  await page
    .getByRole("button", { name: "そのままのファイルの説明", exact: true })
    .click();
  await page
    .getByLabel("出力を選択: 保持_converted.md", { exact: true })
    .check();
  check(
    "single choice hides for several outputs",
    await page.locator("#delivery-single-choice").isHidden(),
    true,
  );
  check(
    "single help closes when several outputs are selected",
    await page.locator("#help-popover").isHidden(),
    true,
  );
  check(
    "closing single help keeps the result",
    await page.locator("#result-summary").textContent(),
    summary,
  );
  await button("選択を解除").click();
  await page.getByLabel("出力を選択: 安全.md", { exact: true }).check();
  check(
    "drag away keeps zip radio",
    await dragOff(page.locator("#delivery-zip")),
    { before: false, onDown: false, after: false },
  );
  check(
    "single create label",
    await page.locator("#create-output").textContent(),
    "ダウンロード用ファイルを作成",
  );
  await button("ダウンロード用ファイルを作成").click();
  await idle();
  await acquire("single MD", "安全.md", "**青**\n［＃未対応］");
  await acquire("repeat MD", "安全.md", "**青**\n［＃未対応］");
  check(
    "download leaves stats",
    await page.locator("#result-summary").textContent(),
    summary,
  );
  for (let i = 0; i < 5; i++)
    await acquire("capacity " + i, "安全.md", "**青**\n［＃未対応］");
  await button("ダウンロード").click();
  check(
    "eighth URL cap message",
    (await page.locator("#download-message").textContent()).includes(
      "少し待ってから再試行",
    ),
    true,
  );
  check("no ninth download", downloads.length, 8);
  check(
    "issued URLs not revoked",
    await page.evaluate(() => window.__webObservation.revokes),
    0,
  );
  await button("全クリア").click();
  check(
    "clear focuses visible picker",
    await page.evaluate(() => document.activeElement.id),
    "pick-files",
  );
  check(
    "clear shows unselected",
    await page.locator("#file-selection-status").textContent(),
    "未選択",
  );
  check(
    "clear retains issued URLs",
    await page.evaluate(() => window.__webObservation.liveUrls),
    8,
  );
  check("clear drops results", await page.locator("#results > li").count(), 0);
  // Real page lifecycle handlers, synthetic persisted events (not a claim about native bfcache support).
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pagehide", { persisted: true }),
    ),
  );
  check(
    "pagehide revokes all",
    await page.evaluate(() => window.__webObservation.liveUrls),
    0,
  );
  check(
    "pagehide timer cleanup",
    await page.evaluate(() => window.__webObservation.timers.size),
    0,
  );
  await page.evaluate(() =>
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    ),
  );
  check(
    "restored fresh selection",
    await page.locator("#input-count").textContent(),
    "入力はまだありません。",
  );
  await plain();
  // S6: the extension changes only name/MIME. TXT output is converted like MD.
  const extension = (ext) =>
    page.getByRole("radio", { name: "." + ext, exact: true });
  check(
    "default output extension is .md",
    await extension("md").isChecked(),
    true,
  );
  await extension("txt").check();
  await setFiles([
    payload("そのまま.txt", "青［＃「青」は太字］"),
    payload("入力.md", "青［＃「青」は太字］"),
  ]);
  await start();
  check(
    "mixed TXT and MD inputs both become .txt",
    (await page.locator("#results").textContent()).includes(
      "そのまま_converted.txt",
    ) && (await page.locator("#results").textContent()).includes("入力.txt"),
    true,
  );
  check(
    "result meta names the extension and the remaining-note label",
    (await page.locator("#results").textContent()).includes(
      ".txt · 7 bytes · 未変換注記（OFFにした処理の注記を含む） 0箇所",
    ),
    true,
  );
  check(
    "zero error and note counts have no highlight",
    await page
      .locator("#result-summary .attention-count, #results .attention-count")
      .count(),
    0,
  );
  await button("選択を解除").click();
  await page
    .getByLabel("出力を選択: そのまま_converted.txt", { exact: true })
    .check();
  await button("ダウンロード用ファイルを作成").click();
  await idle();
  await acquire("single TXT", "そのまま_converted.txt", "**青**");
  await button("全出力を選択").click();
  await chooseZip();
  await button("ZIPファイルを作成（2件）").click();
  await idle();
  await acquire("TXT ZIP", "aozora-markdown.zip", undefined, [
    ["そのまま_converted.txt", "**青**"],
    ["入力.txt", "**青**"],
  ]);
  await extension("md").check();
  check(
    "option change invalidates old output",
    await page.locator("#results > li").count(),
    0,
  );
  await start();
  await button("選択を解除").click();
  await page.getByLabel("出力を選択: そのまま.md", { exact: true }).check();
  await button("ダウンロード用ファイルを作成").click();
  await idle();
  await acquire("single MD same body", "そのまま.md", "**青**");
  await button("全出力を選択").click();
  await chooseZip();
  await button("ZIPファイルを作成（2件）").click();
  await idle();
  await acquire("MD ZIP", "aozora-markdown.zip", undefined, [
    ["そのまま.md", "**青**"],
    ["入力_converted.md", "**青**"],
  ]);
  // S6: disabled children keep their values; heading levels reach the output.
  if (!(await page.locator("#advanced").evaluate((d) => d.open)))
    await page.locator("#advanced > summary").click();
  const bouten = page.getByLabel("傍点に使う文字", { exact: true });
  const large = page.getByLabel("大見出しのレベル", { exact: true });
  await bouten.fill("●");
  await large.selectOption("1");
  await page.getByLabel("傍点をルビ形式に変換", { exact: true }).uncheck();
  await page.getByLabel("見出しを変換", { exact: true }).uncheck();
  check(
    "OFF parents disable bouten/levels and keep their values",
    [
      await bouten.isDisabled(),
      await bouten.inputValue(),
      await large.isDisabled(),
      await large.inputValue(),
    ],
    [true, "●", true, "1"],
  );
  await page.getByLabel("傍点をルビ形式に変換", { exact: true }).check();
  await page.getByLabel("見出しを変換", { exact: true }).check();
  check(
    "ON again restores the kept values",
    [
      await bouten.isDisabled(),
      await bouten.inputValue(),
      await large.inputValue(),
    ],
    [false, "●", "1"],
  );
  await setFiles([
    payload("見出し.txt", "章［＃「章」は大見出し］\n空［＃「空」に傍点］"),
  ]);
  await start();
  await button("ダウンロード用ファイルを作成").click();
  await idle();
  await acquire("heading level 1", "見出し.md", "# 章\n｜空《●》");
  // All content parents OFF, including S7 convertTcy, shows the notice and keeps the body.
  const parents = [
    "外字注記を文字に変換",
    "縦中横をNyoze形式に変換",
    "太字・斜体を変換",
    "傍線を変換",
    "傍点をルビ形式に変換",
    "見出しを変換",
    "Nyozeの字下げ記法に変換",
    "Nyozeの地付き記法に変換",
    "Nyozeの改ページ記法に変換",
    "青空文庫の末尾情報を除去",
    "注記の説明区間を除去",
    "タイトル・著者などを文書先頭の情報欄に記録",
    "タイトル・著者などを本文にも残す",
  ];
  check(
    "no-conversion notice hidden while a parent is ON",
    await page.locator("#conversion-mode").isHidden(),
    true,
  );
  for (const label of parents)
    await page.getByLabel(label, { exact: true }).uncheck();
  check(
    "children of OFF parents stay disabled in all-OFF",
    await page.getByLabel("字下げの元注記を保持", { exact: true }).isDisabled(),
    true,
  );
  check(
    "all-OFF notice text",
    [
      await page.locator("#conversion-mode").isVisible(),
      await page.locator("#conversion-mode").textContent(),
    ],
    [true, "本文の変換なし。文字コードはUTF-8、改行はLFで出力します。"],
  );
  const allOff = "題\r\n著者\r\n\r\n※［＃U+0041］青［＃「青」は太字］\r\n";
  await setFiles([payload("無変換.txt", allOff)]);
  check(
    "all-OFF still permits import",
    await button("変換を開始").isEnabled(),
    true,
  );
  await start();
  check(
    "all-OFF keeps notes visible",
    (await page.locator("#result-summary").textContent()).includes(
      "未変換注記（OFFにした処理の注記を含む） 2箇所",
    ),
    true,
  );
  await button("ダウンロード用ファイルを作成").click();
  await idle();
  await acquire(
    "all-OFF body with LF",
    "無変換.md",
    "題\n著者\n\n※［＃U+0041］青［＃「青」は太字］\n",
  );
  await button("設定を初期値に戻す").click();
  check(
    "reset restores .md, levels and conversion",
    [
      await extension("md").isChecked(),
      await large.inputValue(),
      await bouten.inputValue(),
      await page.locator("#conversion-mode").isHidden(),
    ],
    [true, "2", "﹅", true],
  );
  await page.locator("#advanced > summary").click();
  // The S6 block used 6 of the 8 concurrent URL slots; release them through the real lifecycle handlers.
  for (const type of ["pagehide", "pageshow"])
    await page.evaluate(
      (type) =>
        window.dispatchEvent(
          new PageTransitionEvent(type, { persisted: true }),
        ),
      type,
    );
  check(
    "S6 downloads released before encoding checks",
    await page.evaluate(() => window.__webObservation.liveUrls),
    0,
  );
  await plain();
  for (const [encoding, name, text] of [
    ["cp932", "cp932.txt", "①髙"],
    ["shift_jis", "shift.txt", "青空"],
    ["utf-8", "utf8.txt", "青空😀"],
  ]) {
    await page
      .getByLabel("入力ファイルの文字コード", { exact: true })
      .selectOption(encoding);
    await setFiles([name === "utf8.txt" ? payload(name, text) : fixture(name)]);
    await start();
    await button("ダウンロード用ファイルを作成").click();
    await idle();
    await acquire(encoding, name.replace(".txt", ".md"), text);
  }
  await page
    .getByLabel("入力ファイルの文字コード", { exact: true })
    .selectOption("auto");
  await page.getByLabel("著者別の出力フォルダ", { exact: true }).check();
  const author = "---\ntitle: 題😀\nauthor: 著者\n---\n本文";
  await setFiles([payload("author.md", author)]);
  await start();
  check(
    "author folder",
    (await page.locator("#results").textContent()).includes("著者/題😀.md"),
    true,
  );
  await chooseZip();
  check(
    "one file can switch to zip",
    await page.locator("#create-output").textContent(),
    "ZIPファイルを作成（1件）",
  );
  await button("ZIPファイルを作成（1件）").click();
  await idle();
  await acquire("author ZIP", "aozora-markdown.zip", undefined, [
    ["著者/題😀.md", author],
  ]);
  await page.getByLabel("著者別の出力フォルダ", { exact: true }).uncheck();
  await setFiles([fixture("pages.zip")]);
  await start();
  check("bounded result page", await page.locator("#results > li").count(), 50);
  check(
    "select all pages",
    await page.locator("#selection-count").textContent(),
    "選択 52件 / 出力 52件",
  );
  await page
    .getByRole("navigation", { name: "結果のページ" })
    .getByRole("button", { name: "次のページ" })
    .click();
  check("second page", await page.locator("#results > li").count(), 2);
  check(
    "page selection retained",
    await page.locator("#selection-count").textContent(),
    "選択 52件 / 出力 52件",
  );
  await setFiles([
    payload("notes.txt", "行\n" + Array(55).fill("［＃未対応］").join("\n")),
  ]);
  await start();
  await page
    .getByRole("button", { name: "notes.mdの警告・注記を確認", exact: true })
    .click();
  check("bounded notes", await page.locator("#notes > li").count(), 50);
  await page
    .getByRole("navigation", { name: "注記のページ" })
    .getByRole("button", { name: "次のページ" })
    .click();
  check(
    "remaining notes reachable",
    await page.locator("#notes > li").count(),
    5,
  );
  check(
    "line number page 2",
    (await page.locator("#notes > li").first().textContent()).includes(
      "出力 52行",
    ),
    true,
  );
  // Input HTML-like text is rendered as text, never a tag/URL.
  const hostile = "<svg onload=alert(1)>" + "長い日本語😀".repeat(30) + ".txt";
  await setFiles([
    payload(
      hostile,
      '［＃<img src="https://invalid.example/x">' + "長文".repeat(300) + "］",
    ),
  ]);
  check(
    "hostile filename literal",
    (await page.locator("#inputs").textContent()).includes(hostile),
    true,
  );
  await start();
  await page
    .locator("#results button", { hasText: "警告・注記を確認" })
    .click();
  check(
    "no rendered image/svg",
    await page.locator("main img, main svg").count(),
    0,
  );
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    check(
      "no horizontal overflow " + width,
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page
      .getByRole("button", { name: "ファイルを選ぶの説明", exact: true })
      .scrollIntoViewIfNeeded();
    await page
      .getByRole("button", { name: "ファイルを選ぶの説明", exact: true })
      .click();
    const fit = await page.evaluate(() => {
      const pop = document
        .querySelector("#help-popover")
        .getBoundingClientRect();
      const btn = document
        .querySelector('[data-help-for="pick-files"]')
        .getBoundingClientRect();
      const overlap = !(
        pop.right <= btn.left + 1 ||
        pop.left >= btn.right - 1 ||
        pop.bottom <= btn.top + 1 ||
        pop.top >= btn.bottom - 1
      );
      return {
        overlap,
        inside:
          pop.left >= -1 &&
          pop.top >= -1 &&
          pop.right <= innerWidth + 1 &&
          pop.bottom <= innerHeight + 1,
        overflow: document.documentElement.scrollWidth <= innerWidth + 1,
      };
    });
    check("help inside viewport " + width, fit.inside, true);
    check("help does not cover its button " + width, fit.overlap, false);
    check("help does not widen the page " + width, fit.overflow, true);
    await snapshot("06-help-" + width);
    await page.keyboard.press("Escape");
    await snapshot("04-warning-" + width);
  }
  await page.setViewportSize({ width: 1440, height: 1100 });
  await setFiles([fixture("empty.zip"), fixture("ignored.zip")]);
  await start();
  check(
    "empty and ignored distinction",
    await page.locator("#outcomes").textContent(),
    "処理対象外の入力 1件 · 対象外ZIP entry 1件 · 空ZIP 1件。母数が異なるため、合算しません。",
  );
  check(
    "zero output preparation disabled",
    await page.locator("#create-output").isDisabled(),
    true,
  );
  await setFiles([payload("empty.txt", "")]);
  await start();
  await button("ダウンロード用ファイルを作成").click();
  await idle();
  await acquire("empty file", "empty.md", "");
  await page
    .getByLabel("入力ファイルの文字コード", { exact: true })
    .selectOption("utf-8");
  await page.locator("#advanced > summary").click();
  await page.getByLabel("Nyozeの字下げ記法に変換", { exact: true }).check();
  await page.getByLabel("字下げの元注記を保持", { exact: true }).check();
  await setFiles([
    payload("decode.txt", Buffer.from([255])),
    payload("broken.md", "---\ntitle: [\n---\n本文"),
    payload("preserve.txt", "［＃３字下げ］本文"),
  ]);
  await start();
  check(
    "strict decode failure explanation",
    (await page.locator("#import-diagnostic-list").textContent()).includes(
      "DECODE_FAILED",
    ),
    true,
  );
  await page
    .getByRole("button", {
      name: "broken_converted.mdの警告・注記を確認",
      exact: true,
    })
    .click();
  check(
    "frontmatter diagnosis",
    (await page.locator("#conversion-list").textContent()).includes(
      "FRONTMATTER_PARSE_FAILED",
    ),
    true,
  );
  await page
    .getByRole("button", { name: "preserve.mdの警告・注記を確認", exact: true })
    .click();
  check(
    "preserved note excluded from scan",
    await page.locator("#note-count").textContent(),
    "未変換注記（OFFにした処理の注記を含む） 0箇所",
  );
  await button("設定を初期値に戻す").click();
  await plain();
  await page.locator("#advanced > summary").click();
  // Stop real import while its synchronous core is active.
  await setFiles([payload("slow.txt", "青［＃「青」は太字］\n".repeat(50000))]);
  await button("変換を開始").click();
  await page.waitForFunction(() =>
    document.querySelector("#progress").textContent.includes("変換中"),
  );
  await button("処理を中止").click();
  check(
    "import cancel no output",
    await page.locator("#results > li").count(),
    0,
  );
  check(
    "cancel focus",
    await page.evaluate(() => document.activeElement.id),
    "result-summary",
  );
  await setFiles([fixture("large.zip")]);
  await start();
  const beforeExport = await page.evaluate(
    () =>
      window.__webObservation.started.filter((x) =>
        x.endsWith("export.worker.js"),
      ).length,
  );
  check(
    "multi-file create label",
    /^ZIPファイルを作成（\d+件）$/.test(
      (await page.locator("#create-output").textContent()).trim(),
    ),
    true,
  );
  await page.locator("#create-output").click();
  await page.waitForFunction(
    (before) =>
      window.__webObservation.started.filter((x) =>
        x.endsWith("export.worker.js"),
      ).length > before,
    beforeExport,
  );
  await page.waitForFunction(() =>
    /読取 [1-9]/.test(document.querySelector("#progress").textContent),
  );
  await button("処理を中止").click();
  check(
    "export cancel retains import",
    await page.locator("#results > li").count(),
    40,
  );
  check(
    "export cancel no ready Blob",
    await page.locator("#ready").isHidden(),
    true,
  );
  await setFiles([payload("retry.txt", "RETRY")]);
  await start();
  await button("ダウンロード用ファイルを作成").click();
  await idle();
  check(
    "retry after cancellation",
    await page.locator("#ready").isVisible(),
    true,
  );
  // Missing module assets: adapter must fail without fallback, then recover.
  await page.route("**/import.worker.js", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await start();
  check(
    "missing import Worker explanation",
    (await page.locator("#import-diagnostic-list").textContent()).includes(
      "WORKER_FAILED",
    ),
    true,
  );
  await page.unroute("**/import.worker.js");
  await start();
  await page.route("**/export.worker.js", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await chooseZip();
  await button("ZIPファイルを作成（1件）").click();
  await idle();
  check(
    "missing export Worker explanation",
    (await page.locator("#export-errors").textContent()).includes(
      "WORKER_FAILED",
    ),
    true,
  );
  check(
    "missing export preserves input result",
    await page.locator("#results > li").count(),
    1,
  );
  await page.unroute("**/export.worker.js");
  await button("ZIPファイルを作成（1件）").click();
  await idle();
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent("pagehide")),
  );
  const resources = await page.evaluate(() => ({
    started: window.__webObservation.started.length,
    terminated: window.__webObservation.terminated.length,
    urls: window.__webObservation.urls,
    revokes: window.__webObservation.revokes,
    live: window.__webObservation.liveUrls,
    timers: window.__webObservation.timers.size,
  }));
  check(
    "all actual Workers terminated",
    resources.started,
    resources.terminated,
  );
  check("all URLs revoked on dispose", resources.live, 0);
  check("all UI timers cleared", resources.timers, 0);
  report.resources = resources;
  check(
    "no external requests",
    network.filter((u) => !u.startsWith(server.url)),
    [],
  );
  check("no page errors", errors, []);
  report.network = network;
  await context.close();
  await server.close();
  server = undefined;
  // Subpath is a separate built-app run, not direct API calls.
  server = await createWebServer({ prefix: "/aozora-markdown/" });
  const sub = await browser.newPage({ acceptDownloads: true });
  const subNetwork = [];
  sub.on("request", (r) => subNetwork.push(r.url()));
  await sub.addInitScript(() => {
    window.__workers = { start: 0, end: 0 };
    const W = Worker;
    window.Worker = class extends W {
      constructor(...a) {
        super(...a);
        window.__workers.start++;
      }
      terminate() {
        window.__workers.end++;
        return super.terminate();
      }
    };
  });
  await sub.goto(server.url);
  await sub
    .getByLabel("タイトル・著者などを文書先頭の情報欄に記録", { exact: true })
    .uncheck();
  await sub.locator("#files").setInputFiles(payload("sub.txt", "SUB"));
  await sub.getByRole("button", { name: "変換を開始", exact: true }).click();
  await sub.waitForFunction(() => document.querySelector("#cancel").disabled);
  await sub.getByRole("radio", { name: "ZIPにまとめる", exact: true }).check();
  await sub
    .getByRole("button", { name: "ZIPファイルを作成（1件）", exact: true })
    .click();
  await sub.waitForFunction(
    () => document.querySelector("#ready").hidden === false,
  );
  const [download] = await Promise.all([
    sub.waitForEvent("download"),
    sub.getByRole("button", { name: "ダウンロード", exact: true }).click(),
  ]);
  const subPath = join(temp, "sub.zip");
  await download.saveAs(subPath);
  const checked = spawnSync("python3", ["scripts/check_export_zip.py"], {
    input: JSON.stringify({
      zip: (await readFile(subPath)).toString("base64"),
      entries: [
        {
          relativePath: "sub.md",
          base64: Buffer.from("SUB").toString("base64"),
        },
      ],
    }),
    encoding: "utf8",
  });
  check("subpath independent downloaded ZIP", checked.status, 0);
  check(
    "subpath both Worker assets",
    subNetwork
      .filter((u) => u.endsWith(".worker.js"))
      .map((u) => u.slice(server.url.length)),
    ["import.worker.js", "export.worker.js"],
  );
  check(
    "subpath external requests",
    subNetwork.filter((u) => !u.startsWith(server.url)),
    [],
  );
  report.subpathWorkers = await sub.evaluate(() => window.__workers);
  check("subpath Workers terminated", report.subpathWorkers, {
    start: 2,
    end: 2,
  });
  await sub.close();
  const denied = await fetch(new URL("../package.json", server.url));
  check("server excludes root outside prefix", denied.status, 404);
  // Fault injection serves an inert real Worker; the built UI still uses its
  // unchanged 60-second adapter watchdog. Playwright clock advances only test time.
  const fault = await browser.newContext();
  await fault.addInitScript(() => {
    window.__workerCounts = { start: 0, end: 0 };
    const W = Worker;
    window.Worker = class extends W {
      constructor(...args) {
        super(...args);
        window.__workerCounts.start++;
      }
      terminate() {
        window.__workerCounts.end++;
        return super.terminate();
      }
    };
  });
  const fp = await fault.newPage();
  await fp.clock.install();
  await fp.goto(server.url);
  await fp
    .getByLabel("タイトル・著者などを文書先頭の情報欄に記録", { exact: true })
    .uncheck();
  await fp.locator("#files").setInputFiles(payload("timeout.txt", "TIME"));
  await fp.route("**/import.worker.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: "/* deliberately inert test worker */",
    }),
  );
  await fp.getByRole("button", { name: "変換を開始", exact: true }).click();
  check(
    "busy disables settings",
    await fp
      .getByLabel("入力ファイルの文字コード", { exact: true })
      .isDisabled(),
    true,
  );
  check(
    "busy disables selection",
    await fp.locator("#pick-files").isDisabled(),
    true,
  );
  await fp.waitForFunction(() => window.__workerCounts.start === 1);
  await fp.clock.fastForward(60001);
  await fp.waitForFunction(() => document.querySelector("#cancel").disabled);
  check(
    "import timeout Japanese",
    (await fp.locator("#import-diagnostic-list").textContent()).includes(
      "準備時間の上限",
    ),
    true,
  );
  check("timeout no download", await fp.locator("#ready").isHidden(), true);
  await fp.unroute("**/import.worker.js");
  await fp.getByRole("button", { name: "変換を開始", exact: true }).click();
  await fp.waitForFunction(() => document.querySelector("#cancel").disabled);
  await fp.route("**/export.worker.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: "/* deliberately inert test worker */",
    }),
  );
  await fp.getByRole("radio", { name: "ZIPにまとめる", exact: true }).check();
  await fp
    .getByRole("button", { name: "ZIPファイルを作成（1件）", exact: true })
    .click();
  await fp.waitForFunction(() => window.__workerCounts.start === 3);
  await fp.clock.fastForward(60001);
  await fp.waitForFunction(() => document.querySelector("#cancel").disabled);
  check(
    "export timeout diagnostic",
    (await fp.locator("#export-errors").textContent()).includes("JOB_TIMEOUT"),
    true,
  );
  check(
    "export timeout preserves result",
    await fp.locator("#results > li").count(),
    1,
  );
  await fp.unroute("**/export.worker.js");
  await fp
    .getByRole("button", { name: "ZIPファイルを作成（1件）", exact: true })
    .click();
  await fp.waitForFunction(() => !document.querySelector("#ready").hidden);
  check("timeout retry", await fp.evaluate(() => window.__workerCounts), {
    start: 4,
    end: 4,
  });
  report.timeoutEvidence =
    "Real owned Workers with inert module fault injection; test clock 60001 ms; production limits unchanged";
  await fault.close();
  const unsupported = await browser.newContext();
  await unsupported.addInitScript(() => {
    window.Worker = undefined;
  });
  const up = await unsupported.newPage();
  await up.goto(server.url);
  check(
    "Worker unavailable explanation",
    (await up.locator("#status").textContent()).includes("利用できません"),
    true,
  );
  check(
    "Worker unavailable cannot start",
    await up
      .getByRole("button", { name: "変換を開始", exact: true })
      .isDisabled(),
    true,
  );
  await unsupported.close();
  // Native Chrome page zoom, configured only in a temporary test profile.
  // Chromium ChromeZoomLevelPrefs uses partition key "x" for the default profile.
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
    await zoom.addInitScript(() => {
      window.__workers = { start: 0, end: 0 };
      const W = Worker;
      window.Worker = class extends W {
        constructor(...a) {
          super(...a);
          window.__workers.start++;
        }
        terminate() {
          window.__workers.end++;
          return super.terminate();
        }
      };
    });
    const zp = await zoom.newPage();
    await zp.goto(server.url);
    await zp.locator("#files").setInputFiles(payload("拡大確認.txt", "ZOOM"));
    const geometry = await zp.evaluate(() => ({
      inner: innerWidth,
      outer: outerWidth,
      dpr: devicePixelRatio,
      scale: visualViewport.scale,
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));
    check("native 200 percent browser zoom", geometry, {
      inner: 720,
      outer: 1440,
      dpr: 2,
      scale: 1,
      overflow: false,
    });
    report.zoom = geometry;
    await zp
      .getByRole("button", { name: "ファイルを選ぶの説明", exact: true })
      .scrollIntoViewIfNeeded();
    await zp
      .getByRole("button", { name: "ファイルを選ぶの説明", exact: true })
      .click();
    const zoomHelp = await zp.evaluate(() => {
      const pop = document
        .querySelector("#help-popover")
        .getBoundingClientRect();
      const btn = document
        .querySelector('[data-help-for="pick-files"]')
        .getBoundingClientRect();
      return {
        overlap: !(
          pop.right <= btn.left + 1 ||
          pop.left >= btn.right - 1 ||
          pop.bottom <= btn.top + 1 ||
          pop.top >= btn.bottom - 1
        ),
        inside:
          pop.left >= -1 &&
          pop.top >= -1 &&
          pop.right <= innerWidth + 1 &&
          pop.bottom <= innerHeight + 1,
        overflow: document.documentElement.scrollWidth <= innerWidth + 1,
      };
    });
    check("zoom help inside viewport", zoomHelp.inside, true);
    check("zoom help does not cover its button", zoomHelp.overlap, false);
    check("zoom help does not widen the page", zoomHelp.overflow, true);
    await zp.keyboard.press("Escape");
    await zp.locator("#advanced > summary").click();
    await zp.waitForFunction(
      () =>
        document.querySelector("#advanced").open &&
        document.querySelector("#details-title").textContent ===
          "詳細設定を閉じる",
    );
    check(
      "zoom details label",
      await zp.locator("#details-title").textContent(),
      "詳細設定を閉じる",
    );
    check(
      "zoom details do not widen the page",
      await zp.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
      true,
    );
    const zoomPlaced = await zp.evaluate(advancedHelpStaysByButton);
    check("zoom advanced help count", zoomPlaced.count, 24);
    check("zoom advanced help stays by its button", zoomPlaced.failures, []);
    const zoomFooterHelp = zp.locator('[data-help-for="removeAozoraFooter"]');
    await zoomFooterHelp.scrollIntoViewIfNeeded();
    await zoomFooterHelp.click();
    await zp.locator("#help-popover").waitFor({ state: "visible" });
    await zp.screenshot({
      path: "reports/web-screenshots/08-help-near-zoom.png",
      fullPage: true,
    });
    await zp.keyboard.press("Escape");
    check(
      "zoom details use one column",
      await zp.evaluate(() => {
        const columns = getComputedStyle(
          document.querySelector("#body-controls").parentElement,
        ).gridTemplateColumns;
        return columns === "none"
          ? 1
          : columns.split(" ").filter((part) => part !== "0px").length;
      }),
      1,
    );
    await zp.screenshot({
      path: "reports/web-screenshots/07-details-open-zoom.png",
      fullPage: true,
    });
    await zp.locator("#advanced > summary").click();
    await zp
      .getByRole("button", { name: "設定を初期値に戻す", exact: true })
      .click();
    await zp
      .getByRole("button", { name: "出力拡張子の説明", exact: true })
      .click();
    await zp.evaluate(() => {
      const box = document.querySelector("#option-addFrontmatter");
      const top = box.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(
        0,
        Math.max(
          0,
          top - window.innerHeight + box.getBoundingClientRect().height + 12,
        ),
      );
    });
    check(
      "zoom help leaves next checkbox hittable",
      await zp.evaluate(() => {
        const box = document
          .querySelector("#option-addFrontmatter")
          .getBoundingClientRect();
        const hit = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2,
        );
        return document.querySelector("#help-popover").contains(hit);
      }),
      false,
    );
    const zoomBox = await zp.locator("#option-addFrontmatter").boundingBox();
    await zp.mouse.click(
      zoomBox.x + zoomBox.width / 2,
      zoomBox.y + zoomBox.height / 2,
    );
    check(
      "zoom click changes the visible checkbox",
      await zp.locator("#option-addFrontmatter").isChecked(),
      false,
    );
    await zp.locator("#option-addFrontmatter").check();
    await zp.keyboard.press("Escape");
    await zp
      .getByLabel("タイトル・著者などを文書先頭の情報欄に記録", { exact: true })
      .uncheck();
    await zp.getByRole("button", { name: "変換を開始", exact: true }).focus();
    await zp.keyboard.press("Enter");
    await zp.waitForFunction(() => document.querySelector("#cancel").disabled);
    check(
      "zoom keyboard start and focus",
      await zp.evaluate(() => document.activeElement.id),
      "result-summary",
    );
    await zp
      .getByRole("button", {
        name: "ダウンロード用ファイルを作成",
        exact: true,
      })
      .focus();
    await zp.keyboard.press("Enter");
    await zp.waitForFunction(() => !document.querySelector("#ready").hidden);
    check(
      "zoom keyboard preparation",
      await zp.locator("#ready").isVisible(),
      true,
    );
    report.zoomWorkers = await zp.evaluate(() => window.__workers);
    check("zoom Worker terminated", report.zoomWorkers, { start: 1, end: 1 });
    const image = "reports/web-screenshots/05-native-zoom-200.png";
    const cdp = await zoom.newCDPSession(zp);
    const clip = await zp.evaluate(() => ({
      x: 0,
      y: 0,
      width: innerWidth * devicePixelRatio,
      height: document.documentElement.scrollHeight * devicePixelRatio,
      scale: 1,
    }));
    const capture = await cdp.send("Page.captureScreenshot", {
      captureBeyondViewport: true,
      clip,
    });
    await writeFile(image, Buffer.from(capture.data, "base64"));
    report.screenshots.push(image);
  } finally {
    await zoom.close();
  }
  const traversal = await fetch(server.url + "%2e%2e%2fpackage.json");
  check("encoded traversal refused", traversal.status, 403);
  report.completed = true;
  report.finishedAt = new Date().toISOString();
  console.log(
    JSON.stringify({
      checks: report.checks.length,
      downloads: report.downloads.length,
      resources,
      completed: true,
    }),
  );
} finally {
  await writeFile(
    "reports/web-smoke.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await browser?.close();
  await server?.close();
  await rm(temp, { recursive: true, force: true });
}
