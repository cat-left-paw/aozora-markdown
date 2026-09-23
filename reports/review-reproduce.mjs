// Independent review probes. Run after npm run build:
// node reports/review-reproduce.mjs
// Exit 1 means a reviewed requirement still fails; this does not alter production files.
import { writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { parse as parseYaml } from "yaml";
import {
  convertText,
  createFrontmatter,
  readFrontmatter,
} from "../dist/index.js";

const options = {
  addFrontmatter: false,
  removeAozoraFooter: false,
  removeAnnotationBlocks: false,
};
const yamlContent =
  "title: |\n  前\n  ---\n  ※［＃U+0041］\nauthor: 人\n";
const existing = "---\n" + yamlContent + "---\n本文";
const combined =
  "［＃傍線］青［＃「青」は太字］［＃傍線終わり］［＃「青」は大見出し］";

const probes = [
  {
    id: "F01-existing-scalar-delimiter",
    input: existing,
    expected: {
      text: existing,
      metadata: parseYaml(yamlContent),
      gaijiConverted: 0,
    },
    run() {
      const result = convertText(this.input, options);
      return {
        text: result.text,
        metadata: readFrontmatter(this.input).metadata,
        gaijiConverted: result.stats.gaiji.converted,
      };
    },
  },
  {
    id: "F01-writer-scalar-delimiter",
    input: { title: "題", raw_header: "---", author: "人" },
    expected: { title: "題", raw_header: "---", author: "人" },
    run() {
      const text = createFrontmatter(this.input);
      return parseYaml(text.slice(4, -3));
    },
  },
  {
    id: "F01-default-pipeline-must-return",
    input: "題\n---\n著者\n\n本文",
    expected: { returned: true, rawHeader: "---" },
    run() {
      const result = convertText(this.input);
      return {
        returned: true,
        rawHeader: readFrontmatter(result.text).metadata?.raw_header,
      };
    },
  },
  {
    id: "F02-nested-generated-markup",
    input: combined,
    expected: { text: "## ||**青**||", headingCount: 1, remaining: [] },
    run() {
      const result = convertText(this.input, options);
      return {
        text: result.text,
        headingCount: result.stats.headings.converted,
        remaining: result.remainingNotes,
      };
    },
  },
  ...[" \n", "\n ", " \n \n"].map((raw_header, i) => ({
    id: `F03-whitespace-literal-${i}`,
    input: { title: "題", raw_header },
    expected: { title: "題", raw_header },
    run() {
      const text = createFrontmatter(this.input);
      return parseYaml(text.slice(4, -3));
    },
  })),
  // aozora-ts-v3: isMarkdownOutput was removed; explicit undefined stays accepted.
  ...["renameToMd", "convertMarkdownEmphasis"].map((key) => ({
    id: `F04-undefined-option-${key}`,
    input: { text: "青［＃「青」は太字］", explicitUndefinedOption: key },
    expected: { text: "**青**", markdownField: false },
    run() {
      const result = convertText(this.input.text, {
        ...options,
        [key]: undefined,
      });
      return {
        text: result.text,
        markdownField: "isMarkdownOutput" in result,
      };
    },
  })),
];

const cases = probes.map((probe) => {
  let actual;
  try {
    actual = probe.run();
  } catch (error) {
    actual = { exception: String(error) };
  }
  return {
    id: probe.id,
    input: probe.input,
    expected: probe.expected,
    actual,
    pass: isDeepStrictEqual(actual, probe.expected),
  };
});
const report = {
  command: "node reports/review-reproduce.mjs",
  node: process.version,
  decisionSet: "aozora-ts-v3",
  evidence: "Built ESM; expectations from R08/R10 and independent YAML content parse",
  cases,
};
await writeFile(
  new URL("./review-findings.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
for (const item of cases) console.log(`${item.pass ? "PASS" : "FAIL"} ${item.id}`);
if (cases.some((item) => !item.pass)) process.exitCode = 1;
