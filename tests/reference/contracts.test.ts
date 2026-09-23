import { it, expect } from "vitest";
import units from "../../design/fixtures/unit-fixtures.json";
import contracts from "../fixtures/unit-contracts.json";
import { runUnit } from "./unitAdapter.js";
it("all 307 new diagnostic codes/details/source UTF16 ranges and preserved occurrence identities", () => {
  for (const c of units) {
    const e = contracts.find((x) => x.caseKey === "unit:" + c.id)!;
    const actual = runUnit(c).details;
    expect(actual?.diagnostics ?? [], c.id).toEqual(e.diagnostics);
    expect(
      actual?.regions.filter((r: any) => r.kind === "preserved-note") ?? [],
      c.id,
    ).toEqual(e.preservedRegions);
  }
});
