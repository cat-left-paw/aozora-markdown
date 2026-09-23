import { it, expect } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  createFrontmatter,
  readFrontmatter,
  convertText,
  parseAozoraHeader,
  getNamingMetadata,
  reconstructHeader,
  parseLegacyFrontmatter,
} from "../../src/index.js";
const bare = {
  addFrontmatter: false,
  removeAozoraFooter: false,
  removeAnnotationBlocks: false,
} as const;
for (const value of [
  "題",
  "a: b # c",
  "true",
  "001",
  "[人]",
  "---",
  '\\"',
  "line\nnext",
  "a\x00b",
  "\x85",
  "\u2028",
  "\t",
  "  題  ",
  "",
  "yes",
  "null",
  "~",
  "&a",
  "*a",
  "{x: 1}",
  "- item",
  "line\rnext",
])
  it("R08 scalar independent YAML round-trip " + JSON.stringify(value), () => {
    const metadata = {
      title: value,
      author: value,
      authors: [value || "甲", "乙"],
      translator: value,
      translators: ["甲訳", value || "乙訳"],
    };
    const text = createFrontmatter(metadata);
    const parsed = parseYaml(text.slice(4, -3));
    expect(parsed).toEqual(metadata);
    expect(readFrontmatter(text).metadata).toEqual({
      ...metadata,
      authors: metadata.authors.filter(
        (s) => !["\x85", "\u2028", "\t"].includes(s),
      ),
      translators: metadata.translators.filter(
        (s) => !["\x85", "\u2028", "\t"].includes(s),
      ),
    });
  });
for (const raw_header of [
  "副題",
  "副題\n",
  "副題\n\n",
  "副題\n\n\n",
  "\n副題",
  "  副題\n次",
  "\n  副題\n",
  "\n",
  "\n\n",
  "",
  "a\x01b",
  "a\rb",
  "a\u0085b",
  "\t副題\n",
])
  it("R08 literal chomping " + JSON.stringify(raw_header), () => {
    const metadata = { title: "題", raw_header, author: "著者" };
    const text = createFrontmatter(metadata);
    expect(parseYaml(text.slice(4, -3))).toEqual(metadata);
    expect(readFrontmatter(text).metadata).toEqual(metadata);
    const r = convertText(text + "\n本文", { ...bare, addHeaderToBody: true });
    expect(r.text).toBe(text + "\n" + reconstructHeader(metadata) + "本文");
  });
it("R08 normal simple scalars exact output and existing quoted FM stays verbatim", () => {
  expect(createFrontmatter({ title: "題", author: "著者" })).toBe(
    "---\ntitle: 題\nauthor: 著者\n---",
  );
  const fm =
    ' \t---\t\ntitle: "題" # comment\nunknown: ※［＃U+0041］\nauthor: 著者\n --- \n';
  expect(
    convertText(fm + "※［＃U+0042］", { ...bare, addFrontmatter: true }).text,
  ).toBe(fm + "B");
  expect(parseLegacyFrontmatter('---\ntitle: "題"\n---')).toEqual({
    title: '"題"',
  });
  expect(readFrontmatter('---\ntitle: "題"\n---').metadata).toEqual({
    title: "題",
  });
});
for (const [content, code] of [
  ["title: &a 題\nauthor: *a", "FRONTMATTER_PARSE_FAILED"],
  ["title: 題\ntitle: 重複", "FRONTMATTER_PARSE_FAILED"],
  ["title: [", "FRONTMATTER_PARSE_FAILED"],
  ["title: !custom 題", "FRONTMATTER_PARSE_FAILED"],
  ["title: {nested: value}", "FRONTMATTER_INVALID_TYPE"],
  ["authors: [甲, {nested: value}]", "FRONTMATTER_INVALID_TYPE"],
  ["[a, b]", "FRONTMATTER_PARSE_FAILED"],
  ["title: 題\n---\n---", "FRONTMATTER_PARSE_FAILED"],
].slice(0, 7))
  it("R08 rejected YAML " + content, () => {
    const fm = "---\n" + content + "\n---",
      text = fm + "\n※［＃U+0041］";
    const r = convertText(text, {
      ...bare,
      addFrontmatter: true,
      addHeaderToBody: true,
    });
    expect(r.text).toBe(fm + "\nA");
    expect(r.namingMetadata.ok).toBe(false);
    expect(r.diagnostics).toEqual([
      {
        code,
        severity: "warning",
        stage: "frontmatter",
        range: { startUtf16: 0, endUtf16: fm.length },
        sourceOccurrenceId: `source:0:${fm.length}`,
        details: {
          reason:
            content.includes("*a") || content.includes("!custom")
              ? "alias-or-tag"
              : code === "FRONTMATTER_INVALID_TYPE"
                ? content.startsWith("authors")
                  ? "authors"
                  : "title"
                : "invalid-mapping",
        },
      },
    ]);
  });
it("R08 unclosed envelope is readonly to EOF; no extra frontmatter or restoration", () => {
  const s = "---\ntitle: 題\n※［＃U+0041］\n-----\n消さない";
  const r = convertText(s, { addHeaderToBody: true });
  expect(r.text).toBe(s);
  expect(r.remainingNotes).toEqual([]);
  expect(r.diagnostics[0].code).toBe("FRONTMATTER_PARSE_FAILED");
});
it("R08 prototype and unknown keys never merge into typed object", () => {
  const r = readFrontmatter(
    "---\n__proto__: {polluted: true}\nconstructor: x\nunknown: [1, 2]\ntitle: 題\n---",
  );
  expect(r.ok).toBe(true);
  expect(r.metadata).toEqual({ title: "題" });
  expect(({} as any).polluted).toBeUndefined();
});
it("R09 all header lines have one owner including translator-adjacent supplements", () => {
  const input = "題\n副題\n著者\n甲訳\n補足1\n乙訳\n補足2\n\n本文";
  const p = parseAozoraHeader(input);
  expect(p.metadata).toEqual({
    title: "題",
    author: "著者",
    translators: ["甲訳", "乙訳"],
    raw_header: "副題\n補足1\n補足2",
  });
  expect(p.owners.map((o) => o.line)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(new Set(p.owners.map((o) => o.line)).size).toBe(7);
  expect(p.body).toBe("本文");
  expect(parseAozoraHeader("題\n甲訳\n補足\n\n本文").metadata).toEqual({
    title: "題",
    translator: "甲訳",
    raw_header: "補足",
  });
  expect(parseAozoraHeader("題\n甲訳\n\n本文").metadata).toEqual({
    title: "題",
    author: "甲訳",
  });
});
for (const authors of ["", "[]", "null", "~", '["", " "]'])
  it("R09 empty authors fallback " + authors, () => {
    expect(
      getNamingMetadata(
        `---\ntitle: 題\nauthors: ${authors}\nauthor: 著者\n---`,
      ).metadata,
    ).toEqual({ title: "題", author: "著者" });
  });
it("R09 scalar authors means one author, never characters", () =>
  expect(getNamingMetadata("---\nauthors: 夏目漱石\n---").metadata).toEqual({
    authors: ["夏目漱石"],
    author: "夏目漱石",
  }));
it("R08/R09 generated YAML reinput naming and raw_header restoration", () => {
  const first = convertText("a: b # c\n副題\n著者\n\n本文");
  const second = convertText(first.text, { addHeaderToBody: true });
  expect(second.namingMetadata.metadata).toEqual({
    title: "a: b # c",
    author: "著者",
  });
  expect(second.text).toBe(
    first.text.replace(/本文$/u, "a: b # c\n副題\n著者\n\n本文"),
  );
});
