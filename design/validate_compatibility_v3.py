#!/usr/bin/env python3
"""Independent check of the aozora-ts-v3 delta ledger (no TypeScript involved).

- the v2 goldens and Python originals the ledger is based on are unchanged;
- every pipeline case of the Python originals is in the ledger exactly once;
- options are the documented projection of the Python options;
- each change's old value is the v2 golden value at that JSON pointer, the new
  value differs, and changedPaths equals the structural diff after overlay;
- the schema projection removes exactly the registered result fields;
- the new changedCorePaths equal the diff against the Python referenceProjection;
- every reason is registered, nothing is needs-expectation, test files exist.
"""

from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent


def read(path: str):
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit("FAIL: " + message)


def segment(value) -> str:
    return str(value).replace("~", "~0").replace("/", "~1")


def changed_paths(before, after, path="") -> list[str]:
    if type(before) is not type(after):
        return [path]
    if isinstance(before, dict):
        if before.keys() != after.keys():
            return [path]
        return [p for k in before for p in changed_paths(before[k], after[k], path + "/" + segment(k))]
    if isinstance(before, list):
        if len(before) != len(after):
            return [path]
        return [p for i, (a, b) in enumerate(zip(before, after)) for p in changed_paths(a, b, f"{path}/{i}")]
    return [] if before == after else [path]


def parts(pointer: str) -> list[str]:
    require(pointer.startswith("/"), "pointer must start with /: " + pointer)
    return [p.replace("~1", "/").replace("~0", "~") for p in pointer[1:].split("/")]


def get(doc, pointer: str):
    for p in parts(pointer):
        doc = doc[int(p)] if isinstance(doc, list) else doc[p]
    return doc


def put(doc, pointer: str, value) -> None:
    *head, last = parts(pointer)
    for p in head:
        doc = doc[int(p)] if isinstance(doc, list) else doc[p]
    if isinstance(doc, list):
        doc[int(last)] = value
    else:
        require(last in doc, "overlay may not add a key: " + pointer)
        doc[last] = value


def main() -> None:
    ledger = read("design/compatibility-v3.json")
    require(ledger["decisionSet"] == "aozora-ts-v3", "decisionSet")
    require(ledger["baseDecisionSet"] == "aozora-ts-v2", "baseDecisionSet")
    for path, digest in ledger["baseGoldens"].items():
        actual = hashlib.sha256((ROOT / path).read_bytes()).hexdigest()
        require(actual == digest, "base golden changed: " + path)
    lock = read("design/python-oracle-lock.json")
    for name, digest in lock["files"].items():
        actual = hashlib.sha256((HERE / "fixtures" / name).read_bytes()).hexdigest()
        require(actual == digest, "old oracle changed: " + name)
    source = hashlib.sha256((ROOT / "aozora_zip_batch_gui.py").read_bytes()).hexdigest()
    require(source == lock["sourceSha256"], "Python original changed")

    reasons = ledger["reasons"]
    projection = ledger["schemaProjection"]
    require(projection["reason"] in reasons, "schema reason")
    names = projection["optionNames"]
    adapter = set(projection["adapterOnly"])
    require("rename_to_md" in adapter, "rename_to_md must be adapter-only")

    originals = {c["id"]: c for c in read("design/fixtures/pipeline-fixtures.json")}
    golden = {c["caseKey"]: c for c in read("tests/fixtures/pipeline-v2.json")}
    cases = ledger["pipelineCases"]
    keys = [c["caseKey"] for c in cases]
    require(len(keys) == len(set(keys)), "duplicate ledger case")
    require(set(keys) == {"pipeline:" + i for i in originals}, "ledger must list every pipeline case")
    changed_cases = 0
    projected: dict[str, dict] = {}
    for case in cases:
        key = case["caseKey"]
        original = originals[key.split(":", 1)[1]]
        v2 = golden[key]
        require(case["status"] == "expected-defined", "needs expectation: " + key)
        require(case["baseDecisionSet"] == "aozora-ts-v2", "case base: " + key)
        md = original["filename"].endswith(".md")
        rename = original["options"]["rename_to_md"]
        conversion = {names[k]: v for k, v in original["options"].items() if k not in adapter}
        require(case["oldOptions"] == {"sourceFormat": "md" if md else "txt", "renameToMd": rename, **conversion}, "oldOptions: " + key)
        require(case["newOptions"]["conversion"] == conversion, "new conversion options: " + key)
        extension = "md" if md or rename else "txt"
        require(case["newOptions"]["outputExtension"] == extension, "outputExtension projection: " + key)
        require(v2["core"]["isMarkdownOutput"] == (extension == "md"), "projection equals old isMarkdownOutput: " + key)

        core = {k: v for k, v in v2["core"].items() if k not in projection["removedResultFields"]}
        removed = sorted(set(v2["core"]) - set(core))
        require(["/core/" + k for k in removed] == case["schemaChangedPaths"], "schema paths: " + key)
        added = projection.get("addedStats") or {"reason": "", "fields": {}}
        require(added["reason"] in reasons, "added stats reason")
        for field, value in added["fields"].items():
            require(field not in core["stats"], "v2 stats already had " + field)
            core["stats"][field] = copy.deepcopy(value)
        base = {"core": core, "policy": v2["policy"], "changedCorePaths": v2["changedCorePaths"]}
        after = copy.deepcopy(base)
        for change in case["changes"]:
            require(change["reason"] in reasons, "unregistered reason: " + change["reason"])
            require(change["reason"] in case["reasons"], "case reasons omit " + change["reason"])
            require(get(base, change["path"]) == change["old"], "old value is not the v2 golden: " + key + change["path"])
            require(change["old"] != change["new"], "no-op change: " + key + change["path"])
            require(change.get("derivation"), "missing derivation: " + key + change["path"])
            put(after, change["path"], copy.deepcopy(change["new"]))
        require(set(case["reasons"]) == {"SCHEMA_V3_API"} | {c["reason"] for c in case["changes"]}, "case reasons: " + key)
        delta = changed_paths(base, after)
        require(sorted(delta) == sorted(case["changedPaths"]), f"changedPaths disagree: {key}: {delta}")
        require(len(set(case["changedPaths"])) == len(case["changedPaths"]), "duplicate changedPath: " + key)
        reference_stats = copy.deepcopy(after["core"]["stats"])
        for field in added["fields"]:
            reference_stats.pop(field, None)
        reference_delta = changed_paths(
            v2["referenceProjection"],
            {"text": after["core"]["text"], "stats": reference_stats},
        )
        require(sorted(reference_delta) == sorted(after["changedCorePaths"]), f"changedCorePaths vs Python reference: {key}: {reference_delta}")
        if not any(c["path"] == "/core/stats/tcy" or c["path"].startswith("/core/stats/tcy/") for c in case["changes"]):
            require(
                after["core"]["stats"]["tcy"] == {"converted": 0, "unconverted": 0},
                "tcy stats are not the schema zero: " + key,
            )
        changed_cases += bool(case["changes"])
        projected[key] = after

    for case in ledger["newCases"]:
        require(case["base"] in projected, "new case base: " + case["caseKey"])
        require(case["outputExtension"] in ("md", "txt"), "new case extension")
        for reason in case["reasons"]:
            require(reason in reasons, "unregistered reason: " + reason)
        require(case["sameCoreAsBase"] is True, "new cases must state core equality")
        base_policy = projected[case["base"]]["policy"]
        for pointer, value in case["policy"].items():
            get(base_policy, pointer)
            require(pointer == "/relativePath" and value.endswith("." + case["outputExtension"]), "new case path must carry the output extension: " + case["caseKey"])
        require(case.get("derivation"), "missing derivation: " + case["caseKey"])

    for item in ledger["migratedAssertions"]:
        for reason in item["reasons"]:
            require(reason in reasons, "unregistered migration reason: " + reason)
        for file in item["file"].split(", "):
            if "*" not in file:
                require((ROOT / file).exists(), "migrated file missing: " + file)
    for reason, files in ledger["newTests"].items():
        require(reason in reasons, "unregistered test reason: " + reason)
        for file in files:
            require((ROOT / file).exists(), "new test missing: " + file)
    require(set(ledger["newTests"]) == set(reasons), "every reason needs new-test coverage")
    print(
        f"PASS: {len(cases)} pipeline cases ({changed_cases} with content deltas, "
        f"{len(cases)} schema projections), {len(ledger['newCases'])} new cases, "
        f"{len(ledger['migratedAssertions'])} migrated assertions, {len(reasons)} reasons; v2 goldens and oracles unchanged"
    )


if __name__ == "__main__":
    main()
