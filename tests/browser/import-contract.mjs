// Independent expectations shared by Node and real Chrome. No oracle calls to
// convertText/planOutputs to derive expected results.
export const plain = {
  conversion: {
    addFrontmatter: false,
    removeAnnotationBlocks: false,
    removeAozoraFooter: false,
  },
};
export const integrationOptions = {
  conversion: {
    addFrontmatter: false,
    removeAozoraFooter: false,
    removeAnnotationBlocks: true,
    convertNyozeIndent: true,
    preserveIndentNotes: true,
  },
};
export const integrationText =
  "---\ntitle: 題\nauthor: 著者\nraw_header: |\n  題\n  ---\n  ［＃内］\n---\n## ||**青**||";
export function equal(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw Error(
      label +
        "\nactual " +
        JSON.stringify(actual) +
        "\nexpected " +
        JSON.stringify(expected),
    );
}
export function validateIntegration(result) {
  equal(result.status, "completed", "integration status");
  equal(
    result.artifacts.map((a) => a.relativePath),
    [
      "integration/heading.md",
      "integration/preserve.md",
      "integration/fm.md",
      "normal/same.md",
      "normal/same_converted.md",
      "normal/a/book.md",
      "normal/b/book.md",
      "solo.md",
      "again_converted.md",
    ],
    "integration paths",
  );
  equal(
    result.artifacts.map((a) => a.conversion.text),
    [
      "## ｜青《﹅》",
      "［＃２字下げ］\n:::indent-2\n青\n:::\n［＃未対応］",
      integrationText,
      "FIRST",
      "SECOND",
      "｜青《﹅》",
      "OTHER",
      "A",
      '---\ntitle: 再入力\nraw_header: " 題\\n "\n---\n本文',
    ],
    "integration bodies",
  );
  const summary = result.artifacts.map((a) => {
    const s = a.conversion.stats;
    return [
      s.gaiji.converted,
      s.emphasis.bold,
      s.underline.converted,
      s.bouten.converted,
      s.headings.converted,
      s.indent.converted,
      s.remainingNotes,
    ];
  });
  equal(
    summary,
    [
      [1, 0, 0, 1, 1, 0, 0],
      [0, 0, 0, 0, 0, 1, 1],
      [0, 1, 1, 0, 1, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 1, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [1, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
    ],
    "integration stats",
  );
  equal(
    result.artifacts.map((a) => a.conversion.diagnostics.map((d) => d.code)),
    [[], ["REMAINING_AOZORA_NOTES"], [], [], [], [], [], [], []],
    "integration diagnostics",
  );
  equal(result.diagnostics, [], "import diagnostics");
  equal(result.metrics.conversions, 9, "core once per file");
  equal(result.metrics.readersClosed, 2, "readers closed");
}
export function integrationInputs(zipBytes) {
  const enc = new TextEncoder();
  return [
    {
      id: "integration",
      name: "integration.zip",
      kind: "zip",
      bytes: zipBytes["integration.zip"],
    },
    {
      id: "normal",
      name: "normal.zip",
      kind: "zip",
      bytes: zipBytes["normal.zip"],
    },
    {
      id: "solo",
      name: "solo.txt",
      kind: "txt",
      bytes: enc.encode("※［＃U+0041］"),
    },
    {
      id: "again",
      name: "again.md",
      kind: "md",
      bytes: enc.encode('---\ntitle: 再入力\nraw_header: " 題\\n "\n---\n本文'),
    },
  ];
}
export const structuralBoundaryZips = [
  ...Array.from({ length: 5 }, (_, index) => `prefix-rebased-${index + 1}`),
  ...Array.from({ length: 5 }, (_, index) => `prefix-unadjusted-${index + 1}`),
  ...Array.from({ length: 5 }, (_, index) => `empty-prefix-${index + 1}`),
  "eocd-disk-entries-0",
  "eocd-disk-entries-2",
  "eocd-disk-entries-sentinel",
  ...["size", "offset", "both"].flatMap((mode) =>
    [0, 2].map((count) => `zip64-disk-${count}-${mode}`),
  ),
  "comment-real-ambiguity",
];
export const negativeZips = [
  "dotdot",
  "backdot",
  "drive",
  "unc",
  "absolute",
  "nul",
  "c0",
  "unsafe-ignored",
  "unsafe-directory",
  "unsafe-nested",
  "symlink",
  "unicode-decoded-unsafe",
  "unicode-raw-unsafe",
  "utf8-invalid",
  "unknown-flag",
  "encrypted",
  "unsupported",
  "split",
  "bad-crc",
  "bad-deflate",
  "header-name",
  "header-method",
  "header-zero",
  "header-flag",
  "offset",
  "overlap",
  "truncated",
  "appended",
  "prepended",
  "forged-small",
  "forged-large",
  "unicode-local-unsafe",
  "unicode-local-mismatch",
  "payload-central",
  "descriptor-bad",
  "zip64-unsafe",
  ...structuralBoundaryZips,
];
export const positiveNames = [
  ["unicode-bad-directory", "base.txt"],
  ["unicode-central-only", "題.txt"],
  ["cp437", "café.txt"],
  ["utf8-unflagged", "├⌐.txt"],
  ["utf8", "題.TXT"],
  ["unicode-valid", "題.txt"],
  ["unicode-bad-crc", "base.txt"],
  ["unicode-bad-version", "base.txt"],
  ["unicode-bad-utf8", "base.txt"],
  ["zip64", "a.txt"],
  ["descriptor", "a.txt"],
  ["prefix-rebased-0", "a.txt"],
  ["eocd-disk-entries-1", "a.txt"],
  ["zip64-end-record", "a.txt"],
  ["zip64-size-sentinel", "a.txt"],
  ["zip64-offset-sentinel", "a.txt"],
  ["zip64-both-sentinel", "a.txt"],
  ["comment-plain", "a.txt"],
  ["comment-signature-only", "a.txt"],
  ["comment-unreachable-0-0", "a.txt"],
  ["comment-unreachable-3-0", "a.txt"],
  ["comment-unreachable-0-7", "a.txt"],
];
export async function runContract(prepare, zipBytes) {
  let passed = 0;
  const integration = await prepare(
    integrationInputs(zipBytes),
    integrationOptions,
  );
  validateIntegration(integration);
  passed++;
  for (const [name, expected] of positiveNames) {
    const r = await prepare(
      [
        {
          id: name,
          name: name + ".zip",
          kind: "zip",
          bytes: zipBytes[name + ".zip"],
        },
      ],
      plain,
    );
    equal(r.status, "completed", name);
    equal(r.artifacts.length, 1, name + " selected text artifact");
    equal(r.outcomes[1].zipName.adoptedName, expected, name + " decoded");
    passed++;
  }
  for (const name of negativeZips) {
    const r = await prepare(
      [
        {
          id: name,
          name: name + ".zip",
          kind: "zip",
          bytes: zipBytes[name + ".zip"],
        },
      ],
      plain,
    );
    equal(r.status, "failed", name);
    equal(r.artifacts, [], name + " no publish");
    if (structuralBoundaryZips.includes(name))
      equal(r.metrics.payloadReads, 0, name + " rejected before payload");
    passed++;
  }
  const chunk = await prepare(
    [
      {
        id: "chunk",
        name: "chunk.zip",
        kind: "zip",
        bytes: zipBytes["chunk.zip"],
      },
    ],
    { ...plain, limits: { expandedBytes: 32 } },
  );
  equal(chunk.status, "failed", "quota status");
  equal(chunk.metrics.rejectedChunks, 1, "quota rejected chunk");
  equal(chunk.metrics.retainedExpandedBytes, 0, "quota not retained");
  passed++;
  return { passed, integration };
}
