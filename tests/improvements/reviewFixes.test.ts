import { describe, it, expect } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  convertText,
  createFrontmatter,
  readFrontmatter,
  DEFAULT_OPTIONS,
  type ConversionOptions,
} from "../../src/index.js";
import { normalizeOptions } from "../../src/core/options.js";

const bare = {
  addFrontmatter: false,
  removeAozoraFooter: false,
  removeAnnotationBlocks: false,
} as const;
const note = "※［＃U+0041］";
const scalarCases = [
  {
    id: "literal",
    value: `|\n  前\n  ---\n  ${note}`,
    expected: `前\n---\n${note}\n`,
  },
  {
    id: "folded",
    value: `>\n  前\n  ---\n  ${note}`,
    expected: `前 --- ${note}\n`,
  },
  {
    id: "single-quoted",
    value: `'前\n  ---\n  ${note}'`,
    expected: `前 --- ${note}`,
  },
  {
    id: "double-quoted",
    value: `"前\n  ---\n  ${note}"`,
    expected: `前 --- ${note}`,
  },
];

describe("F01 / R08 scalar-aware frontmatter envelope", () => {
  for (const scalar of scalarCases)
    for (const eol of ["\n", "\r\n"])
      for (const close of ["---", " \t--- \t"]) {
        it(`${scalar.id} ${JSON.stringify(eol)} ${JSON.stringify(close)}`, () => {
          const content = `title: ${scalar.value}\nauthor: 人\n`.replaceAll(
            "\n",
            eol,
          );
          const input = ` \t--- \t${eol}${content}${close}${eol}本文`;
          const expected = { title: scalar.expected, author: "人" };
          expect(parseYaml(content)).toEqual(expected);
          const read = readFrontmatter(input);
          expect(read.ok).toBe(true);
          expect(read.metadata).toEqual(expected);
          expect(read.envelope?.contentEnd).toBe(input.lastIndexOf(close));
          const converted = convertText(input, bare);
          expect(converted.text).toBe(input);
          expect(converted.stats.gaiji.converted).toBe(0);
          expect(converted.remainingNotes).toEqual([]);
          expect(converted.diagnostics).toEqual([]);
        });
      }
  for (const scalar of scalarCases)
    it(`unclosed envelope ${scalar.id}`, () => {
      const input = `---\ntitle: ${scalar.value}\nauthor: 人\n${note}`;
      const read = readFrontmatter(input);
      expect(read.ok).toBe(false);
      expect(read.envelope?.closed).toBe(false);
      const result = convertText(input);
      expect(result.text).toBe(input);
      expect(result.stats.gaiji.converted).toBe(0);
      expect(
        result.diagnostics.some((d) => d.code === "FRONTMATTER_PARSE_FAILED"),
      ).toBe(true);
    });
  it("scalar indentation wins over an ambiguous whitespace closing marker", () => {
    const input = `---\ntitle: |\n  前\n  ---\n  ${note}`;
    expect(readFrontmatter(input).envelope?.closed).toBe(false);
    expect(convertText(input, bare).text).toBe(input);
  });
  for (const quote of ["'", '"'])
    it(`unclosed quoted scalar ${quote}`, () => {
      const input = `---\ntitle: ${quote}前\n  ---\n  ${note}`;
      expect(readFrontmatter(input).ok).toBe(false);
      expect(readFrontmatter(input).envelope?.closed).toBe(false);
      expect(convertText(input, bare).text).toBe(input);
    });
  it("actual column-zero closing marker separates mutable body; explicit block indentation", () => {
    const fm = `---\ntitle: |2-\n  ---\n  ${note}\n---`;
    const result = convertText(fm + "\n" + note, bare);
    expect(readFrontmatter(fm).metadata).toEqual({ title: `---\n${note}` });
    expect(result.text).toBe(fm + "\nA");
    expect(result.stats.gaiji.converted).toBe(1);
  });
  it("whitespace outer delimiters remain supported outside block/quoted scalars", () => {
    const input = ` \t---\ntitle: 題\n\t --- \t\n${note}`;
    expect(readFrontmatter(input).metadata).toEqual({ title: "題" });
    expect(convertText(input, bare).text).toBe(input.replace(note, "A"));
  });
  for (const raw_header of ["---", "---\n", "前\n---\n後\n"])
    it(`writer delimiter payload ${JSON.stringify(raw_header)}`, () => {
      const metadata = { title: "題", raw_header, author: "人" };
      const text = createFrontmatter(metadata);
      expect(parseYaml(text.slice(4, -3))).toEqual(metadata);
      expect(readFrontmatter(text).metadata).toEqual(metadata);
      expect(convertText(text + "\n本文", bare).text).toBe(text + "\n本文");
    });
  it("ordinary TXT with delimiter-like header returns without throwing", () => {
    const result = convertText("題\n---\n著者\n\n本文");
    expect(readFrontmatter(result.text).metadata).toEqual({
      title: "題",
      author: "著者",
      raw_header: "---",
    });
    expect(result.text).toBe(
      "---\ntitle: 題\nauthor: 著者\nraw_header: |-\n  ---\n---\n本文",
    );
  });
});

describe("F02 / R10 generated markup composition", () => {
  const cases = [
    {
      id: "forward emphasis",
      input: "青［＃「青」は太字］",
      base: "青",
      display: "**青**",
      bold: 1,
      italic: 0,
    },
    {
      id: "range emphasis",
      input: "［＃太字］青［＃太字終わり］",
      base: "青",
      display: "**青**",
      bold: 1,
      italic: 0,
    },
    {
      id: "multiple words",
      input: "青［＃「青」は太字］ 空［＃「空」は斜体］",
      base: "青 空",
      display: "**青** *空*",
      bold: 1,
      italic: 1,
    },
    {
      id: "supplementary and combining",
      input: "𠀀が［＃「𠀀が」は太字］",
      base: "𠀀が",
      display: "**𠀀が**",
      bold: 1,
      italic: 0,
    },
  ];
  for (const format of ["nyoze", "html"] as const) {
    const wrap = (value: string) =>
      format === "html" ? `<u>${value}</u>` : `||${value}||`;
    for (const c of cases)
      it(`${format}: ${c.id}`, () => {
        const input = `［＃傍線］${c.input}［＃傍線終わり］［＃「${c.base}」は大見出し］`;
        const result = convertText(input, {
          ...bare,
          underlineOutputFormat: format,
        });
        expect(result.text).toBe("## " + wrap(c.display));
        expect(result.stats.emphasis).toEqual({
          bold: c.bold,
          italic: c.italic,
          both: 0,
          unconverted: 0,
        });
        expect(result.stats.underline.converted).toBe(1);
        expect(result.stats.headings.converted).toBe(1);
        expect(result.remainingNotes).toEqual([]);
        expect(result.diagnostics).toEqual([]);
      });
    it(`${format}: forward underline over generated emphasis`, () => {
      const result = convertText(
        "青［＃「青」は太字］［＃「**青**」に傍線］［＃「青」は大見出し］",
        { ...bare, underlineOutputFormat: format },
      );
      expect(result.text).toBe("## " + wrap("**青**"));
      expect(result.stats.headings.converted).toBe(1);
    });
    it(`${format}: block underline does not attach a later line to a heading`, () => {
      const result = convertText(
        "［＃ここから傍線］\n青［＃「青」は太字］\n［＃ここで傍線終わり］\n［＃「青」は大見出し］",
        { ...bare, underlineOutputFormat: format },
      );
      // The heading annotation is on a different line, so it must remain unmatched.
      expect(result.text).toBe(wrap("**青**") + "\n［＃「青」は大見出し］");
      expect(result.stats.headings.converted).toBe(0);
    });
    for (const inputMarkup of ["**青**", "<b>青</b>"])
      it(`${format}: input markup is not generated provenance ${inputMarkup}`, () => {
        const heading = "［＃「青」は大見出し］";
        const result = convertText(
          `［＃傍線］${inputMarkup}［＃傍線終わり］${heading}`,
          { ...bare, underlineOutputFormat: format },
        );
        expect(result.text).toBe(wrap(inputMarkup) + heading);
        expect(result.stats.headings.converted).toBe(0);
        expect(result.remainingNotes).toEqual([{ line: 1, text: heading }]);
        expect(result.diagnostics[0].details.baseText).toBe(inputMarkup);
      });
  }
  it("composition remains per-call and source input Markdown stays literal on a subsequent call", () => {
    convertText(
      "［＃傍線］青［＃「青」は太字］［＃傍線終わり］［＃「青」は大見出し］",
      bare,
    );
    const input = "||**青**||［＃「青」は大見出し］";
    expect(convertText(input, bare).text).toBe(input);
  });
});

for (const raw_header of [
  "",
  "\n",
  "\n\n",
  " ",
  "  ",
  "\t",
  " \n",
  "\n ",
  " \n \n",
  "\t\n",
  "\n\t",
  " \t\n\n",
  "\n \n\n",
  "\n\n ",
  "副題\n\n",
  "  副題\n",
  "\n  副題\n",
]) {
  it(`F03 / R08 raw_header whitespace exact values ${JSON.stringify(raw_header)}`, () => {
    const metadata = { title: "題", raw_header };
    const text = createFrontmatter(metadata);
    expect(parseYaml(text.slice(4, -3))).toEqual(metadata);
    const read = readFrontmatter(text);
    expect(read.ok).toBe(true);
    expect(read.metadata).toEqual(metadata);
    expect(convertText(text + "\n本文", bare).text).toBe(text + "\n本文");
  });
}

const explicit = {
  addFrontmatter: false,
  removeAnnotationBlocks: false,
  removeAozoraFooter: false,
  addHeaderToBody: true,
  convertGaiji: false,
  convertTcy: false,
  convertBouten: false,
  boutenChar: "●",
  convertHeadings: false,
  headingLevels: { large: 1, medium: 5, small: 6 },
  convertNyozeIndent: true,
  preserveIndentNotes: true,
  convertNyozeAlignEnd: true,
  approximateJiage: true,
  preserveAlignNotes: true,
  convertNyozePageBreak: true,
  approximateSpreadBreaks: true,
  preservePageBreakNotes: true,
  convertMarkdownEmphasis: false,
  convertUnderline: false,
  underlineOutputFormat: "html",
  approximateOtherUnderlineStyles: true,
  approximateLeftUnderline: true,
} satisfies Required<ConversionOptions>;
for (const key of Object.keys(explicit) as (keyof typeof explicit)[]) {
  it(`F04 omitted / undefined / explicit option: ${key}`, () => {
    const omitted = Object.freeze({});
    const undefinedOption: Readonly<ConversionOptions> = Object.freeze({
      ...omitted,
      [key]: undefined,
    });
    const explicitOption: Readonly<ConversionOptions> = Object.freeze({
      ...omitted,
      [key]: explicit[key],
    });
    expect(normalizeOptions(undefinedOption)).toEqual(
      normalizeOptions(omitted),
    );
    expect(normalizeOptions(explicitOption)[key]).toEqual(explicit[key]);
    expect(normalizeOptions(explicitOption)).toEqual({
      ...DEFAULT_OPTIONS,
      ...explicitOption,
    });
    for (const input of [
      "題\n著者\n\n青［＃「青」は太字］",
      "［＃ここから２字下げ］\n青［＃「青」に傍点］\n［＃ここで字下げ終わり］",
      "［＃２字上げ］青\n［＃改丁］\n［＃左に二重傍線］空［＃左に二重傍線終わり］",
      "※［＃「米＋羔」、U+7CD5］\n中見出し［＃「中見出し」は中見出し］",
    ]) {
      const expected = convertText(input);
      const actual = convertText(input, undefinedOption);
      expect(actual).toEqual(expected);
      expect(actual).not.toHaveProperty("isMarkdownOutput");
      expect(convertText(input, explicitOption)).toEqual(
        convertText(input, { ...DEFAULT_OPTIONS, ...explicitOption }),
      );
    }
    expect(undefinedOption[key]).toBeUndefined();
    expect(explicitOption[key]).toBe(explicit[key]);
  });
}
it("F04 explicit false is off and disabled parents retain child preferences", () => {
  const input = "青［＃「青」は太字］";
  expect(() =>
    convertText(input, { ...bare, renameToMd: false } as ConversionOptions),
  ).toThrow("outputExtension");
  expect(
    convertText(input, { ...bare, convertMarkdownEmphasis: false }).text,
  ).toBe(input);
  const options = Object.freeze({
    ...bare,
    convertNyozeIndent: false,
    preserveIndentNotes: true,
    convertNyozeAlignEnd: false,
    approximateJiage: true,
    preserveAlignNotes: true,
    convertNyozePageBreak: false,
    approximateSpreadBreaks: true,
    preservePageBreakNotes: true,
  });
  const normalized = normalizeOptions(options);
  for (const key of [
    "preserveIndentNotes",
    "approximateJiage",
    "preserveAlignNotes",
    "approximateSpreadBreaks",
    "preservePageBreakNotes",
  ] as const)
    expect(normalized[key]).toBe(true);
  const result = convertText(
    "［＃２字下げ］青\n［＃２字上げ］空\n［＃改丁］",
    options,
  );
  expect(result.text).toBe("［＃２字下げ］青\n［＃２字上げ］空\n［＃改丁］");
});
