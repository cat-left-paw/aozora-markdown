// Independent review: built UI only, hand-authored output expectations.
// Run after npm run build:web. Does not change product sources or golden fixtures.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createWebServer } from "../scripts/serve-web.mjs";
import { DEFAULT_OPTIONS } from "../dist/index.js";

const report = {
  startedAt: new Date().toISOString(),
  checks: [],
  completed: false,
};
const check = (name, actual, expected) => {
  assert.deepEqual(actual, expected, name);
  report.checks.push(name);
};
const temp = await mkdtemp(join(tmpdir(), "aozora-s4-review-"));
const server = await createWebServer();
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  report.chrome = browser.version();
  const context = await browser.newContext({ acceptDownloads: true });
  await context.addInitScript(() => {
    window.__review = {
      started: 0,
      ended: 0,
      urls: 0,
      revoked: 0,
      persisted: false,
    };
    const W = Worker;
    window.Worker = class extends W {
      constructor(...args) {
        super(...args);
        window.__review.started++;
      }
      terminate() {
        window.__review.ended++;
        super.terminate();
      }
    };
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      window.__review.urls++;
      return create(blob);
    };
    URL.revokeObjectURL = (url) => {
      window.__review.revoked++;
      return revoke(url);
    };
    window.addEventListener("pageshow", (e) => {
      window.__review.persisted = e.persisted;
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  const file = (name, text) => ({
    name,
    mimeType: "text/plain",
    buffer: Buffer.from(text),
  });
  const files = (...f) => page.locator("#files").setInputFiles(f);
  const idle = () =>
    page.waitForFunction(() => document.querySelector("#cancel").disabled);
  const run = async () => {
    await button("変換を開始").click();
    await idle();
  };
  const download = async (name) => {
    const [d] = await Promise.all([
      page.waitForEvent("download"),
      button("ダウンロード").click(),
    ]);
    check(name + " acquisition", await d.failure(), null);
    const path = join(temp, name);
    await d.saveAs(path);
    return readFile(path);
  };
  await page.goto(server.url);
  await page.waitForFunction(
    () => document.querySelector("#boot-error").hidden,
  );
  const defaults = await page.evaluate(() =>
    Object.fromEntries([
      ...Array.from(document.querySelectorAll('[id^="option-"]')).map((i) => [
        i.id.slice(7),
        i.checked,
      ]),
      ["boutenChar", document.querySelector("#bouten").value],
      ["underlineOutputFormat", document.querySelector("#underline").value],
      // S6 migration (SCHEMA_V3_API/HEADING_LEVEL_MAPPING): renameToMd left the model; levels are nested selects.
      [
        "headingLevels",
        Object.fromEntries(
          Array.from(document.querySelectorAll("[data-level-key]")).map((s) => [
            s.dataset.levelKey,
            Number(s.value),
          ]),
        ),
      ],
    ]),
  );
  check(
    "all 23 built DOM defaults match public defaults",
    defaults,
    DEFAULT_OPTIONS,
  );
  await page
    .getByLabel("タイトル・著者などを文書先頭の情報欄に記録", { exact: true })
    .uncheck();

  // Reversed selection across pages must still export in original input order.
  await files(
    ...Array.from({ length: 52 }, (_, i) => file(`d${i}.txt`, `body-${i}`)),
  );
  check("input page bounded", await page.locator("#inputs > li").count(), 50);
  await run();
  await button("選択を解除").click();
  await page
    .locator("#result-pages")
    .getByRole("button", { name: "次のページ" })
    .click();
  await page.getByLabel("出力を選択: d51.md", { exact: true }).check();
  await page
    .locator("#result-pages")
    .getByRole("button", { name: "前のページ" })
    .click();
  await page.getByLabel("出力を選択: d0.md", { exact: true }).check();
  check(
    "selection across pages",
    await page.locator("#selection-count").textContent(),
    "選択 2件 / 出力 52件",
  );
  await button("ZIPファイルを作成（2件）").click();
  await idle();
  const zip = await download("selected.zip");
  const checked = spawnSync("python3", ["scripts/check_export_zip.py"], {
    input: JSON.stringify({
      zip: zip.toString("base64"),
      entries: [0, 51].map((i) => ({
        relativePath: `d${i}.md`,
        base64: Buffer.from(`body-${i}`).toString("base64"),
      })),
    }),
    encoding: "utf8",
  });
  check("cross-page ZIP independent bytes and order", checked.status, 0);

  // Changing note pages and then switching the document must reset that page.
  await files(
    file("many.txt", "［＃未対応］\n".repeat(51)),
    file("one.txt", "前\n［＃別注記］"),
  );
  await run();
  await page
    .getByRole("button", { name: "many.mdの警告・注記を確認", exact: true })
    .click();
  await page
    .locator("#note-pages")
    .getByRole("button", { name: "次のページ" })
    .click();
  check("notes second page", await page.locator("#notes > li").count(), 1);
  await page
    .getByRole("button", { name: "one.mdの警告・注記を確認", exact: true })
    .click();
  check(
    "switch document note text",
    await page.locator("#notes pre").textContent(),
    "［＃別注記］",
  );
  check(
    "switch document line",
    await page.locator("#notes strong").textContent(),
    "出力 2行",
  );
  check(
    "switch document resets pager",
    await page.locator("#note-pages").isHidden(),
    true,
  );

  // Supplementary mark is a single code point; a subsequent symbol is ignored by core.
  await page.locator("#advanced > summary").click();
  await page.locator("#bouten").fill("😀後");
  await files(file("mark.txt", "青［＃「青」に傍点］"));
  await run();
  await button("ダウンロード用ファイルを作成").click();
  await idle();
  check(
    "supplementary option through UI and Worker",
    (await download("mark.md")).toString(),
    "｜青《😀》",
  );
  await button("全クリア").click();
  check(
    "clear retains exact option",
    await page.locator("#bouten").inputValue(),
    "😀後",
  );
  check("clear drops ready", await page.locator("#ready").isHidden(), true);
  check(
    "clear retains issued URLs",
    await page.evaluate(() => __review.urls - __review.revoked),
    2,
  );

  // Actual long core work, clear, and immediate fresh selection; old finally must not win.
  await files(file("old.txt", "青［＃「青」は太字］\n".repeat(50000)));
  await button("変換を開始").click();
  await page.waitForFunction(() =>
    document.querySelector("#progress").textContent.includes("変換中"),
  );
  await button("全クリア").click();
  await files(file("fresh.txt", "FRESH"));
  await run();
  check(
    "clear during import then retry",
    await page.locator("#results label span").allTextContents(),
    ["fresh.md"],
  );
  check(
    "all owned Workers ended after retry",
    await page.evaluate(() => __review.started === __review.ended),
    true,
  );

  // Actual native navigation; report whether Chrome really elected bfcache.
  await page.getByRole("link", { name: "MIT License", exact: true }).click();
  await page.goBack();
  await page.waitForFunction(
    () => document.querySelector("#boot-error").hidden,
  );
  report.navigationUsedBfcache = await page.evaluate(() => __review.persisted);
  check(
    "navigation return clears input",
    await page.locator("#inputs > li").count(),
    0,
  );
  check(
    "navigation return clears results",
    await page.locator("#results > li").count(),
    0,
  );
  check(
    "navigation return settings agree with new model",
    await page
      .getByLabel("タイトル・著者などを文書先頭の情報欄に記録", { exact: true })
      .isChecked(),
    true,
  );
  check(
    "navigation no duplicate option controls",
    await page.locator('[id^="option-"]').count(),
    // S6 removed renameToMd and added 3 toggles; S7 adds convertTcy.
    20,
  );

  // Existing production timers, Playwright fake time; does not claim elapsed real time.
  await page.clock.install();
  await page
    .getByLabel("タイトル・著者などを文書先頭の情報欄に記録", { exact: true })
    .uncheck();
  await files(file("ttl.txt", "TTL"));
  await run();
  await button("ダウンロード用ファイルを作成").click();
  await idle();
  check(
    "TTL first acquired bytes",
    (await download("ttl.md")).toString(),
    "TTL",
  );
  check(
    "TTL issued URL alive",
    await page.evaluate(() => __review.urls - __review.revoked),
    1,
  );
  await page.clock.fastForward(60010);
  check(
    "TTL expired URLs released",
    await page.evaluate(() => __review.urls - __review.revoked),
    0,
  );
  check(
    "UI tracker released references",
    await page.locator("#download-count").textContent(),
    "",
  );
  check(
    "download after expiry",
    (await download("ttl-again.md")).toString(),
    "TTL",
  );
  check(
    "fresh URL after expiry",
    await page.evaluate(() => __review.urls - __review.revoked),
    1,
  );
  check("no browser page errors", errors, []);
  report.completed = true;
  report.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  await server.close();
  await mkdir("reports", { recursive: true });
  await writeFile(
    "reports/review-slice-4.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  await rm(temp, { recursive: true, force: true });
}
