// Independent second review. Does not alter source, tests, or reference expectations.
// Run after npm run build: node reports/review-recheck.mjs
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { parse as parseYaml } from "yaml";
import { convertText, createFrontmatter, readFrontmatter } from "../dist/index.js";

const bare = { addFrontmatter: false, removeAozoraFooter: false, removeAnnotationBlocks: false };
const note = "※［＃U+0041］";
const cases = [];
function probe(id, input, expected, run) {
  let actual;
  try { actual = run(); } catch (error) { actual = { exception: String(error) }; }
  cases.push({ id, input, expected, actual, pass: isDeepStrictEqual(actual, expected) });
}
for (const [i, raw_header] of [" 題\n ", " 題\n \n", "\n 題\n "].entries()) {
  const metadata = { title: "題", raw_header };
  probe(`F05-mixed-text-trailing-space-${i}`, metadata, metadata, () => {
    const fm = createFrontmatter(metadata);
    return parseYaml(fm.slice(4, -3));
  });
  probe(`F05-quoted-control-${i}`, metadata, metadata, () => {
    const fm = "---\ntitle: 題\nraw_header: " + JSON.stringify(raw_header) + "\n---";
    const independent = parseYaml(fm.slice(4, -3));
    if (!isDeepStrictEqual(independent, metadata)) throw new Error("Independent quoted control failed");
    return readFrontmatter(fm).metadata;
  });
}

// Exhaust a bounded set of raw_header line combinations; each final value is unique.
const rows = ["", " ", "  ", "\t", " \t", "a", " 題", "\t題", "---", " ---", "...", note, "'", '"', "|", ">"];
const stems = new Set(rows);
for (const a of rows) for (const b of rows) {
  stems.add(a + "\n" + b);
  for (const c of rows) stems.add(a + "\n" + b + "\n" + c);
}
const values = new Set([...stems].flatMap(v => [v, v + "\n", v + "\n\n"]));
const matrixFailures = [];
for (const raw_header of values) {
  const metadata = { title: "題", author: "人", raw_header };
  try {
    const fm = createFrontmatter(metadata);
    const independent = parseYaml(fm.slice(4, -3));
    const read = readFrontmatter(fm);
    const converted = convertText(fm + "\n" + note, bare);
    if (!isDeepStrictEqual(independent, metadata) || !isDeepStrictEqual(read.metadata, metadata)
        || converted.text !== fm + "\nA" || converted.stats.gaiji.converted !== 1)
      matrixFailures.push({ raw_header, independent, read, converted });
  } catch (error) { matrixFailures.push({ raw_header, exception: String(error) }); }
}

// Existing input includes nested unknown fields, escaped quotes, explicit indentation,
// true outer delimiters and mutable body; expectations do not use the product reader.
const yamlCases = [
  `title: |2+\n  前\n  ---\n  ${note}\n\nauthor: 人\n`,
  `title: >2-\n  前\n  ---\n  ${note}\nauthor: 人\n`,
  `title: '前 ''内''\n  ---\n  ${note}'\nauthor: 人\n`,
  `title: "前 \\"内\\"\n  ---\n  ${note}"\nauthor: 人\n`,
  `title: 題\nunknown:\n  child: |2\n    ---\n    ${note}\nauthor: 人\n`,
  `title: 題\nunknown:\n  - '前\n    ---\n    ${note}'\nauthor: 人\n`,
];
let index = 0;
for (const y of yamlCases) for (const eol of ["\n", "\r\n"]) for (const close of ["---", " \t--- \t"]) {
  const content = y.replaceAll("\n", eol);
  const input = "---" + eol + content + close + eol + note;
  const expectedMetadata = parseYaml(content);
  probe(`F01-additional-envelope-${index++}`, input,
    { title: expectedMetadata.title, author: expectedMetadata.author, text: input.slice(0, -note.length) + "A", gaiji: 1 }, () => {
      const read = readFrontmatter(input), converted = convertText(input, bare);
      if (!read.ok) throw new Error("Existing envelope parse failed");
      return { title: read.metadata.title, author: read.metadata.author, text: converted.text, gaiji: converted.stats.gaiji.converted };
    });
}

const combinations = [];
for (const base of ["青空", "𠀀", "が", "青 空"]) for (const style of ["太字", "斜体", "both"])
  for (const format of ["nyoze", "html"]) for (const heading of ["大", "中", "小"]) {
    const emphasis = style === "both" ? `${base}［＃「${base}」は太字］［＃「${base}」は斜体］` : `${base}［＃「${base}」は${style}］`;
    combinations.push({ input: `［＃傍線］${emphasis}［＃傍線終わり］［＃「${base}」は${heading}見出し］`, format });
  }
const python = String.raw`
import json, sys
from design.reference_oracle import load_reference
m = load_reference()
out = []
for c in json.load(sys.stdin):
    text, bold, italic, both, eu = m.convert_aozora_markdown_emphasis(c['input'])
    text, uc, ua, uu = m.convert_aozora_underline(text, output_format=c['format'])
    text, hc, hu = m.convert_aozora_headings(text)
    out.append({'text': text, 'emphasis': {'bold': bold, 'italic': italic, 'both': both, 'unconverted': eu}, 'underline': {'converted': uc, 'approximated': ua, 'unconverted': uu}, 'headings': {'converted': hc, 'unsupported': hu}})
print(json.dumps(out, ensure_ascii=False))
`;
const reference = JSON.parse(execFileSync("python3", ["-c", python], {
  input: JSON.stringify(combinations), encoding: "utf8", env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
}));
for (const [i, c] of combinations.entries()) probe(`F02-additional-Python-${i}`, c, reference[i], () => {
  const r = convertText(c.input, { ...bare, underlineOutputFormat: c.format });
  return { text: r.text, emphasis: r.stats.emphasis, underline: r.stats.underline, headings: r.stats.headings };
});

const report = {
  reviewedAt: new Date().toISOString(), command: "node reports/review-recheck.mjs",
  decisionSet: "aozora-ts-v3", node: process.version,
  cases, matrix: { uniqueValues: values.size, passed: values.size - matrixFailures.length, failed: matrixFailures.length, failures: matrixFailures },
};
writeFileSync(new URL("./review-recheck-results.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ probes: cases.length, failedProbes: cases.filter(c => !c.pass).map(c => c.id), matrix: { uniqueValues: values.size, failed: matrixFailures.length } }, null, 2));
if (cases.some(c => !c.pass) || matrixFailures.length) process.exitCode = 1;
