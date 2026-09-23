import {
  convertText,
  createFrontmatter,
  readFrontmatter,
} from "../../dist/index.js";
import { decodeTextBytes } from "../../dist/encoding/index.js";
import { runReviewRegressions } from "./review-contract.mjs";
import {
  planZipEntries,
  authorizeDestination,
  initialJobStats,
  reduceJobStats,
} from "../../dist/policies/index.js";
function same(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(label + "\n" + JSON.stringify({ actual, expected }));
}
export function run(cases) {
  const ids = [];
  for (const c of cases) {
    same(convertText(c.input, c.options), c.expected, c.id);
    ids.push(c.id);
  }
  same(
    decodeTextBytes(new Uint8Array([0xe3, 0x81, 0x82, 0xe3, 0x81, 0x84])),
    { ok: true, text: "あい", encoding: "utf-8", bom: false },
    "R01-utf8",
  );
  same(
    decodeTextBytes(new Uint8Array([0x87, 0x40, 0xee, 0xe0]), {
      encoding: "cp932",
    }),
    { ok: true, text: "①髙", encoding: "cp932", bom: false },
    "R01-cp932",
  );
  const metadata = {
    title: "a: b # c",
    raw_header: "副題\n\n",
    author: "著者",
  };
  const fm = readFrontmatter(createFrontmatter(metadata));
  same(
    [fm.metadata.title, fm.metadata.raw_header, fm.metadata.author],
    [metadata.title, metadata.raw_header, metadata.author],
    "R08-yaml",
  );
  const plan = planZipEntries([
    {
      archiveId: "a",
      stem: "archive",
      entries: [0, 1].map((centralDirectoryIndex) => ({
        archiveId: "a",
        centralDirectoryIndex,
        rawName: "a/work.txt",
      })),
    },
  ]);
  same(
    plan.entries.map((e) => e.relativePath),
    ["archive/a/work.md", "archive/a/work_converted.md"],
    "R05-duplicate",
  );
  same(
    authorizeDestination(
      {
        rootContainment: true,
        aliasInspection: true,
        exclusiveCreate: false,
        delivery: "filesystem",
      },
      {
        insideRoot: true,
        parentSymlink: false,
        leafExists: false,
        sourceAlias: false,
      },
    ),
    { ok: false, code: "EXCLUSIVE_CREATE_UNAVAILABLE" },
    "R04-capability",
  );
  const result = convertText("［＃不明］", { addFrontmatter: false });
  const stats = reduceJobStats(initialJobStats(), {
    type: "WriteCommitted",
    fileId: "a",
    attemptId: "1",
    result,
    delivery: "browser-artifact",
  });
  same(
    [
      stats.filesConverted,
      stats.remainingNotes,
      stats.artifactFiles,
      stats.savedFiles,
    ],
    [1, 1, 1, 0],
    "R16-artifact",
  );
  return {
    ok: true,
    caseIds: ids,
    reviewCases: runReviewRegressions(),
    additional: [
      "R01-utf8",
      "R01-cp932",
      "R08-yaml",
      "R05-duplicate",
      "R04-capability",
      "R16-artifact",
    ],
  };
}
