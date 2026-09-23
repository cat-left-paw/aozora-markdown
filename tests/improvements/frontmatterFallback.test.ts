import { it, expect } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  convertText,
  createFrontmatter,
  readFrontmatter,
} from "../../src/index.js";
import { serializeFrontmatter } from "../../src/core/frontmatter.js";

const bare = {
  addFrontmatter: false,
  removeAozoraFooter: false,
  removeAnnotationBlocks: false,
} as const;
const note = "※［＃U+0041］";
const reported = [" 題\n ", " 題\n \n", "\n 題\n "];
const mixed = [
  ...reported,
  "題\n ",
  "題\n \n",
  "題\n  \n\n",
  "\t題\n\t",
  " \t題\n \t\n",
  "題\n\n ",
  "題\n \n \n\n",
  "\n\n 題\n\t\n\n",
  " \n 題\n ",
  " 題 \n ",
  " 題\n \t\n",
  " 題\n\n",
  "\n 題\n \n\n",
  " 題\n ---\n ",
  ` 題\n ${note}\n `,
  "𠀀が\n \n",
  " 題\n\t \n\n",
];
for (const raw_header of mixed)
  it(`F05 mixed text and trailing whitespace ${JSON.stringify(raw_header)}`, () => {
    const metadata = Object.freeze({ title: "題", author: "人", raw_header });
    const text = createFrontmatter(metadata);
    expect(parseYaml(text.slice(4, -3))).toEqual(metadata);
    const read = readFrontmatter(text);
    expect(read.ok).toBe(true);
    expect(read.metadata).toEqual(metadata);
    if (reported.includes(raw_header))
      expect(text).toContain("raw_header: " + JSON.stringify(raw_header));
    const result = convertText(text + "\n" + note, bare);
    expect(result.text).toBe(text + "\nA");
    expect(result.stats.gaiji.converted).toBe(1);
    expect(result.diagnostics).toEqual([]);
    expect(metadata.raw_header).toBe(raw_header);
  });

for (const [raw_header, field] of [
  ["副題", "|-\n  副題"],
  ["副題\n", "|\n  副題"],
  ["副題\n\n", "|+\n  副題\n  "],
  ["  副題\n次", "|2-\n    副題\n  次"],
  ["---", "|-\n  ---"],
  ["\n", "|+\n  "],
  ["", "|-\n  "],
  [" \n", '" \\n"'],
])
  it(`F05 normal literal / F01 / F03 output profile remains exact ${JSON.stringify(raw_header)}`, () => {
    const metadata = { title: "題", raw_header };
    const expected = "---\ntitle: 題\nraw_header: " + field + "\n---";
    expect(createFrontmatter(metadata)).toBe(expected);
    expect(parseYaml(expected.slice(4, -3))).toEqual(metadata);
    expect(readFrontmatter(expected).metadata).toEqual(metadata);
  });

it("F05 quoted fallback discards candidate placements but keeps other scalar placements", () => {
  const metadata = { title: "題", author: "人", raw_header: " ［＃注］\n " };
  const result = serializeFrontmatter(metadata);
  expect(result.text).toContain(
    "raw_header: " + JSON.stringify(metadata.raw_header),
  );
  expect(result.placements.map((p) => p.key)).toEqual(["title", "author"]);
  for (const p of result.placements)
    expect(result.text.slice(p.valueStart, p.valueEnd)).toBe(
      metadata[p.key as "title" | "author"].slice(p.sourceStart, p.sourceEnd),
    );
  expect(readFrontmatter(result.text).metadata).toEqual(metadata);
});
it("F05 valid literal retains exact source spans for note provenance", () => {
  const metadata = { title: "題", raw_header: " ［＃注］\n次" };
  const result = serializeFrontmatter(metadata);
  expect(result.text).toContain("raw_header: |2-");
  const placements = result.placements.filter((p) => p.key === "raw_header");
  expect(placements).toHaveLength(2);
  expect(
    placements.map((p) => result.text.slice(p.valueStart, p.valueEnd)),
  ).toEqual([" ［＃注］", "次"]);
  for (const p of placements)
    expect(result.text.slice(p.valueStart, p.valueEnd)).toBe(
      metadata.raw_header.slice(p.sourceStart, p.sourceEnd),
    );
});
