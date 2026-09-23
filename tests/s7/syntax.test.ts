import { describe, expect, it } from "vitest";
import { convertText, convertTcy } from "../../src/index.js";
import { quiet, tcyDiagnostic } from "./helpers.js";

const note = (body: string) => `［＃「${body}」は縦中横］`;

describe("S7-01 postfix quote only, ASCII body 1–4", () => {
  it("IIII and 12 become Nyoze brackets with no added space", () => {
    expect(convertText("IIII［＃「IIII」は縦中横］", quiet).text).toBe(
      "｟IIII｠",
    );
    expect(convertText("12［＃「12」は縦中横］", quiet).text).toBe("｟12｠");
    expect(convertText("12［＃「12」は縦中横］", quiet).text).not.toContain(
      " ",
    );
  });

  it.each([
    ["A", "letter"],
    ["z", "letter"],
    ["Z", "letter"],
    ["0", "digit"],
    ["9", "digit"],
    ["!", "bang"],
    ["?", "question"],
    ["!?A1", "four mixed"],
  ])("accepts %s (%s)", (body) => {
    expect(convertText(body + note(body), quiet).text).toBe("｟" + body + "｠");
  });

  it("a 4-character suffix leaves the preceding characters", () => {
    expect(convertText("1234［＃「34」は縦中横］", quiet).text).toBe(
      "12｟34｠",
    );
    expect(convertText("12［＃「2」は縦中横］", quiet).text).toBe("1｟2｠");
  });

  it("rejects length 0 and 5, and does not invent a body from the note", () => {
    for (const input of [
      note(""),
      "ABCDE" + note("ABCDE"),
      "ABCD" + note("ABCDE"),
      note("12"),
    ]) {
      const r = convertText(input, quiet);
      expect(r.text, input).toBe(input);
      expect(r.stats.tcy.converted, input).toBe(0);
      expect(r.stats.tcy.unconverted, input).toBe(1);
    }
    expect(convertText(note(""), quiet).diagnostics[0]).toEqual(
      tcyDiagnostic(note(""), note(""), "empty", ""),
    );
    const five = "ABCDE" + note("ABCDE");
    expect(convertText(five, quiet).diagnostics[0]).toEqual(
      tcyDiagnostic(five, note("ABCDE"), "invalid-body", "ABCDE"),
    );
    const only = note("12");
    expect(convertText(only, quiet).diagnostics[0]).toEqual(
      tcyDiagnostic(only, only, "target-mismatch", "12"),
    );
  });

  it.each([
    ["あ", "hiragana"],
    ["漢字", "kanji"],
    ["１２", "fullwidth digits"],
    ["Ａ", "fullwidth letter"],
    ["Ⅳ", "roman numeral"],
    ["1 2", "space"],
    ["12 ", "trailing space"],
    ["😀", "emoji"],
    ["!? ", "space after mark"],
  ])("does not normalize %s (%s)", (body) => {
    const input = body + note(body);
    const r = convertText(input, quiet);
    expect(r.text).toBe(input);
    expect(r.stats.tcy).toEqual({ converted: 0, unconverted: 1 });
    expect(r.diagnostics[0]).toEqual(
      tcyDiagnostic(input, note(body), "invalid-body", body),
    );
  });

  it("a fullwidth quote does not match a preceding ASCII body", () => {
    const input = "12［＃「１２」は縦中横］";
    const r = convertText(input, quiet);
    expect(r.text).toBe(input);
    expect(r.diagnostics[0]?.details).toEqual({
      reason: "invalid-body",
      quoted: "１２",
    });
  });

  it("mismatch, distance, line start and a non-suffix do not convert", () => {
    for (const input of [
      "12［＃「AB」は縦中横］",
      "12 と［＃「12」は縦中横］",
      "12［＃「1」は縦中横］",
      "［＃「A」は縦中横］",
    ]) {
      const r = convertText(input, quiet);
      expect(r.text, input).toBe(input);
      expect(r.stats.tcy, input).toEqual({ converted: 0, unconverted: 1 });
      expect(r.diagnostics[0]?.details.reason, input).toBe("target-mismatch");
    }
  });

  it("does not match across LF or CR", () => {
    for (const input of [
      "12\n［＃「12」は縦中横］",
      "12\r［＃「12」は縦中横］",
    ]) {
      const r = convertText(input, quiet);
      expect(r.text).toBe(input);
      expect(r.diagnostics[0]?.details.reason).toBe("target-mismatch");
    }
  });

  it("keeps CR in CRLF and converts each same-line note", () => {
    expect(
      convertText("12［＃「12」は縦中横］\r\nA［＃「A」は縦中横］", quiet).text,
    ).toBe("｟12｠\r\n｟A｠");
  });

  it("converts a run and an adjacent pair once each", () => {
    expect(
      convertText("12［＃「12」は縦中横］34［＃「34」は縦中横］", quiet).text,
    ).toBe("｟12｠｟34｠");
    const twice = "12［＃「12」は縦中横］［＃「12」は縦中横］";
    const r = convertText(twice, quiet);
    expect(r.text).toBe("｟12｠［＃「12」は縦中横］");
    expect(r.stats.tcy).toEqual({ converted: 1, unconverted: 1 });
    expect(
      r.diagnostics.filter((d) => d.code === "TCY_NOT_CONVERTED"),
    ).toHaveLength(1);
  });

  it("records the note in original UTF-16 units after a supplementary character", () => {
    const failure = "［＃「Ⅳ」は縦中横］";
    const input = "\u{2000B}Ⅳ" + failure;
    expect(input.charCodeAt(0)).toBe(0xd840);
    expect(input.charCodeAt(1)).toBe(0xdc0b);
    expect(input.indexOf(failure)).toBe(3);
    const failed = convertText(input, quiet);
    expect(failed.text).toBe(input);
    expect(failed.diagnostics[0]).toEqual(
      tcyDiagnostic(input, failure, "invalid-body", "Ⅳ"),
    );
    expect(failed.diagnostics[0]?.range).toEqual({
      startUtf16: 3,
      endUtf16: 3 + failure.length,
    });
    const ok = "\u{2000B}12［＃「12」は縦中横］";
    expect(convertText(ok, quiet).text).toBe("\u{2000B}｟12｠");
  });

  it("tracks the base and the original note, and does not emit a private-use marker", () => {
    const input = "IIII［＃「IIII」は縦中横］";
    const r = convertTcy(input);
    expect(r.text).toBe("｟IIII｠");
    expect(r.text).not.toMatch(/[\uE000-\uF8FF\u{F0000}-\u{FFFFD}]/u);
    expect(r.stats).toEqual({ converted: 1, unconverted: 0 });
    expect(r.regions).toEqual([
      {
        startUtf16: 0,
        endUtf16: "｟IIII｠".length,
        text: "｟IIII｠",
        kind: "generated-markup",
        baseText: "IIII",
        sourceOccurrenceId: `source:0:${input.length}`,
      },
    ]);
  });

  it("leaves block and range notes to the residual scan and does not count them", () => {
    const input =
      "［＃縦中横］\n［＃ここから縦中横］\n12\n［＃ここで縦中横終わり］\n［＃「12」は縦中横終わり］\n";
    const r = convertText(input, quiet);
    expect(r.text).toBe(input);
    expect(r.stats.tcy).toEqual({ converted: 0, unconverted: 0 });
    expect(r.diagnostics.some((d) => d.code === "TCY_NOT_CONVERTED")).toBe(
      false,
    );
    expect(r.remainingNotes.map((n) => n.text)).toEqual([
      "［＃縦中横］",
      "［＃ここから縦中横］",
      "［＃ここで縦中横終わり］",
      "［＃「12」は縦中横終わり］",
    ]);
    expect(r.stats.remainingNotes).toBe(4);
  });
});
