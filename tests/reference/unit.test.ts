import { describe, it, expect } from "vitest";
import units from "../../design/fixtures/unit-fixtures.json";
import plan from "../../design/compatibility-plan.json";
import side from "../../design/improvement-fixtures.json";
import jis from "../../design/fixtures/jis-oracle.json";
import warning from "../../design/fixtures/warning-format-fixture.json";
import {
  jis0213ToUnicode,
  formatRemainingNoteLogLines,
} from "../../src/index.js";
import { runUnit, changedPaths } from "./unitAdapter.js";
const policies = new Map(plan.cases.map((p) => [p.caseKey, p]));
const expectations = new Map(side.cases.map((p) => [p.caseKey, p]));
for (const mode of ["strict", "intentional-deviation"])
  describe(mode, () => {
    for (const c of units) {
      const p = policies.get("unit:" + c.id)!;
      if (p.compatibility !== mode) continue;
      it(c.id, () => {
        expect(p.status).not.toBe("needs-expectation");
        const side: any = expectations.get(p.caseKey);
        const expected = side?.expected ?? c.expected;
        const actual = runUnit(c);
        expect(actual.projection).toEqual(expected);
        if (side) {
          expect(side.decisionSet).toBe("aozora-ts-v2");
          expect(changedPaths(c.expected, expected).sort()).toEqual(
            [...side.changedPaths].sort(),
          );
          expect(actual.projection).not.toEqual(c.expected);
          if (side.newContract?.preservedRegions)
            expect(
              actual.details.regions
                .filter((r: any) => r.kind === "preserved-note")
                .map(({ sourceOccurrenceId, ...r }: any) => r),
            ).toEqual(side.newContract.preservedRegions);
          if (side.newContract?.diagnosticCodes)
            expect(actual.details.diagnostics.map((d: any) => d.code)).toEqual(
              side.newContract.diagnosticCodes,
            );
        }
      });
    }
  });
describe("JIS strict exhaustive", () => {
  for (let i = 0; i < 17672; i++)
    it(`JIS-${i}`, () =>
      expect(
        jis0213ToUnicode(
          Math.floor(i / 8836) + 1,
          Math.floor((i % 8836) / 94) + 1,
          (i % 94) + 1,
        ),
      ).toBe(jis.values[i]));
});
it("warning format strict: 3 occurrences / 50 kinds / first order", () =>
  expect(formatRemainingNoteLogLines(warning.filename, warning.notes)).toEqual(
    warning.expected,
  ));
it("warning format strict empty and short groups", () => {
  expect(formatRemainingNoteLogLines("work.md", [])).toEqual([]);
  expect(
    formatRemainingNoteLogLines("work.md", [
      { line: 1, text: "［＃注］" },
      { line: 1, text: "［＃注］" },
    ]),
  ).toEqual([
    "[WARN] 未変換の青空文庫注記: 2件 — work.md",
    "    2件  ［＃注］  (行 1, 1)",
  ]);
});
