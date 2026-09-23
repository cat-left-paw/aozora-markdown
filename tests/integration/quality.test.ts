import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  convertText,
  convertGaiji,
  convertEmphasis,
  convertHeadings,
  DEFAULT_OPTIONS,
} from "../../src/index.js";
import manifest from "../../design/fixtures/manifest.json";
import lock from "../../design/python-oracle-lock.json";
import plan from "../../design/compatibility-plan.json";
import side from "../../design/improvement-fixtures.json";
import units from "../../design/fixtures/unit-fixtures.json";
import pipelines from "../../design/fixtures/pipeline-fixtures.json";
import encoding from "../../design/fixtures/encoding-fixtures.json";
import v3 from "../../design/compatibility-v3.json";
import { changedPaths } from "../reference/unitAdapter.js";
it("immutable source, oracle scripts and all eight old evidence hashes", () => {
  const sha = (path: string) =>
    createHash("sha256").update(readFileSync(path)).digest("hex");
  expect(sha("aozora_zip_batch_gui.py")).toBe(lock.sourceSha256);
  expect(sha("design/reference_oracle.py")).toBe(
    "d4732f80b5538b280c67d4a4deb83f93c88197fac8465cddf88d85637bacf5fe",
  );
  expect(sha("design/reference_io_probes.py")).toBe(
    "937c5dcee4fafbbef4ea902596c592c2a8687c7ffc127bc7923187e1fa56daa1",
  );
  for (const [file, hash] of Object.entries(lock.files))
    expect(sha("design/fixtures/" + file)).toBe(hash);
});
it("complete classification; zero pending; exact decision reasons and changed paths", () => {
  expect(plan.cases).toHaveLength(344);
  expect(plan.cases.filter((x) => x.status === "needs-expectation")).toEqual(
    [],
  );
  expect(plan.cases.filter((x) => x.status === "not-in-slice")).toHaveLength(7);
  const originals = new Map<string, unknown>([
    ...units.map((c) => ["unit:" + c.id, c.expected] as const),
    ...pipelines.map((c) => ["pipeline:" + c.id, c.expected] as const),
    ...encoding.map((c) => ["encoding:" + c.id, c.expected] as const),
  ]);
  for (const entry of side.cases) {
    const p = plan.cases.find((p) => p.caseKey === entry.caseKey)!;
    expect(p.status).toBe("expected-defined");
    expect(entry.decisionSet).toBe("aozora-ts-v2");
    expect(entry.reasons).toEqual(p.reasons);
    expect(
      changedPaths(originals.get(entry.caseKey), entry.expected).sort(),
    ).toEqual([...entry.changedPaths].sort());
  }
});
it("18 v2 core defaults match the pinned manifest plus S6 defaults and convertTcy", () => {
  // aozora-ts-v3 quality-defaults: rename_to_md moved to the adapter
  // (outputExtension). S6 adds convertGaiji/convertBouten/convertHeadings/headingLevels.
  // S7 adds convertTcy (TCY_OPTION_AND_STATS).
  const { optionNames, adapterOnly } = v3.schemaProjection;
  const core = Object.entries(manifest.optionsDefaults).filter(
    ([key]) => !adapterOnly.includes(key),
  );
  expect(core).toHaveLength(18);
  for (const [key, value] of core)
    expect(
      DEFAULT_OPTIONS[
        optionNames[
          key as keyof typeof optionNames
        ] as keyof typeof DEFAULT_OPTIONS
      ],
    ).toBe(value);
  expect(Object.keys(DEFAULT_OPTIONS).sort()).toEqual(
    [
      ...core.map(([key]) => optionNames[key as keyof typeof optionNames]),
      "convertGaiji",
      "convertBouten",
      "convertHeadings",
      "headingLevels",
      "convertTcy",
    ].sort(),
  );
  expect(DEFAULT_OPTIONS).toMatchObject({
    convertGaiji: true,
    convertTcy: true,
    convertBouten: true,
    convertHeadings: true,
    headingLevels: { large: 2, medium: 3, small: 4 },
  });
  expect("convertUtf8" in DEFAULT_OPTIONS).toBe(false);
  expect(DEFAULT_OPTIONS.preserveIndentNotes).toBe(false);
  const result = convertText("［＃２字下げ］本文", {
    addFrontmatter: false,
    convertNyozeIndent: false,
    preserveIndentNotes: true,
  });
  expect(result.stats.indent.converted).toBe(0);
  expect(result.remainingNotes).toHaveLength(1);
  expect(convertText("x", {})).toEqual(convertText("x"));
  expect(() => convertText("x", { sourceFormat: "txt" } as never)).toThrow(
    "sourceFormat was removed",
  );
});
it("large approximate inputs and callback literal replacement do not lose content", () => {
  const input = "※［＃U+0024］".repeat(5000);
  const result = convertGaiji(input);
  expect(result.text).toBe("$".repeat(5000));
  expect(result.stats.converted).toBe(5000);
  const near = "［＃太字］" + "x".repeat(200000) + "［＃太字終わ";
  expect(convertEmphasis(near).text).toBe(near);
  const quotes = "$&$`$'\\".repeat(500);
  expect(
    convertEmphasis(quotes + `［＃「${quotes}」は太字］`, "text").text,
  ).toBe(`**${quotes}**`);
  const heading =
    "［＃ここから大見出し］" +
    "章".repeat(100000) +
    "［＃ここで中見出し終わり］";
  expect(convertHeadings(heading).text).toBe(heading);
});
it("source UTF16 diagnostic after supplementary gaiji replacement tracks original annotation", () => {
  const prefix = "※［＃U+20000］";
  const note = "［＃「違う」は大見出し］";
  const result = convertText(prefix + note, {
    addFrontmatter: false,
    removeAnnotationBlocks: false,
    removeAozoraFooter: false,
  });
  expect(result.diagnostics[0].range).toEqual({
    startUtf16: prefix.length,
    endUtf16: prefix.length + note.length,
  });
  expect(result.remainingNotes).toEqual([{ line: 1, text: note }]);
});
