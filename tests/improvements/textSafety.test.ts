import { it, expect } from "vitest";
import * as c from "../../src/index.js";
import { TrackedText, copy } from "../../src/core/trackedText.js";
import { indentStage } from "../../src/core/indent.js";
import { frontmatterStage } from "../../src/core/metadata.js";
const nofm = {
  addFrontmatter: false,
  removeAozoraFooter: false,
  removeAnnotationBlocks: false,
} as const;
const diag = (
  code: string,
  stage: string,
  start: number,
  end: number,
  details = {},
) => ({
  code,
  severity: "warning",
  stage,
  range: { startUtf16: start, endUtf16: end },
  sourceOccurrenceId: `source:${start}:${end}`,
  details,
});
it("R10 generated emphasis, underline, bouten preserve heading base", () => {
  for (const [note, display] of [
    ["太字", "**章**"],
    ["斜体", "*章*"],
  ])
    expect(
      c.convertText(`章［＃「章」は${note}］［＃「章」は大見出し］`, nofm).text,
    ).toBe("## " + display);
  expect(
    c.convertText("章［＃「章」に傍線］［＃「章」は大見出し］", nofm).text,
  ).toBe("## ||章||");
  expect(
    c.convertText("章［＃「章」に傍線］［＃「章」は大見出し］", {
      ...nofm,
      underlineOutputFormat: "html",
    }).text,
  ).toBe("## <u>章</u>");
  expect(
    c.convertText(
      "𠀀が［＃「𠀀が」に傍点］［＃「𠀀が」は大見出し］",
      nofm,
    ).text,
  ).toBe("## ｜𠀀《﹅》｜か《﹅》｜゙《﹅》");
});
for (const [body, quote] of [
  ["本文", "不一致"],
  ["余分章", "章"],
  ["章余分", "章"],
  ["<u>章</u>", "章"],
  ["**章**", "章"],
  ["｜章", "｜章"],
  ["章", ""],
  ["が", "が"],
])
  it(`R10 mismatch ${body} ${quote}`, () => {
    const note = `［＃「${quote}」は大見出し］`,
      s = body + note,
      r = c.convertHeadings(s);
    expect(r.text).toBe(s);
    expect(r.stats.converted).toBe(0);
    expect(r.diagnostics[0]).toEqual(
      diag("HEADING_TARGET_MISMATCH", "headings", body.length, s.length, {
        quoted: quote,
        baseText: body === "｜章" ? "" : body,
      }),
    );
  });
it("R10 recognized ruby normal control and ambiguous ruby rejection", () => {
  expect(
    c.convertHeadings("［＃３字下げ］｜章《しょう》［＃「章」は大見出し］")
      .text,
  ).toBe("## 　　　｜章《しょう》");
  expect(c.convertHeadings("漢字《かんじ》［＃「漢字」は大見出し］").text).toBe(
    "## 漢字《かんじ》",
  );
});
for (const s of [
  "｜青［＃「青」に傍点］《あお》",
  "青［＃「青」に傍点］《あお》",
  "｜青《あお［＃「あお」に傍点］》",
  "｜未閉じ 青［＃「青」に傍点］",
  "｜［＃傍点］青［＃傍点終わり］《あお》",
])
  it("R11 outer ruby context " + s, () => {
    const r = c.convertBouten(s);
    expect(r.text).toBe(s);
    expect(r.stats).toEqual({ converted: 0, unconverted: 1 });
    expect(r.diagnostics[0].code).toBe("BOUTEN_RUBY_CONTEXT");
  });
it("R11 unrelated closed ruby is harmless; codepoint whitespace controls strict", () => {
  expect(c.convertBouten("｜昔《むかし》 青［＃「青」に傍点］").text).toBe(
    "｜昔《むかし》 ｜青《﹅》",
  );
  expect(
    c.convertBouten("𠀀　が［＃「𠀀　が」に傍点］", "😀more").text,
  ).toBe("｜𠀀《😀》　｜か《😀》｜゙《😀》");
});
it("R12 failure counts are per occurrence; no duplicated diagnostic", () => {
  const s = "別［＃「青」は太字］［＃「青」は斜体］";
  const r = c.convertEmphasis(s + "\n" + s);
  expect(r.stats.unconverted).toBe(4);
  expect(r.diagnostics).toHaveLength(4);
  expect(new Set(r.diagnostics.map((d) => d.sourceOccurrenceId)).size).toBe(4);
  expect(
    c.convertEmphasis("青［＃「青」は太字］［＃「青」は太字］").stats,
  ).toEqual({ bold: 1, italic: 0, both: 0, unconverted: 1 });
  expect(
    c.convertEmphasis("青［＃「青」は太字］［＃「青」は斜体］").diagnostics,
  ).toEqual([]);
});
const samples: [string, (s: string) => { text: string }, string, string][] = [
  ["gaiji", c.convertGaiji, "※［＃U+0041］", "A"],
  ["emphasis", c.convertEmphasis, "青［＃「青」は太字］", "**青**"],
  ["underline", c.convertUnderline, "青［＃「青」に傍線］", "||青||"],
  ["bouten", c.convertBouten, "青［＃「青」に傍点］", "｜青《﹅》"],
  ["headings", c.convertHeadings, "章［＃「章」は大見出し］", "## 章"],
  ["indent", c.convertIndent, "［＃２字下げ］青", ":::indent-2\n青\n:::"],
  ["align", c.convertAlignEnd, "［＃地付き］青", ":::align-end\n青\n:::"],
  ["page", c.convertPageBreaks, "［＃改ページ］", ":::page-break\n:::"],
];
for (const [name, fn, input, output] of samples)
  for (const fence of ["```", "~~~", "````"])
    it(`R13 ${name} same note inside/outside ${fence}`, () => {
      const protectedPart = fence + "\n" + input + "\n" + fence;
      expect(fn(protectedPart + "\n" + input).text).toBe(
        protectedPart + "\n" + output,
      );
      expect(fn("``" + input + "``\n" + input).text).toBe(
        "``" + input + "``\n" + output,
      );
    });
it("R13 maximal inline runs and fences use bounded specified grammar", () => {
  expect(c.scanRemainingNotes("``［＃内］`異長`［＃内］`` ［＃外］")).toEqual([
    { line: 1, text: "［＃外］" },
  ]);
  expect(c.scanRemainingNotes("`` ［＃孤立］")).toEqual([
    { line: 1, text: "［＃孤立］" },
  ]);
  expect(c.scanRemainingNotes("```x\n［＃内］\n```suffix\n［＃内］")).toEqual(
    [],
  );
  expect(
    c.scanRemainingNotes("````\n［＃内］\n```\n［＃内］\n`````\n［＃外］"),
  ).toEqual([{ line: 6, text: "［＃外］" }]);
  expect(c.scanRemainingNotes("`\n［＃外］\n`")).toEqual([
    { line: 2, text: "［＃外］" },
  ]);
});
it("R13 crossing annotation structures remain complete; metadata cannot consume code", () => {
  const s = "［＃太字］前`code`後［＃太字終わり］";
  expect(c.convertEmphasis(s).text).toBe(s);
  expect(c.convertBouten("［＃傍点］青`例`［＃傍点終わり］").text).toBe(
    "［＃傍点］青`例`［＃傍点終わり］",
  );
  const md = "題\n`コード`\n\n本文";
  expect(c.convertText(md).text).toBe(md);
});
it("R13 generated backtick updates protection; S6 protects fences and frontmatter for every input", () => {
  expect(c.convertText("※［＃U+0060］青［＃「青」は太字］`", nofm).text).toBe(
    "`青［＃「青」は太字］`",
  );
  // aozora-ts-v3 COMMON_PROTECTION_FOR_TEXT_INPUT: formerly "```\nA\n```"
  // and "---\ntitle: A\n---" for TXT with rename off.
  for (const input of [
    "```\n※［＃U+0041］\n```",
    "---\ntitle: ※［＃U+0041］\n---",
  ])
    expect(c.convertText(input).text).toBe(input);
});
it("R14 odd delimiter count cancels whole pass; even crossing code only preserves unsafe pair", () => {
  const odd = "前\n-----\n注\n-----\n中\n-----\n後";
  const r = c.removeAnnotationBlocks(odd);
  expect(r.text).toBe(odd);
  expect(r.diagnostics).toEqual([
    diag("UNCLOSED_ANNOTATION_BLOCK", "annotationBlocks", 18, 23),
  ]);
  const code = "-----\n```\n例\n```\n-----\n残す";
  expect(c.removeAnnotationBlocks(code + "\n-----\n消す\n-----\n終").text).toBe(
    code + "\n終",
  );
  expect(c.removeAnnotationBlocks("----\n本文\n----").text).toBe(
    "----\n本文\n----",
  );
});
for (const [date, valid] of [
  ["2000年2月29日作成", true],
  ["1900年2月29日作成", false],
  ["0004年2月29日作成", true],
  ["0000年1月1日作成", false],
  ["2026年4月31日作成", false],
  ["２０２４年２月２９日修正", true],
  ["説明2026年9月1日作成", false],
  ["> 2026年9月1日作成", false],
] as const)
  it("R14 Gregorian date " + date, () => {
    const s = "本文\n底本：資料\n青空文庫作成ファイル：\n" + date;
    const r = c.removeAozoraFooter(s);
    expect(r.stats.removed).toBe(valid);
    expect(r.text).toBe(valid ? "本文\n" : s);
  });
it("R14 footer cannot consume code or delimiter; normal strong signals strict", () => {
  for (const tail of ["\n`code`", "\n~~~\ncode\n~~~", "\n-----"]) {
    const s = "本文\n底本：資料\n入力：人\n青空文庫作成ファイル：" + tail;
    expect(c.removeAozoraFooter(s).text).toBe(s);
  }
  expect(
    c.removeAozoraFooter("本文\n底本：資料\n入力：人\n青空文庫作成ファイル：")
      .text,
  ).toBe("本文\n");
  expect(c.removeAozoraFooter("本文中の底本：例").diagnostics).toEqual([]);
  const quoted = "本文\n> 底本：資料\n> 入力：人\n> 青空文庫作成ファイル：";
  expect(c.removeAozoraFooter(quoted).text).toBe(quoted);
});
it("R15 arbitrary PUA is unchanged and cannot suppress residual occurrences", () => {
  const s = "\ue000［＃改ページ］\ue001\n\ue000文字\ue001";
  const r = c.convertText(s, nofm);
  expect(r.text).toBe(s);
  expect(r.remainingNotes).toEqual([{ line: 1, text: "［＃改ページ］" }]);
  const produced = c.convertText("※［＃U+E000］［＃不明］※［＃U+E001］", nofm);
  expect(produced.text).toBe("\ue000［＃不明］\ue001");
  expect(produced.remainingNotes).toHaveLength(1);
});
it("R15 UTF16 transfer, deletion, mutation invalidate only the actual occurrence", () => {
  const t = new TrackedText(
    "𠀀\n［＃２字下げ］本文\n［＃２字下げ］\n:::indent-2\n別\n:::",
  );
  indentStage(t, true);
  const r = t.regions.find((r) => r.kind === "preserved-note")!;
  expect(r.startUtf16).toBe(3);
  expect(r.endUtf16).toBe(10);
  expect(r.sourceOccurrenceId).toBe("source:3:10");
  t.apply([{ start: 0, end: 0, parts: ["先頭\n"] }]);
  expect(t.regions[0].startUtf16).toBe(6);
  const a = t.regions[0];
  t.apply([{ start: a.startUtf16, end: a.endUtf16, parts: [] }]);
  expect(t.regions).toEqual([]);
  expect(
    c.scanRemainingNotes(t.text, { preservedNotes: t.regions }).at(-1)?.text,
  ).toBe("［＃２字下げ］");
  const second = new TrackedText("［＃２字下げ］本文");
  indentStage(second, true);
  const note = second.regions[0];
  second.apply([
    { start: note.startUtf16 + 2, end: note.startUtf16 + 3, parts: ["3"] },
  ]);
  expect(second.regions).toEqual([]);
});
it("R15 explicit copy maintains provenance; identical fresh text never acquires it", () => {
  const t = new TrackedText("［＃２字下げ］本文");
  indentStage(t, true);
  const original = t.regions[0];
  t.apply([
    {
      start: t.text.length,
      end: t.text.length,
      parts: [
        "\n",
        copy(original.startUtf16, original.endUtf16),
        "\n",
        original.text,
      ],
    },
  ]);
  expect(t.regions.filter((r) => r.kind === "preserved-note")).toHaveLength(2);
  expect(c.scanRemainingNotes(t.text, { preservedNotes: t.regions })).toEqual([
    { line: 6, text: original.text },
  ]);
});
it("R15 metadata move keeps exact payload; YAML escaping invalidates the moved occurrence", () => {
  for (const suffix of ["正文", "a: b"]) {
    const t = new TrackedText(`［＃２字下げ］${suffix}\n\n本文`);
    indentStage(t, true);
    frontmatterStage(t, { addFrontmatter: true, addHeaderToBody: false });
    for (const r of t.regions)
      expect(t.text.slice(r.startUtf16, r.endUtf16)).toBe(r.text);
  }
  const t = new TrackedText("［＃２字下げ］\n\n本文");
  t.regions = [
    {
      kind: "preserved-note",
      startUtf16: 0,
      endUtf16: 7,
      text: "［＃２字下げ］",
      sourceOccurrenceId: "source:0:7",
    },
  ];
  frontmatterStage(t, { addFrontmatter: true, addHeaderToBody: false });
  expect(t.regions[0].startUtf16).toBe(11);
  expect(t.regions[0].text).toBe("［＃２字下げ］");
  const escaped = new TrackedText("［＃２字下げ］: 値\n\n本文");
  escaped.regions = [{ ...t.regions[0], startUtf16: 0, endUtf16: 7 }];
  frontmatterStage(escaped, { addFrontmatter: true, addHeaderToBody: false });
  expect(escaped.regions).toEqual([]);
});
it("R17 generated indent suppresses subsequent align/page and retains residual warnings", () => {
  const r = c.convertText(
    "［＃ここから２字下げ］\n［＃地付き］署名\n［＃改ページ］\n［＃ここで字下げ終わり］",
    {
      ...nofm,
      convertNyozeIndent: true,
      convertNyozeAlignEnd: true,
      convertNyozePageBreak: true,
    },
  );
  expect(r.stats.indent.converted).toBe(1);
  expect(r.stats.align.converted).toBe(0);
  expect(r.stats.pageBreak.pageBreaks).toBe(0);
  expect(r.remainingNotes).toEqual([
    { line: 2, text: "［＃地付き］" },
    { line: 3, text: "［＃改ページ］" },
  ]);
});
it("deterministic reentrant calls, source/options unchanged, counts survive deletion", () => {
  const options = Object.freeze({ ...nofm, removeAozoraFooter: true });
  const text =
    "本文\n底本：資料\n入力：人\n※［＃U+0041］\n青空文庫作成ファイル：";
  const a = c.convertText(text, options);
  expect(a.text).toBe("本文\n");
  expect(a.stats.gaiji.converted).toBe(1);
  c.convertText("［＃３字下げ］本文", {
    ...nofm,
    convertNyozeIndent: true,
    preserveIndentNotes: true,
  });
  expect(c.convertText(text, options)).toEqual(a);
});

it("R15-preserve-jiage and spread/page preserve exact note regions without markers", () => {
  const input = "［＃ここから地から３字上げ］\n署名\n［＃ここで字上げ終わり］";
  const aligned = c.convertAlignEnd(input, {
    approximateJiage: true,
    preserveNotes: true,
  });
  expect(aligned.text).toBe(
    "［＃ここから地から３字上げ］\n:::align-end\n署名\n:::\n［＃ここで字上げ終わり］",
  );
  expect(aligned.stats).toEqual({
    converted: 0,
    approximated: 1,
    unconverted: 0,
  });
  expect(
    c.scanRemainingNotes(aligned.text, { preservedNotes: aligned.regions }),
  ).toEqual([]);
  const paged = c.convertPageBreaks("［＃改ページ］\n本文\n［＃改丁］", {
    preserveNotes: true,
    approximateSpreadBreaks: true,
  });
  expect(paged.text).toBe(
    "［＃改ページ］\n:::page-break\n:::\n本文\n［＃改丁］\n:::page-break\n:::",
  );
  expect(
    paged.regions
      .filter((r) => r.kind === "preserved-note")
      .map((r) => r.sourceOccurrenceId),
  ).toEqual(["source:0:7", "source:11:16"]);
  expect(
    c.scanRemainingNotes(paged.text, { preservedNotes: paged.regions }),
  ).toEqual([]);
});
it("R13 active indent and align close immediately before a tilde fence", () => {
  expect(
    c.convertIndent("［＃ここから２字下げ］\n甲\n~~~\n乙\n~~~\n丙").text,
  ).toBe(":::indent-2\n甲\n:::\n~~~\n乙\n~~~\n丙");
  expect(
    c.convertAlignEnd("［＃ここから地付き］\n甲\n~~~\n乙\n~~~\n丙").text,
  ).toBe(":::align-end\n甲\n:::\n~~~\n乙\n~~~\n丙");
});
