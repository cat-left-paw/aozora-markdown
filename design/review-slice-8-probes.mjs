// Independent Slice 8 boundary: a lone ::: inside fenced code is source text,
// not the closing delimiter of an outer Nyoze directive.
import { chromium } from "playwright";
import { createWebServer } from "../scripts/serve-web.mjs";
import { readFile, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const body = ":::indent-1\n```txt\n:::\n```\n本文\n:::";
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
    name: "case.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(input, "utf8"),
  });
  await page.getByRole("button", { name: "変換を開始", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#cancel").disabled);
  await page.getByRole("button", { name: "case_converted.mdをプレビュー" }).click();
  await page.waitForFunction(
    () => document.querySelector("#preview").dataset.status === "ready",
  );
  const actual = await page.locator("#preview-surface .preview-body").evaluate((root) => ({
    indentCount: root.querySelectorAll(".preview-indent").length,
    code: [...root.querySelectorAll(".preview-indent pre code")].map((n) => n.textContent),
    paragraphs: [...root.querySelectorAll(".preview-indent p")].map((n) => n.textContent),
    outsideCode: [...root.querySelectorAll(":scope > .preview-code pre code")].map((n) => n.textContent),
  }));
  const expected = {
    indentCount: 1,
    code: [":::\n"],
    paragraphs: ["本文"],
    outsideCode: [],
  };
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    failures.push({ id: "fenced-delimiter", expected, actual });

  await page.locator("#delivery-single").check();
  await page.getByRole("button", { name: "ダウンロード用ファイルを作成" }).click();
  await page.waitForFunction(() => document.querySelector("#cancel").disabled);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "ダウンロード", exact: true }).click(),
  ]);
  const file = join(await mkdtemp(join(tmpdir(), "aozora-s8-review-")), "out.md");
  await download.saveAs(file);
  const downloaded = await readFile(file, "utf8");
  if (downloaded !== expectedBytes)
    failures.push({ id: "download-bytes", expected: expectedBytes, actual: downloaded });
} finally {
  await browser?.close();
  await web?.close();
}
console.log(JSON.stringify({ status: failures.length ? "FAIL" : "PASS", failures }, null, 2));
if (failures.length) process.exitCode = 1;
