import { describe, it, expect } from "vitest";
import {
  convertText,
  convertHeadings,
  ConversionOptionsError,
  DEFAULT_OPTIONS,
  DEFAULT_HEADING_LEVELS,
  type HeadingLevels,
} from "../../src/index.js";
import { normalizeOptions } from "../../src/core/options.js";
import { run, loose } from "./helpers.js";

// S6-03 HEADING_LEVEL_MAPPING.
const bare = {
  addFrontmatter: false,
  removeAozoraFooter: false,
  removeAnnotationBlocks: false,
} as const;
const KIND = { large: "大", medium: "中", small: "小" } as const;
const forms = (k: string) => ({
  forward: `章［＃「章」は${k}見出し］`,
  block: `［＃${k}見出し］章［＃${k}見出し終わり］`,
  range: `［＃ここから${k}見出し］\n章\n［＃ここで${k}見出し終わり］`,
});

describe("3 kinds x 6 levels = 18 mappings, every supported form", () => {
  for (const kind of Object.keys(KIND) as (keyof HeadingLevels)[])
    for (const level of [1, 2, 3, 4, 5, 6] as const)
      it(`${kind}(${KIND[kind]}) -> ${level}`, () => {
        const marks = "#".repeat(level);
        const levels = { [kind]: level };
        for (const [form, input] of Object.entries(forms(KIND[kind]))) {
          const r = convertText(input, { ...bare, headingLevels: levels });
          expect(r.text, form).toBe(`${marks} 章`);
          expect(r.stats.headings).toEqual({ converted: 1, unsupported: 0 });
          expect(convertHeadings(input, "markdown", levels).text, form).toBe(
            `${marks} 章`,
          );
        }
        // The other two kinds keep their defaults (deep merge).
        const doc = (["large", "medium", "small"] as const)
          .map((k) => `${k}［＃「${k}」は${KIND[k]}見出し］`)
          .join("\n");
        const expected = { ...DEFAULT_HEADING_LEVELS, [kind]: level };
        expect(convertText(doc, { ...bare, headingLevels: levels }).text).toBe(
          (["large", "medium", "small"] as const)
            .map((k) => `${"#".repeat(expected[k])} ${k}`)
            .join("\n"),
        );
        // U+3000 indent stays: "#"s + ASCII space + U+3000 x 5 + title.
        expect(
          convertText(
            `［＃５字下げ］第一夜［＃「第一夜」は${KIND[kind]}見出し］`,
            {
              ...bare,
              headingLevels: levels,
            },
          ).text,
        ).toBe(`${marks} \u3000\u3000\u3000\u3000\u3000第一夜`);
      });
  it("defaults are 2/3/4 and the two-argument convertHeadings keeps them", () => {
    expect(DEFAULT_OPTIONS.headingLevels).toEqual({
      large: 2,
      medium: 3,
      small: 4,
    });
    for (const [kind, marks] of [
      ["大", "##"],
      ["中", "###"],
      ["小", "####"],
    ])
      expect(convertHeadings(`章［＃「章」は${kind}見出し］`).text).toBe(
        `${marks} 章`,
      );
    expect(convertHeadings("章［＃「章」は大見出し］", "markdown").text).toBe(
      "## 章",
    );
  });
  it("inverted and equal levels are allowed as given", () => {
    const doc =
      "a［＃「a」は大見出し］\nb［＃「b」は中見出し］\nc［＃「c」は小見出し］";
    expect(
      convertText(doc, {
        ...bare,
        headingLevels: { large: 6, medium: 1, small: 1 },
      }).text,
    ).toBe("###### a\n# b\n# c");
  });
  it("quote mismatch stays unconverted with a diagnostic at every level", () => {
    for (const level of [1, 6] as const) {
      const input = "本文［＃「不一致」は大見出し］";
      const r = convertText(input, {
        ...bare,
        headingLevels: { large: level },
      });
      expect(r.text).toBe(input);
      expect(r.stats.headings.converted).toBe(0);
      expect(r.diagnostics.map((d) => d.code)).toContain(
        "HEADING_TARGET_MISMATCH",
      );
    }
  });
  it("unsupported heading kinds are counted, not mapped", () => {
    const r = convertText("章［＃「章」は窓大見出し］", {
      ...bare,
      headingLevels: { large: 1 },
    });
    expect(r.text).toBe("章［＃「章」は窓大見出し］");
    expect(r.stats.headings).toEqual({ converted: 0, unsupported: 1 });
  });
});

describe("validation, deep merge, no shared nested state", () => {
  const invalid: [string, unknown][] = [
    ["0", 0],
    ["7", 7],
    ["-1", -1],
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["1.5", 1.5],
    ['"2"', "2"],
    ["null", null],
    ["true", true],
    ["2n", 2n],
  ];
  it.each(invalid)(
    "level %s is rejected (headings ON and OFF, all entry points)",
    async (_, value) => {
      for (const convertHeadingsFlag of [true, false]) {
        const options = {
          convertHeadings: convertHeadingsFlag,
          headingLevels: { medium: value } as never,
        };
        let error: unknown;
        try {
          convertText("x", options);
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(ConversionOptionsError);
        expect(error).toBeInstanceOf(TypeError);
        expect((error as ConversionOptionsError).field).toBe(
          "headingLevels.medium",
        );
        const r = await run([loose("a.txt", "x")], { conversion: options });
        expect(r.status).toBe("failed");
        expect(r.diagnostics[0]).toMatchObject({
          code: "INVALID_OPTION",
          reason: "conversion.headingLevels.medium",
        });
      }
      expect(() =>
        convertHeadings("x", "markdown", { medium: value } as never),
      ).toThrow(ConversionOptionsError);
    },
  );
  it.each([
    ["null", null, "headingLevels"],
    ["array", [2, 3, 4], "headingLevels"],
    ["number", 2, "headingLevels"],
    ["unknown key", { huge: 1 }, "headingLevels.huge"],
  ])("headingLevels %s is rejected", (_, value, field) => {
    expect(() => convertText("x", { headingLevels: value as never })).toThrow(
      expect.objectContaining({ field }),
    );
  });
  it("partial and undefined children merge with defaults; nothing is mutated or shared", () => {
    const levels = Object.freeze({ medium: 1 as const, small: undefined });
    const options = Object.freeze({ headingLevels: levels });
    const a = normalizeOptions(options),
      b = normalizeOptions(options);
    expect(a.headingLevels).toEqual({ large: 2, medium: 1, small: 4 });
    expect(a.headingLevels).not.toBe(b.headingLevels);
    expect(a.headingLevels).not.toBe(DEFAULT_OPTIONS.headingLevels);
    a.headingLevels.large = 6;
    expect(b.headingLevels.large).toBe(2);
    expect(normalizeOptions().headingLevels).toEqual({
      large: 2,
      medium: 3,
      small: 4,
    });
    expect(levels).toEqual({ medium: 1, small: undefined });
    expect(Object.isFrozen(DEFAULT_OPTIONS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_OPTIONS.headingLevels)).toBe(true);
    expect(() => {
      (DEFAULT_OPTIONS.headingLevels as { large: number }).large = 1;
    }).toThrow(TypeError);
    expect(
      normalizeOptions({ headingLevels: undefined }).headingLevels,
    ).toEqual(DEFAULT_HEADING_LEVELS);
  });
  it("OFF -> ON returns to the chosen mapping; later default calls are unaffected", () => {
    const input = "章［＃「章」は大見出し］";
    const levels = { large: 1 as const };
    expect(
      convertText(input, {
        ...bare,
        convertHeadings: false,
        headingLevels: levels,
      }).text,
    ).toBe(input);
    expect(
      convertText(input, {
        ...bare,
        convertHeadings: true,
        headingLevels: levels,
      }).text,
    ).toBe("# 章");
    expect(convertText(input, bare).text).toBe("## 章");
    expect(levels).toEqual({ large: 1 });
  });
});
