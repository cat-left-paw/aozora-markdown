// Independent follow-up: generated and input TCY must not be split by later stages.
// Run after `npm run build`. Exit 0 means an outer wrap or an input span stays intact.
import assert from "node:assert/strict";
import { convertText } from "../dist/index.js";
import { prepareImport } from "../dist/import/index.js";

const options = {
  addFrontmatter: false,
  removeAnnotationBlocks: false,
  removeAozoraFooter: false,
};
const bold = "12［＃「12」は縦中横］［＃「12」は太字］";
const underline = "12［＃「12」は縦中横］［＃「12」に傍線］";
assert.equal(convertText(bold + "［＃「12」は中見出し］", options).text, "### **｟12｠**");
assert.equal(convertText("青［＃「青」に傍点］", options).text, "｜青《﹅》");
assert.equal(
  convertText("｟12｠［＃「｟12｠」は太字］", options).text,
  "**｟12｠**",
);

const cases = [
  {
    id: "bold-then-underline-partial",
    input: bold + "［＃「｠**」に傍線］",
    expected: "**｟12｠**［＃「｠**」に傍線］",
  },
  {
    id: "bold-then-bouten-partial",
    input: bold + "［＃「｠**」に傍点］",
    expected: "**｟12｠**［＃「｠**」に傍点］",
  },
  {
    id: "bold-then-bouten-whole",
    input: bold + "［＃「**｟12｠**」に傍点］",
    expected: "**｟12｠**［＃「**｟12｠**」に傍点］",
  },
  {
    id: "underline-then-bouten-partial",
    input: underline + "［＃「｠||」に傍点］",
    expected: "||｟12｠||［＃「｠||」に傍点］",
  },
  {
    id: "input-tcy-bold-partial",
    input: "｟12｠［＃「｠」は太字］",
    expected: "｟12｠［＃「｠」は太字］",
  },
  {
    id: "input-tcy-underline-partial",
    input: "｟12｠［＃「｠」に傍線］",
    expected: "｟12｠［＃「｠」に傍線］",
  },
  {
    id: "input-tcy-bouten-partial",
    input: "｟12｠［＃「｠」に傍点］",
    expected: "｟12｠［＃「｠」に傍点］",
  },
  {
    id: "input-tcy-bouten-whole",
    input: "｟12｠［＃「｟12｠」に傍点］",
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

const source = "題\n著者\n\n" + cases[1].input;
for (const extension of ["md", "txt"]) {
  const result = await prepareImport(
    [
      {
        id: extension,
        name: "chain.md",
        kind: "md",
        bytes: new TextEncoder().encode(source),
      },
    ],
    { outputExtension: extension },
  );
  assert.equal(result.status, "completed");
  const actual = new TextDecoder().decode(result.artifacts[0].bytes);
  if (!actual.includes(cases[1].expected))
    failures.push({ id: "adapter-" + extension, actual });
}

console.log(JSON.stringify({ status: failures.length ? "FAIL" : "PASS", failures }, null, 2));
if (failures.length) process.exitCode = 1;
