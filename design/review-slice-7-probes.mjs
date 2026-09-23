// Independent Slice 7 regression probe. Run after `npm run build`.
// Exit 0 means a partial quote no longer splits a generated tate-chu-yoko span.
import assert from "node:assert/strict";
import { convertText } from "../dist/index.js";
import { prepareImport } from "../dist/import/index.js";

const options = {
  addFrontmatter: false,
  removeAnnotationBlocks: false,
  removeAozoraFooter: false,
};
const base = "12［＃「12」は縦中横］";
const cases = [
  {
    id: "positive-control",
    input: base + "［＃「12」は太字］",
    expected: "**｟12｠**",
  },
  ...[
    ["bold-partial", "［＃「｠」は太字］"],
    ["italic-partial", "［＃「｠」は斜体］"],
    ["underline-partial", "［＃「｠」に傍線］"],
    ["bouten-partial", "［＃「｠」に傍点］"],
    ["bold-partial-with-body", "［＃「2｠」は太字］"],
  ].map(([id, note]) => ({
    id,
    input: base + note,
    expected: "｟12｠" + note,
  })),
  {
    id: "bouten-whole-generated-tcy",
    input: base + "［＃「｟12｠」に傍点］",
    expected: "｟12｠［＃「｟12｠」に傍点］",
  },
];
const failures = [];
for (const item of cases) {
  const result = convertText(item.input, options);
  if (result.text !== item.expected)
    failures.push({
      id: item.id,
      expected: item.expected,
      actual: result.text,
      diagnostics: result.diagnostics.map((d) => d.code),
    });
}

const body = "題\n著者\n\n" + cases.at(-1).input;
for (const extension of ["md", "txt"]) {
  const result = await prepareImport(
    [{ id: extension, name: "case.md", kind: "md", bytes: new TextEncoder().encode(body) }],
    { outputExtension: extension },
  );
  assert.equal(result.status, "completed");
  const actual = new TextDecoder().decode(result.artifacts[0].bytes);
  if (!actual.includes(cases.at(-1).expected))
    failures.push({ id: "adapter-" + extension, actual });
}

console.log(JSON.stringify({ status: failures.length ? "FAIL" : "PASS", failures }, null, 2));
if (failures.length) process.exitCode = 1;
