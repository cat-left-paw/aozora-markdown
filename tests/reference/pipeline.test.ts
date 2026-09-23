import { it, expect } from "vitest";
import originals from "../../design/fixtures/pipeline-fixtures.json";
import expected from "../fixtures/pipeline-v2.json";
import ledger from "../../design/compatibility-v3.json";
import { changedPaths } from "./unitAdapter.js";
/**
 * The accepted v2 golden stays an audited record of its Python originals.
 * Converter output is compared in pipelineV3.test.ts (v2 + ledger overlay).
 */
for (const c of originals)
  it("v2 pipeline golden remains its Python projection:" + c.id, () => {
    const e = expected.find((x) => x.caseKey === "pipeline:" + c.id)!;
    expect(e.hostReference).toEqual(c.expected);
    expect(
      changedPaths(e.referenceProjection, {
        text: e.core.text,
        stats: e.core.stats,
      }),
    ).toEqual(e.changedCorePaths);
    const entry = ledger.pipelineCases.find((x) => x.caseKey === e.caseKey)!;
    expect(entry.newOptions.outputExtension).toBe(
      e.core.isMarkdownOutput ? "md" : "txt",
    );
  });
