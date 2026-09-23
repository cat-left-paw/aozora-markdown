import { describe, expect, it } from "vitest";
import { convertText, type HeadingLevels } from "../../src/index.js";
import { quiet } from "./helpers.js";

const kinds = { large: "大", medium: "中", small: "小" } as const;

describe("S7-02 pipeline order: gaiji, then TCY, then emphasis", () => {
  it("wraps a generated TCY span with bold, italic, both, and underline", () => {
    expect(
      convertText("IIII［＃「IIII」は縦中横］［＃「IIII」は太字］", quiet).text,
    ).toBe("**｟IIII｠**");
    expect(
      convertText("IIII［＃「IIII」は縦中横］［＃「IIII」は斜体］", quiet).text,
    ).toBe("*｟IIII｠*");
    expect(
      convertText(
        "IIII［＃「IIII」は縦中横］［＃「IIII」は太字］［＃「IIII」は斜体］",
        quiet,
      ).text,
    ).toBe("***｟IIII｠***");
    expect(
      convertText("12［＃「12」は縦中横］［＃「12」に傍線］", quiet).text,
    ).toBe("||｟12｠||");
    expect(
      convertText("12［＃「12」は縦中横］［＃「12」に傍線］", {
        ...quiet,
        underlineOutputFormat: "html",
      }).text,
    ).toBe("<u>｟12｠</u>");
  });

  it("keeps the TCY base through emphasis or underline into a heading", () => {
    expect(
      convertText("12［＃「12」は縦中横］［＃「12」は中見出し］", quiet).text,
    ).toBe("### ｟12｠");
    expect(
      convertText(
        "IIII［＃「IIII」は縦中横］［＃「IIII」は太字］［＃「IIII」は中見出し］",
        quiet,
      ).text,
    ).toBe("### **｟IIII｠**");
    expect(
      convertText(
        "12［＃「12」は縦中横］［＃「12」に傍線］［＃「12」は中見出し］",
        quiet,
      ).text,
    ).toBe("### ||｟12｠||");
    expect(
      convertText(
        "12［＃「12」は縦中横］［＃「12」に傍線］［＃「12」は中見出し］",
        { ...quiet, underlineOutputFormat: "html" },
      ).text,
    ).toBe("### <u>｟12｠</u>");
    expect(
      convertText(
        "［＃５字下げ］12［＃「12」は縦中横］［＃「12」は中見出し］",
        quiet,
      ).text,
    ).toBe("### " + "　".repeat(5) + "｟12｠");
  });

  it("maps all 18 heading levels onto a generated TCY span", () => {
    for (const key of ["large", "medium", "small"] as const)
      for (let level = 1; level <= 6; level++) {
        const levels: Partial<HeadingLevels> = {
          [key]: level as HeadingLevels["large"],
        };
        const input = `12［＃「12」は縦中横］［＃「12」は${kinds[key]}見出し］`;
        expect(
          convertText(input, { ...quiet, headingLevels: levels }).text,
        ).toBe("#".repeat(level) + " ｟12｠");
      }
  });

  it("does not treat a note with another note in between as the immediate target", () => {
    const boldFirst = "IIII［＃「IIII」は太字］［＃「IIII」は縦中横］";
    const bold = convertText(boldFirst, quiet);
    expect(bold.text).toBe("**IIII**［＃「IIII」は縦中横］");
    expect(bold.stats.tcy).toEqual({ converted: 0, unconverted: 1 });
    expect(bold.stats.emphasis.bold).toBe(1);
    expect(bold.diagnostics[0]?.details.reason).toBe("target-mismatch");

    const line = "12［＃「12」に傍線］［＃「12」は縦中横］";
    expect(convertText(line, quiet).text).toBe("||12||［＃「12」は縦中横］");

    // Forward headings match only at end of line. A following TCY note blocks
    // that match, and TCY does not look through the heading note. Both stay.
    const heading = "12［＃「12」は中見出し］［＃「12」は縦中横］";
    const headed = convertText(heading, quiet);
    expect(headed.text).toBe(heading);
    expect(headed.stats.tcy).toEqual({ converted: 0, unconverted: 1 });
    expect(headed.stats.headings).toEqual({ converted: 0, unsupported: 0 });
  });

  it("does not strip markup to satisfy a partial quote or an input bracket", () => {
    const partial = "IIII［＃「IIII」は縦中横］［＃「II」は太字］";
    const p = convertText(partial, quiet);
    expect(p.text).toBe("｟IIII｠［＃「II」は太字］");
    expect(p.stats.emphasis.unconverted).toBe(1);
    expect(
      p.diagnostics.some((d) => d.details.reason === "target-mismatch"),
    ).toBe(true);

    const quotedBrackets =
      "IIII［＃「IIII」は縦中横］［＃「｟IIII｠」は太字］［＃「IIII」は中見出し］";
    expect(convertText(quotedBrackets, quiet).text).toBe(
      "**｟IIII｠**［＃「IIII」は中見出し］",
    );

    const inputTcy = "｟12｠［＃「12」は太字］";
    expect(convertText(inputTcy, quiet).text).toBe(inputTcy);
    const inputQuoted = "｟12｠［＃「｟12｠」は太字］［＃「12」は中見出し］";
    expect(convertText(inputQuoted, quiet).text).toBe(
      "**｟12｠**［＃「12」は中見出し］",
    );

    const similar = "【12】［＃「12」は太字］";
    expect(convertText(similar, quiet).text).toBe(similar);
  });

  it("a later call does not inherit TCY provenance from an earlier call", () => {
    const once = convertText("12［＃「12」は縦中横］", quiet).text;
    expect(once).toBe("｟12｠");
    expect(convertText(once + "［＃「12」は太字］", quiet).text).toBe(
      "｟12｠［＃「12」は太字］",
    );
  });

  it("keeps a quote that covers only part of a generated TCY span", () => {
    const base = "12［＃「12」は縦中横］";
    expect(convertText(base + "［＃「12」は太字］", quiet).text).toBe(
      "**｟12｠**",
    );
    expect(convertText(base + "［＃「12」に傍線］", quiet).text).toBe(
      "||｟12｠||",
    );
    expect(
      convertText(base + "［＃「12」に傍線］", {
        ...quiet,
        underlineOutputFormat: "html",
      }).text,
    ).toBe("<u>｟12｠</u>");
    expect(convertText(base + "［＃「｟12｠」に傍線］", quiet).text).toBe(
      "||｟12｠||",
    );

    for (const note of [
      "［＃「｠」は太字］",
      "［＃「｠」は斜体］",
      "［＃「2｠」は太字］",
      "［＃「2｠」は斜体］",
    ]) {
      const input = base + note;
      const r = convertText(input, quiet);
      expect(r.text, note).toBe("｟12｠" + note);
      expect(r.text, note).not.toContain("*");
      expect(r.stats.emphasis, note).toMatchObject({
        bold: 0,
        italic: 0,
        unconverted: 1,
      });
      const start = input.indexOf(note);
      expect(r.diagnostics, note).toContainEqual(
        expect.objectContaining({
          code: "EMPHASIS_NOT_CONVERTED",
          stage: "emphasis",
          range: { startUtf16: start, endUtf16: start + note.length },
          details: { reason: "target-mismatch" },
        }),
      );
    }

    for (const note of ["［＃「｠」に傍線］", "［＃「2｠」に傍線］"]) {
      for (const format of ["nyoze", "html"] as const) {
        const input = base + note;
        const r = convertText(input, {
          ...quiet,
          underlineOutputFormat: format,
        });
        expect(r.text, format + note).toBe("｟12｠" + note);
        expect(r.text, format + note).not.toContain(
          format === "html" ? "<u>" : "||",
        );
        expect(r.stats.underline, format + note).toEqual({
          converted: 0,
          approximated: 0,
          unconverted: 1,
        });
        const start = input.indexOf(note);
        expect(r.diagnostics, format + note).toContainEqual(
          expect.objectContaining({
            code: "UNDERLINE_NOT_CONVERTED",
            stage: "underline",
            range: { startUtf16: start, endUtf16: start + note.length },
            details: { reason: "target-mismatch" },
          }),
        );
      }
    }
  });

  it("refuses bouten that would split a generated TCY span", () => {
    const input = "12［＃「12」は縦中横］［＃「12」に傍点］";
    const r = convertText(input, quiet);
    expect(r.text).toBe("｟12｠［＃「12」に傍点］");
    expect(r.text).not.toContain("｜");
    expect(r.stats.tcy).toEqual({ converted: 1, unconverted: 0 });
    expect(r.stats.bouten).toEqual({ converted: 0, unconverted: 1 });
    expect(r.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "BOUTEN_NOT_CONVERTED",
        stage: "bouten",
        details: { reason: "tcy-overlap" },
      }),
    );
    const preexisting = "｟12｠［＃「12」に傍点］";
    const kept = convertText(preexisting, quiet);
    expect(kept.text).toBe(preexisting);
    expect(
      kept.diagnostics.some((d) => d.code === "BOUTEN_NOT_CONVERTED"),
    ).toBe(false);

    for (const note of [
      "［＃「｟12｠」に傍点］",
      "［＃「｠」に傍点］",
      "［＃「2｠」に傍点］",
    ]) {
      const input = "12［＃「12」は縦中横］" + note;
      const r = convertText(input, quiet);
      expect(r.text, note).toBe("｟12｠" + note);
      expect(r.text, note).not.toContain("｜");
      expect(r.stats.bouten, note).toEqual({ converted: 0, unconverted: 1 });
      const start = input.indexOf(note);
      expect(r.diagnostics, note).toContainEqual(
        expect.objectContaining({
          code: "BOUTEN_NOT_CONVERTED",
          stage: "bouten",
          range: { startUtf16: start, endUtf16: start + note.length },
          details: { reason: "tcy-overlap" },
        }),
      );
    }

    expect(convertText("青［＃「青」に傍点］", quiet).text).toBe("｜青《﹅》");
    const ruby = "｜12［＃「12」は縦中横］《読み》";
    expect(convertText(ruby, quiet).text).toBe(ruby);
  });

  it("keeps a quote that cuts a TCY span after an outer wrap", () => {
    expect(
      convertText(
        "12［＃「12」は縦中横］［＃「12」は太字］［＃「12」は中見出し］",
        quiet,
      ).text,
    ).toBe("### **｟12｠**");
    expect(convertText("青［＃「青」に傍点］", quiet).text).toBe("｜青《﹅》");
    expect(convertText("｟12｠青［＃「青」に傍点］", quiet).text).toBe(
      "｟12｠｜青《﹅》",
    );

    const bold = "12［＃「12」は縦中横］［＃「12」は太字］";
    const wrapped = "**｟12｠**";
    for (const [format, note] of [
      ["nyoze", "［＃「｠**」に傍線］"],
      ["nyoze", "［＃「2｠**」に傍線］"],
      ["html", "［＃「｠**」に傍線］"],
      ["html", "［＃「2｠**」に傍線］"],
    ] as const) {
      const input = bold + note;
      const r = convertText(input, {
        ...quiet,
        underlineOutputFormat: format,
      });
      expect(r.text, format + note).toBe(wrapped + note);
      expect(r.stats.emphasis.bold, format + note).toBe(1);
      expect(r.stats.emphasis.unconverted, format + note).toBe(0);
      expect(r.stats.underline, format + note).toEqual({
        converted: 0,
        approximated: 0,
        unconverted: 1,
      });
      expect(r.remainingNotes, format + note).toEqual([
        { line: 1, text: note },
      ]);
      expect(
        r.diagnostics.filter((d) => d.code === "UNDERLINE_NOT_CONVERTED"),
        format + note,
      ).toHaveLength(1);
    }

    const italic = "12［＃「12」は縦中横］［＃「12」は斜体］";
    const boutenNotes = [
      [bold, "**｟12｠**", "［＃「｠**」に傍点］"],
      [bold, "**｟12｠**", "［＃「2｠**」に傍点］"],
      [bold, "**｟12｠**", "［＃「**｟12｠**」に傍点］"],
      [italic, "*｟12｠*", "［＃「｠*」に傍点］"],
      [
        "12［＃「12」は縦中横］［＃「12」に傍線］",
        "||｟12｠||",
        "［＃「｠||」に傍点］",
      ],
      [
        "12［＃「12」は縦中横］［＃「12」に傍線］",
        "||｟12｠||",
        "［＃「||｟12｠||」に傍点］",
      ],
    ] as const;
    for (const [inputBase, visible, note] of boutenNotes) {
      const input = inputBase + note;
      const r = convertText(input, quiet);
      expect(r.text, note).toBe(visible + note);
      expect(r.text, note).not.toContain("｜");
      expect(r.stats.bouten, note).toEqual({ converted: 0, unconverted: 1 });
      expect(r.remainingNotes, note).toEqual([{ line: 1, text: note }]);
      expect(
        r.diagnostics.filter((d) => d.code === "BOUTEN_NOT_CONVERTED"),
        note,
      ).toEqual([
        expect.objectContaining({
          stage: "bouten",
          details: { reason: "tcy-overlap" },
        }),
      ]);
    }

    const htmlUnder =
      "12［＃「12」は縦中横］［＃「12」に傍線］［＃「｠</u>」に傍点］";
    const html = convertText(htmlUnder, {
      ...quiet,
      underlineOutputFormat: "html",
    });
    expect(html.text).toBe("<u>｟12｠</u>［＃「｠</u>」に傍点］");
    expect(html.stats.bouten).toEqual({ converted: 0, unconverted: 1 });
    expect(html.stats.underline).toEqual({
      converted: 1,
      approximated: 0,
      unconverted: 0,
    });
    expect(html.remainingNotes).toEqual([
      { line: 1, text: "［＃「｠</u>」に傍点］" },
    ]);
  });

  it("keeps a quote that cuts an input TCY span", () => {
    expect(convertText("｟12｠［＃「｟12｠」は太字］", quiet).text).toBe(
      "**｟12｠**",
    );
    expect(convertText("｟12｠［＃「｟12｠」に傍線］", quiet).text).toBe(
      "||｟12｠||",
    );
    const baseOnly = "｟12｠［＃「12」に傍点］";
    const ordinary = convertText(baseOnly, quiet);
    expect(ordinary.text).toBe(baseOnly);
    expect(
      ordinary.diagnostics.some((d) => d.code === "BOUTEN_NOT_CONVERTED"),
    ).toBe(false);

    for (const note of [
      "［＃「｠」は太字］",
      "［＃「2｠」は太字］",
      "［＃「｠」は斜体］",
    ]) {
      const input = "｟12｠" + note;
      const r = convertText(input, quiet);
      expect(r.text, note).toBe(input);
      expect(r.stats.emphasis, note).toMatchObject({
        bold: 0,
        italic: 0,
        unconverted: 1,
      });
      expect(r.remainingNotes, note).toEqual([{ line: 1, text: note }]);
      expect(
        r.diagnostics.filter((d) => d.code === "EMPHASIS_NOT_CONVERTED"),
        note,
      ).toHaveLength(1);
    }

    for (const format of ["nyoze", "html"] as const) {
      for (const note of ["［＃「｠」に傍線］", "［＃「2｠」に傍線］"]) {
        const input = "｟12｠" + note;
        const r = convertText(input, {
          ...quiet,
          underlineOutputFormat: format,
        });
        expect(r.text, format + note).toBe(input);
        expect(r.stats.underline, format + note).toEqual({
          converted: 0,
          approximated: 0,
          unconverted: 1,
        });
        expect(r.remainingNotes, format + note).toEqual([
          { line: 1, text: note },
        ]);
        expect(
          r.diagnostics.filter((d) => d.code === "UNDERLINE_NOT_CONVERTED"),
          format + note,
        ).toHaveLength(1);
      }
    }

    for (const note of [
      "［＃「｠」に傍点］",
      "［＃「2｠」に傍点］",
      "［＃「｟12｠」に傍点］",
    ]) {
      const input = "｟12｠" + note;
      const r = convertText(input, quiet);
      expect(r.text, note).toBe(input);
      expect(r.text, note).not.toContain("｜");
      expect(r.stats.bouten, note).toEqual({ converted: 0, unconverted: 1 });
      expect(r.remainingNotes, note).toEqual([{ line: 1, text: note }]);
      expect(
        r.diagnostics.filter((d) => d.code === "BOUTEN_NOT_CONVERTED"),
        note,
      ).toHaveLength(1);
    }
  });

  it("keeps a valid inner TCY span after an invalid opener", () => {
    expect(
      convertText("12［＃「12」は縦中横］［＃「12」は太字］", quiet).text,
    ).toBe("**｟12｠**");
    expect(
      convertText("12［＃「12」は縦中横］［＃「12」に傍線］", quiet).text,
    ).toBe("||｟12｠||");
    expect(
      convertText("12［＃「12」は縦中横］［＃「12」は中見出し］", quiet).text,
    ).toBe("### ｟12｠");
    expect(convertText("｟12｠［＃「｟12｠」は太字］", quiet).text).toBe(
      "**｟12｠**",
    );
    expect(convertText("青［＃「青」に傍点］", quiet).text).toBe("｜青《﹅》");

    const prefix = "｟X｟12｠";
    expect(convertText(prefix + "［＃「｟12｠」は太字］", quiet).text).toBe(
      "｟X**｟12｠**",
    );
    const baseQuote = prefix + "［＃「12」は太字］";
    expect(convertText(baseQuote, quiet).text).toBe(baseQuote);

    for (const note of [
      "［＃「｠」は太字］",
      "［＃「2｠」は太字］",
      "［＃「｠」は斜体］",
    ]) {
      const input = prefix + note;
      const r = convertText(input, quiet);
      expect(r.text, note).toBe(input);
      expect(r.stats.emphasis, note).toMatchObject({ unconverted: 1 });
      expect(r.remainingNotes, note).toEqual([{ line: 1, text: note }]);
      expect(
        r.diagnostics.filter((d) => d.code === "EMPHASIS_NOT_CONVERTED"),
        note,
      ).toEqual([
        expect.objectContaining({ details: { reason: "target-mismatch" } }),
      ]);
    }

    for (const format of ["nyoze", "html"] as const) {
      for (const note of ["［＃「｠」に傍線］", "［＃「2｠」に傍線］"]) {
        const input = prefix + note;
        const r = convertText(input, {
          ...quiet,
          underlineOutputFormat: format,
        });
        expect(r.text, format + note).toBe(input);
        expect(r.stats.underline, format + note).toEqual({
          converted: 0,
          approximated: 0,
          unconverted: 1,
        });
        expect(r.remainingNotes, format + note).toEqual([
          { line: 1, text: note },
        ]);
        expect(
          r.diagnostics.filter((d) => d.code === "UNDERLINE_NOT_CONVERTED"),
          format + note,
        ).toHaveLength(1);
      }
    }

    for (const note of [
      "［＃「｠」に傍点］",
      "［＃「2｠」に傍点］",
      "［＃「｟12｠」に傍点］",
    ]) {
      const input = prefix + note;
      const r = convertText(input, quiet);
      expect(r.text, note).toBe(input);
      expect(r.text, note).not.toContain("｜");
      expect(r.stats.bouten, note).toEqual({ converted: 0, unconverted: 1 });
      expect(r.remainingNotes, note).toEqual([{ line: 1, text: note }]);
      expect(
        r.diagnostics.filter((d) => d.code === "BOUTEN_NOT_CONVERTED"),
        note,
      ).toEqual([
        expect.objectContaining({ details: { reason: "tcy-overlap" } }),
      ]);
    }
  });

  it("keeps a range bouten that would split a TCY span", () => {
    const kinds = [
      "傍点",
      "白ゴマ傍点",
      "丸傍点",
      "白丸傍点",
      "黒三角傍点",
      "白三角傍点",
      "二重丸傍点",
      "蛇の目傍点",
      "ばつ傍点",
    ];
    const bodies = [
      ["｟12｠", "｟12｠", 0],
      ["12［＃「12」は縦中横］", "｟12｠", 1],
      ["｟X｟12｠", "｟X｟12｠", 0],
      ["12［＃「12」は縦中横］［＃「12」は太字］", "**｟12｠**", 1],
    ] as const;
    for (const kind of kinds) {
      for (const [body, expectedBody, tcyConverted] of bodies) {
        const input = `［＃${kind}］${body}［＃${kind}終わり］`;
        const expected = `［＃${kind}］${expectedBody}［＃${kind}終わり］`;
        const r = convertText(input, quiet);
        expect(r.text, input).toBe(expected);
        expect(r.text, input).not.toContain("｜");
        expect(r.stats.bouten, input).toEqual({
          converted: 0,
          unconverted: 1,
        });
        expect(r.stats.tcy.converted, input).toBe(tcyConverted);
        expect(r.remainingNotes, input).toEqual([
          { line: 1, text: `［＃${kind}］` },
          { line: 1, text: `［＃${kind}終わり］` },
        ]);
        expect(
          r.diagnostics.filter((d) => d.code === "BOUTEN_NOT_CONVERTED"),
          input,
        ).toEqual([
          expect.objectContaining({
            stage: "bouten",
            range: { startUtf16: 0, endUtf16: input.length },
            sourceOccurrenceId: `source:0:${input.length}`,
            details: { reason: "tcy-overlap" },
          }),
        ]);
      }
      expect(
        convertText(`［＃${kind}］青空［＃${kind}終わり］`, quiet).text,
      ).toBe("｜青《﹅》｜空《﹅》");
    }

    const mixed = "［＃傍点］青｟12｠［＃傍点終わり］";
    expect(convertText(mixed, quiet).text).toBe(mixed);

    const existing = "［＃傍点］｟12｠［＃傍点終わり］";
    const tcyOff = convertText(existing, { ...quiet, convertTcy: false });
    expect(tcyOff.text).toBe(existing);
    expect(tcyOff.stats.bouten).toEqual({ converted: 0, unconverted: 1 });
    expect(tcyOff.stats.tcy).toEqual({ converted: 0, unconverted: 0 });
    expect(
      tcyOff.diagnostics.filter((d) => d.code === "BOUTEN_NOT_CONVERTED"),
    ).toEqual([
      expect.objectContaining({
        details: { reason: "tcy-overlap" },
      }),
    ]);

    const generated = "［＃傍点］12［＃「12」は縦中横］［＃傍点終わり］";
    const boutenOff = convertText(generated, {
      ...quiet,
      convertBouten: false,
    });
    expect(boutenOff.text).toBe("［＃傍点］｟12｠［＃傍点終わり］");
    expect(boutenOff.stats.bouten).toEqual({ converted: 0, unconverted: 0 });
    expect(
      boutenOff.diagnostics.some((d) => d.code === "BOUTEN_NOT_CONVERTED"),
    ).toBe(false);

    const fenced = "```\n［＃傍点］｟12｠［＃傍点終わり］\n```\n";
    const fence = convertText(fenced, quiet);
    expect(fence.text).toBe(fenced);
    expect(fence.stats.bouten).toEqual({ converted: 0, unconverted: 0 });
    expect(fence.diagnostics.some((d) => d.stage === "bouten")).toBe(false);
  });

  it("does not rewrap an existing TCY span or enter ruby", () => {
    const adjacent = "｟12｠［＃「12」は縦中横］";
    expect(convertText(adjacent, quiet).text).toBe(adjacent);
    expect(convertText(adjacent, quiet).diagnostics[0]?.details.reason).toBe(
      "existing-tcy",
    );
    const inside = "｟12［＃「12」は縦中横］｠";
    expect(convertText(inside, quiet).text).toBe(inside);
    expect(convertText(inside, quiet).diagnostics[0]?.details.reason).toBe(
      "existing-tcy",
    );
    const afterClosed = "｜漢字《かん》12［＃「12」は縦中横］";
    expect(convertText(afterClosed, quiet).text).toBe("｜漢字《かん》｟12｠");

    for (const input of [
      "｜12［＃「12」は縦中横］《読み》",
      "12［＃「12」は縦中横］《読み》",
      "｜青《12［＃「12」は縦中横］》",
    ]) {
      const r = convertText(input, quiet);
      expect(r.text, input).toBe(input);
      expect(r.stats.tcy, input).toEqual({ converted: 0, unconverted: 1 });
      expect(r.diagnostics[0]?.details.reason, input).toBe("ruby-context");
    }
  });

  it("keeps fenced, inline and frontmatter text and does not count it", () => {
    const fence = "```\n12［＃「12」は縦中横］\n```\n";
    const inline = "`12［＃「12」は縦中横］`";
    const front = "---\ntitle: 12［＃「12」は縦中横］\n---\n本文\n";
    for (const input of [fence, inline, front]) {
      const r = convertText(input, quiet);
      expect(r.text, input).toBe(input);
      expect(r.stats.tcy, input).toEqual({ converted: 0, unconverted: 0 });
      expect(
        r.diagnostics.some((d) => d.stage === "tcy"),
        input,
      ).toBe(false);
    }
    const mixed = "12［＃「12」は縦中横］\n" + fence;
    const r = convertText(mixed, quiet);
    expect(r.text).toBe("｟12｠\n" + fence);
    expect(r.stats.tcy).toEqual({ converted: 1, unconverted: 0 });
    expect(r.remainingNotes).toEqual([]);
  });

  it("a note outside code whose target is inside code is kept and not counted", () => {
    const input = "`12`［＃「12」は縦中横］";
    const r = convertText(input, quiet);
    expect(r.text).toBe(input);
    expect(r.stats.tcy).toEqual({ converted: 0, unconverted: 0 });
    expect(r.remainingNotes).toEqual([
      { line: 1, text: "［＃「12」は縦中横］" },
    ]);
  });

  it("bold after underline-wrapped TCY is unsupported and is not stripped", () => {
    const input = "12［＃「12」は縦中横］［＃「12」に傍線］［＃「12」は太字］";
    expect(convertText(input, quiet).text).toBe("||｟12｠||［＃「12」は太字］");
  });
});
