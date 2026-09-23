/**
 * aozora-ts-v3 view of the old pipeline fixtures, shared by Vitest and the
 * Node/Chrome/Worker smoke. Pure functions over already loaded JSON:
 * v2 golden -> schema projection -> ledger overlay. Nothing is computed from
 * the converter under test.
 */
const parts = (pointer) =>
  pointer
    .slice(1)
    .split("/")
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
function put(doc, pointer, value) {
  const path = parts(pointer),
    last = path.pop();
  for (const p of path) doc = doc[p];
  if (!Array.isArray(doc) && !(last in doc))
    throw new Error("overlay may not add " + pointer);
  doc[last] = value;
}
const clone = (value) => JSON.parse(JSON.stringify(value));

/** Drop schema-only stats fields before diffing against the Python reference. */
export function withoutAddedStats(stats, projection) {
  const copy = clone(stats);
  for (const field of Object.keys(projection.addedStats?.fields ?? {}))
    delete copy[field];
  return copy;
}

/** Schema stats sit after gaiji, matching `zeroStats` key order. */
function withAddedStats(stats, fields) {
  const pending = { ...fields };
  const next = {};
  for (const [key, value] of Object.entries(stats)) {
    next[key] = value;
    if (key !== "gaiji") continue;
    for (const [field, added] of Object.entries(pending)) {
      if (field in stats) throw new Error("v2 stats already had " + field);
      next[field] = clone(added);
      delete pending[field];
    }
  }
  for (const [field, added] of Object.entries(pending)) {
    if (field in stats) throw new Error("v2 stats already had " + field);
    next[field] = clone(added);
  }
  return next;
}

/** Expected {core, policy, changedCorePaths} for one ledger pipeline case. */
export function expectedV3(v2Case, ledgerCase, projection) {
  const core = clone(v2Case.core);
  for (const field of projection.removedResultFields) delete core[field];
  core.stats = withAddedStats(core.stats, projection.addedStats?.fields ?? {});
  const expected = {
    core,
    policy: clone(v2Case.policy),
    changedCorePaths: clone(v2Case.changedCorePaths),
  };
  for (const change of ledgerCase.changes)
    put(expected, change.path, clone(change.new));
  return expected;
}

/**
 * Every old pipeline case under the new API: input, content options,
 * outputExtension and the v3 expectation. `newCases` reuse a base case.
 */
export function pipelineCasesV3(originals, v2, ledger) {
  const golden = new Map(v2.map((c) => [c.caseKey, c]));
  const byKey = new Map(ledger.pipelineCases.map((c) => [c.caseKey, c]));
  const cases = originals.map((original) => {
    const caseKey = "pipeline:" + original.id,
      entry = byKey.get(caseKey);
    if (!entry) throw new Error("ledger misses " + caseKey);
    return {
      id: original.id,
      caseKey,
      base: caseKey,
      input: original.input,
      inputName: original.filename,
      organizeByAuthor: entry.organizeByAuthor,
      writeError: original.writeError === true,
      conversion: clone(entry.newOptions.conversion),
      outputExtension: entry.newOptions.outputExtension,
      expected: expectedV3(golden.get(caseKey), entry, ledger.schemaProjection),
    };
  });
  const base = new Map(cases.map((c) => [c.caseKey, c]));
  for (const extra of ledger.newCases) {
    const from = base.get(extra.base);
    const expected = clone(from.expected);
    for (const [pointer, value] of Object.entries(extra.policy))
      put(expected.policy, pointer, value);
    cases.push({
      ...clone(from),
      id: extra.caseKey,
      caseKey: extra.caseKey,
      outputExtension: extra.outputExtension,
      expected,
    });
  }
  return cases;
}
