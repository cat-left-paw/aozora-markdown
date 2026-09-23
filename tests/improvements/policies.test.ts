import { it, expect } from "vitest";
import {
  sanitizeFilename,
  utf8Length,
  collisionKey,
  planOutputs,
  authorizeDestination,
  validateZipEntry,
  planZipEntries,
  initialJobStats,
  reduceJobStats,
  type DestinationCapabilities,
  type OutputSnapshot,
  type OutputRequest,
} from "../../src/policies/index.js";
import { convertText } from "../../src/index.js";
const paths = (
  requests: OutputRequest[],
  snapshot: OutputSnapshot = { inputs: [], existing: [] },
) => {
  const p = planOutputs(requests, snapshot);
  if (!p.ok) throw new Error(p.code);
  return p.outputs.map((o) => o.relativePath);
};
const request = (
  desiredPath: string,
  sourceId = desiredPath,
): OutputRequest => ({ desiredPath, sourceId });
const capabilities: DestinationCapabilities = {
  rootContainment: true,
  aliasInspection: true,
  exclusiveCreate: true,
  delivery: "filesystem",
};
const clear = {
  insideRoot: true,
  parentSymlink: false,
  leafExists: false,
  sourceAlias: false,
};
it("R03 all input and existing names reserved before any assignment", () => {
  const snap = {
    inputs: [{ path: "work.txt" }, { path: "work.md" }],
    existing: [{ path: "work_converted.md" }, { path: "work_converted2.md" }],
  };
  expect(
    paths(
      [
        request("work.md", "a"),
        request("work.md", "b"),
        request("work.md", "c"),
      ],
      snap,
    ),
  ).toEqual(["work_converted3.md", "work_converted4.md", "work_converted5.md"]);
  expect(
    paths([request("work_converted.md")], {
      inputs: [{ path: "work_converted.md" }],
      existing: [],
    }),
  ).toEqual(["work_converted_converted.md"]);
});
it("R03 portable aliases plus stronger host aliases; stronger key cannot weaken portable rules", () => {
  expect(paths([request("Café.md"), request("CAFÉ.md")])).toEqual([
    "Café.md",
    "CAFÉ_converted.md",
  ]);
  expect(
    paths([request("A.md"), request("a.md")], {
      inputs: [],
      existing: [],
      canonicalKey: (s) => s,
    }),
  ).toEqual(["A.md", "a_converted.md"]);
  expect(
    paths([request("STRASSE.md")], {
      inputs: [],
      existing: [{ path: "Straße.md" }],
      canonicalKey: (s) => s.toLowerCase().replace("ß", "ss"),
    }),
  ).toEqual(["STRASSE_converted.md"]);
});
it("R03 reusable directory group, occupied file parent, and file/directory collisions", () => {
  expect(
    paths([request("著者/題.md"), request("著者/別.md")], {
      inputs: [],
      existing: [{ path: "著者", kind: "file" }],
    }),
  ).toEqual(["著者_converted/題.md", "著者_converted/別.md"]);
  expect(
    paths([request("著者/題.md"), request("著者/別.md")], {
      inputs: [],
      existing: [{ path: "著者", kind: "directory" }],
    }),
  ).toEqual(["著者/題.md", "著者/別.md"]);
  expect(
    paths([request("題.md")], {
      inputs: [],
      existing: [{ path: "題.md", kind: "directory" }],
    }),
  ).toEqual(["題_converted.md"]);
});
for (const desiredPath of [
  "../x.md",
  "/x.md",
  "C:x.md",
  "a//x.md",
  "a\\..\\x.md",
  "x.verylongextension",
])
  it("R03 invalid output proposal " + desiredPath, () =>
    expect(
      planOutputs([request(desiredPath)], { inputs: [], existing: [] }).ok,
    ).toBe(false),
  );
for (const change of [
  { rootContainment: false },
  { aliasInspection: false },
  { exclusiveCreate: false },
])
  it("R04 missing capability " + JSON.stringify(change), () => {
    const result = authorizeDestination({ ...capabilities, ...change }, clear);
    expect(result).toEqual({
      ok: false,
      code:
        "exclusiveCreate" in change
          ? "EXCLUSIVE_CREATE_UNAVAILABLE"
          : "UNSAFE_DESTINATION",
    });
  });
for (const observation of [
  { insideRoot: false },
  { parentSymlink: true },
  { leafExists: true },
  { sourceAlias: true },
])
  it("R04 unsafe observed state " + JSON.stringify(observation), () =>
    expect(
      authorizeDestination(capabilities, { ...clear, ...observation }),
    ).toEqual({ ok: false, code: "UNSAFE_DESTINATION" }),
  );
class FakeStore {
  values = new Map<string, { bytes: string; identity: string }>();
  writes = 0;
  create(path: string, value: string, insertRace = false, permission = false) {
    const authority = authorizeDestination(capabilities, {
      ...clear,
      leafExists: this.values.has(path),
    });
    if (!authority.ok) return authority.code;
    if (insertRace)
      this.values.set(path, { bytes: "RACING FILE", identity: "race" });
    // This conditional insertion models one indivisible create-if-absent host operation.
    if (this.values.has(path)) return "CREATE_COLLISION";
    if (permission) return "PERMISSION_DENIED";
    this.values.set(path, { bytes: value, identity: "created:" + path });
    this.writes++;
    return "COMMITTED";
  }
}
it("R04 fake hardlink/symlink aliases and post-plan races never truncate or delete", () => {
  const store = new FakeStore();
  const source = { bytes: "SOURCE\r\n", identity: "inode:7" };
  store.values.set("work.txt", source);
  store.values.set("work.md", source);
  const [path] = paths([request("work.md")], {
    inputs: [{ path: "work.txt", canonicalIdentity: "inode:7" }],
    existing: [{ path: "work.md", canonicalIdentity: "inode:7" }],
  });
  expect(path).toBe("work_converted.md");
  expect(store.create(path, "NEW", true)).toBe("CREATE_COLLISION");
  expect(store.writes).toBe(0);
  expect(store.values.get("work.txt")?.bytes).toBe("SOURCE\r\n");
  expect(store.values.get(path)?.bytes).toBe("RACING FILE");
  expect(store.create("permission.md", "NEW", false, true)).toBe(
    "PERMISSION_DENIED",
  );
  expect(store.writes).toBe(0);
  const next = paths([request("work.md")], {
    inputs: [{ path: "work.txt" }],
    existing: [...store.values.keys()].map((path) => ({ path })),
  })[0];
  expect(next).toBe("work_converted2.md");
  expect(store.create(next, "NEW")).toBe("COMMITTED");
});
for (const name of [
  "../x.txt",
  "a\\..\\x.txt",
  "/x",
  "\\x",
  "C:x",
  "C:\\x",
  "\\\\server\\x",
  "a/../x",
  "a\x00b",
  "a\x1fb",
])
  it("R06 rejects raw unsafe path " + JSON.stringify(name), () =>
    expect(
      validateZipEntry({
        archiveId: "a",
        centralDirectoryIndex: 0,
        rawName: name,
      }).ok,
    ).toBe(false),
  );
it("R06 validates both raw and decoded names; no URL decoding; directory metadata and symlink rejection", () => {
  const base = { archiveId: "a", centralDirectoryIndex: 0 };
  expect(
    validateZipEntry({
      ...base,
      rawName: "safe.txt",
      decodedName: "../unsafe.txt",
    }).ok,
  ).toBe(false);
  expect(
    validateZipEntry({
      ...base,
      rawName: "../unsafe.txt",
      decodedName: "safe.txt",
    }).ok,
  ).toBe(false);
  const valid = validateZipEntry({
    ...base,
    rawName: "a//./b\\%2e%2e/file.txt",
  });
  expect(valid.ok && valid.entry.relativeName).toBe("a/b/%2e%2e/file.txt");
  const dir = validateZipEntry({ ...base, rawName: "a/" });
  expect(dir.ok && dir.entry.isDirectory).toBe(true);
  expect(
    validateZipEntry({ ...base, rawName: "safe.txt", isSymlink: true }).ok,
  ).toBe(false);
  expect(
    validateZipEntry({ ...base, rawName: "safe.txt", unixMode: 0xa1ff }).ok,
  ).toBe(false);
});
const archive = (archiveId: string, stem: string, names: string[]) => ({
  archiveId,
  stem,
  entries: names.map((rawName, centralDirectoryIndex) => ({
    archiveId,
    centralDirectoryIndex,
    rawName,
  })),
});
it("R05 duplicate entry identity/bytes retained, hierarchy, ignored nontext and nested ZIP", () => {
  const p = planZipEntries([
    archive("a", "archive", [
      "a/work.txt",
      "b/work.txt",
      "a/work.txt",
      "image.png",
      "nested.zip",
    ]),
  ]);
  expect(p.ok).toBe(true);
  if (!p.ok) return;
  expect(p.entries.map((e) => e.relativePath)).toEqual([
    "archive/a/work.md",
    "archive/b/work.md",
    "archive/a/work_converted.md",
  ]);
  const fakeEntryBytes = ["FIRST", "SECOND", "THIRD"];
  expect(
    p.entries.map((e) => fakeEntryBytes[e.entryId.centralDirectoryIndex]),
  ).toEqual(["FIRST", "SECOND", "THIRD"]);
  expect(p.ignored).toEqual([
    { archiveId: "a", centralDirectoryIndex: 3 },
    { archiveId: "a", centralDirectoryIndex: 4 },
  ]);
  for (const e of p.entries) expect("rawName" in e).toBe(false);
});
it("R05 wrapper and directory sanitization collisions keep stable logical groups", () => {
  const p = planZipEntries([
    archive("a", "same", ["aa:b/one.txt", "aa?b/two.txt", "aa?b/three.txt"]),
    archive("b", "same", ["work.txt"]),
  ]);
  if (!p.ok) throw new Error(p.reason);
  expect(p.entries.map((e) => e.relativePath)).toEqual([
    "same/aa_b/one.md",
    "same/aa_b_converted/two.md",
    "same/aa_b_converted/three.md",
    "same_converted/work.md",
  ]);
});
it("R05 organized entries converge through one collision policy", () => {
  const p = planZipEntries(
    [archive("a", "archive", ["a/work.txt", "b/work.txt"])],
    {
      organizeByAuthor: true,
      metadata: {
        '["a",0]': { author: "著者", title: "題" },
        '["a",1]': { author: "著者", title: "題" },
      },
    },
  );
  if (!p.ok) throw new Error(p.reason);
  expect(p.entries.map((e) => e.relativePath)).toEqual([
    "著者/題.md",
    "著者/題_converted.md",
  ]);
});
it("R06 any unsafe entry rejects entire archive before producing commands including ignored entries", () => {
  expect(
    planZipEntries([archive("a", "archive", ["safe.txt", "../image.png"])]),
  ).toEqual({
    ok: false,
    code: "UNSAFE_ZIP_ARCHIVE",
    archiveId: "a",
    reason: "parent-segment",
  });
  const a = archive("a", "archive", ["safe.txt"]);
  a.entries.push(a.entries[0]);
  expect(planZipEntries([a]).ok).toBe(false);
});
for (const [name, out] of [
  ["CON.txt", "_CON.txt"],
  ["com¹", "_com¹"],
  ["LPT².md", "_LPT².md"],
  ["conical", "conical"],
  [". .", "untitled"],
  ["　. 題 .　", "題"],
  ["a\x00b\x7f\x80", "ab"],
  ["a/b:c", "a_b_c"],
])
  it("R18 portable name " + name, () =>
    expect(sanitizeFilename(name)).toBe(out),
  );
it("R18 name byte/codepoint budget reserves suffix/ext then revalidates", () => {
  expect(sanitizeFilename("𠀀".repeat(101))).toBe("𠀀".repeat(60));
  for (const name of [
    "𠀀".repeat(100),
    "題".repeat(100),
    "a".repeat(100),
    "CON" + ".".repeat(200),
  ]) {
    const out = sanitizeFilename(name, {
      extension: "md",
      suffix: "_converted123",
    });
    expect(utf8Length(out)).toBeLessThanOrEqual(240);
    expect(Array.from(out).length).toBeLessThanOrEqual(100);
    expect(out).toMatch(/_converted123\.md$/u);
    expect(out).not.toMatch(/[\ud800-\udfff]/u);
  }
  expect(sanitizeFilename("Café")).toBe("Café");
  expect(collisionKey("Café.md")).toBe(collisionKey("CAFÉ.md"));
  expect(() =>
    sanitizeFilename("x", { extension: "overlong" as "md" }),
  ).toThrow();
});
it("R16 document diagnostics independent; fake create collision, retry, duplicate event and artifact stats", () => {
  const result = convertText("［＃不明］", {
    addFrontmatter: false,
  });
  let state = initialJobStats();
  const initial = structuredClone(state);
  const fail = {
    type: "WriteFailed",
    fileId: "a",
    attemptId: "1",
    result,
    error: "CREATE_COLLISION",
  } as const;
  state = reduceJobStats(state, fail);
  state = reduceJobStats(state, fail);
  expect(state.filesConverted).toBe(0);
  expect(state.remainingNotes).toBe(0);
  expect(state.errors).toBe(1);
  expect(state.failedResults[0].result).toEqual(result);
  expect(initialJobStats()).toEqual(initial);
  const ok = {
    type: "WriteCommitted",
    fileId: "a",
    attemptId: "2",
    result,
    delivery: "browser-artifact",
  } as const;
  state = reduceJobStats(state, ok);
  state = reduceJobStats(state, ok);
  state = reduceJobStats(state, { ...ok, attemptId: "3" });
  expect([
    state.filesConverted,
    state.filesWithRemainingNotes,
    state.remainingNotes,
    state.errors,
    state.artifactFiles,
    state.savedFiles,
  ]).toEqual([1, 1, 1, 1, 1, 0]);
  state = reduceJobStats(state, {
    type: "Skipped",
    fileId: "b",
    attemptId: "1",
  });
  state = reduceJobStats(state, {
    type: "Cancelled",
    fileId: "c",
    attemptId: "1",
  });
  state = reduceJobStats(state, {
    type: "ArchiveFailed",
    fileId: "zip",
    attemptId: "1",
    error: "unsafe",
  });
  expect([state.filesSkipped, state.cancelledFiles, state.errors]).toEqual([
    1, 1, 2,
  ]);
});
