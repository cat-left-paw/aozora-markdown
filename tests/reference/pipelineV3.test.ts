import { it, expect } from "vitest";
import originals from "../../design/fixtures/pipeline-fixtures.json";
import v2 from "../fixtures/pipeline-v2.json";
import ledger from "../../design/compatibility-v3.json";
import { convertText } from "../../src/index.js";
import { prepareImport } from "../../src/import/index.js";
import { initialJobStats, reduceJobStats } from "../../src/policies/index.js";
import { changedPaths } from "./unitAdapter.js";
import { pipelineCasesV3, withoutAddedStats } from "./v3Overlay.mjs";

const cases = pipelineCasesV3(originals, v2, ledger);
it("ledger lists every old case and the four S6 naming/frontmatter cases", () => {
  expect(cases).toHaveLength(originals.length + ledger.newCases.length);
  expect(ledger.pipelineCases.filter((c) => c.changes.length)).toHaveLength(2);
});
for (const c of cases)
  it(`v3 pipeline ${c.caseKey} (.${c.outputExtension})`, async () => {
    const result = convertText(c.input, c.conversion);
    // Full-object equality: any path not approved by the ledger fails.
    expect(result).toEqual(c.expected.core);
    expect(result).not.toHaveProperty("isMarkdownOutput");
    const reference = v2.find((x) => x.caseKey === c.base)!.referenceProjection;
    expect(
      changedPaths(reference, {
        text: result.text,
        stats: withoutAddedStats(result.stats, ledger.schemaProjection),
      }),
    ).toEqual(c.expected.changedCorePaths);
    expect(result.stats.tcy).toEqual({ converted: 0, unconverted: 0 });
    const imported = await prepareImport(
      [
        {
          id: c.id,
          name: c.inputName,
          kind: c.inputName.endsWith(".md") ? "md" : "txt",
          bytes: new TextEncoder().encode(c.input),
        },
      ],
      {
        conversion: c.conversion,
        outputExtension: c.outputExtension,
        organizeByAuthor: c.organizeByAuthor,
      },
    );
    expect(imported.status).toBe("completed");
    expect(imported.metrics.conversions).toBe(1);
    const artifact = imported.artifacts[0];
    expect(artifact.format).toBe(c.outputExtension);
    // The adapter decodes and normalizes to LF; these inputs are already LF.
    expect(artifact.conversion).toEqual(result);
    expect(new TextDecoder().decode(artifact.bytes)).toBe(result.text);
    const job = reduceJobStats(
      initialJobStats(),
      c.writeError
        ? {
            type: "WriteFailed",
            fileId: artifact.fileId,
            attemptId: "1",
            error: "fixture write failure",
            result: artifact.conversion,
          }
        : {
            type: "WriteCommitted",
            fileId: artifact.fileId,
            attemptId: "1",
            delivery: "browser-artifact",
            result: artifact.conversion,
          },
    );
    expect({
      relativePath: artifact.relativePath,
      filesConverted: job.filesConverted,
      errors: job.errors,
      filesWithRemainingNotes: job.filesWithRemainingNotes,
      remainingNotes: job.remainingNotes,
    }).toEqual(c.expected.policy);
    if (c.writeError)
      expect(job.failedResults[0].result?.remainingNotes).toEqual(
        result.remainingNotes,
      );
  });
