// Independent review probe. Run after npm run build:web.
// A press that drags away before release must not activate checkbox or radio.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createWebServer } from "../scripts/serve-web.mjs";

const server = await createWebServer();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 720, height: 800 } });
  await page.goto(server.url);

  async function dragOff(locator) {
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
  }

  const checkbox = await dragOff(page.locator("#option-addFrontmatter"));
  await page.locator("#files").setInputFiles({
    name: "one.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("ONE"),
  });
  await page.getByRole("button", { name: "変換を開始", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#cancel").disabled);
  const radio = await dragOff(page.locator("#delivery-zip"));

  const observed = { checkbox, radio };
  console.log(JSON.stringify(observed, null, 2));
  assert.deepEqual(observed, {
    checkbox: { before: true, onDown: true, after: true },
    radio: { before: false, onDown: false, after: false },
  });
} finally {
  await browser.close();
  await server.close();
}
