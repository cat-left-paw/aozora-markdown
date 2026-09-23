// Independent S8 boundary: ::: inside a multiline inline-code span must not
// close the surrounding Nyoze directive. Download bytes are checked apart
// from preview DOM, because only the latter may be wrong.
import { chromium } from "playwright";
import { createWebServer } from "../scripts/serve-web.mjs";
import { readFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const body = ":::indent-1\n`code\n:::\nend`\n本文\n:::";
const input = `題\n著\n\n${body}`;
const expectedBytes = `---\ntitle: 題\nauthor: 著\n---\n${body}`;
const failures = [];
let browser;
let web;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  web = await createWebServer();
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  await page.goto(web.url);
  await page.locator("#files").setInputFiles({
    name: "inline.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(input, "utf8"),
  });
  await page.getByRole("button", { name: "変換を開始", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#cancel").disabled);
  await page
    .getByRole("button", { name: "inline_converted.mdをプレビュー" })
    .click();
  await page.waitForFunction(
    () => document.querySelector("#preview").dataset.status === "ready",
  );
  const actual = await page
    .locator("#preview-surface .preview-body")
    .evaluate((root) => ({
      indentCount: root.querySelectorAll(":scope > .preview-indent").length,
      inlineCode: [...root.querySelectorAll(".preview-indent p code")].map(
        (n) => n.textContent,
      ),
      indentText: [...root.querySelectorAll(".preview-indent p")].map(
        (n) => n.textContent,
      ),
      outsideParagraphs: [...root.querySelectorAll(":scope > p")].map(
        (n) => n.textContent,
      ),
    }));
  const expected = {
    indentCount: 1,
    inlineCode: ["code ::: end"],
    indentText: ["code ::: end\n本文"],
    outsideParagraphs: [],
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    failures.push({ id: "multiline-inline-code", expected, actual });

  await page.locator("#delivery-single").check();
  await page
    .getByRole("button", { name: "ダウンロード用ファイルを作成" })
    .click();
  await page.waitForFunction(() => document.querySelector("#cancel").disabled);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "ダウンロード", exact: true }).click(),
  ]);
  const file = join(
    await mkdtemp(join(tmpdir(), "aozora-s8-inline-review-")),
    "out.md",
  );
  await download.saveAs(file);
  const downloaded = await readFile(file, "utf8");
  if (downloaded !== expectedBytes)
    failures.push({
      id: "download-bytes",
      expected: expectedBytes,
      actual: downloaded,
    });
} finally {
  await browser?.close();
  await web?.close();
}
console.log(
  JSON.stringify(
    { status: failures.length ? "FAIL" : "PASS", failures },
    null,
    2,
  ),
);
if (failures.length) process.exitCode = 1;
