#!/usr/bin/env python3
"""Validate design evidence and sidecars; does not implement any converter.

This is a design-stage check, not a TypeScript acceptance test. Pending exact
expectations are reported, never counted as passing implementation tests.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import unquote, urlsplit


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DECISION_SET = "aozora-ts-v2"
SUITES = {
    "unit-fixtures.json": ("unit", 307),
    "pipeline-fixtures.json": ("pipeline", 20),
    "encoding-fixtures.json": ("encoding", 10),
    "io-probes.json": ("io", 7),
}


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def require(condition: bool, message: str):
    if not condition:
        raise ValueError(message)


def pointer_segment(value) -> str:
    return str(value).replace("~", "~0").replace("/", "~1")


def changed_paths(before, after, path="") -> list[str]:
    """Structural JSON-pointer differences, including a root schema change."""
    if type(before) is not type(after):
        return [path]
    if isinstance(before, dict):
        if before.keys() != after.keys():
            return [path]
        return [
            item
            for key in before
            for item in changed_paths(
                before[key], after[key], path + "/" + pointer_segment(key)
            )
        ]
    if isinstance(before, list):
        if len(before) != len(after):
            return [path]
        return [
            item
            for index, (old, new) in enumerate(zip(before, after))
            for item in changed_paths(old, new, path + "/" + str(index))
        ]
    return [] if before == after else [path]


def main():
    lock = read_json(HERE / "python-oracle-lock.json")
    source = ROOT / "aozora_zip_batch_gui.py"
    require(
        hashlib.sha256(source.read_bytes()).hexdigest() == lock["sourceSha256"],
        "Reference source hash changed",
    )
    require(len(lock["files"]) == 8, "Expected eight locked Python evidence JSONs")
    for name, digest in lock["files"].items():
        actual = hashlib.sha256((HERE / "fixtures" / name).read_bytes()).hexdigest()
        require(actual == digest, f"Original oracle changed: {name}")

    plan = read_json(HERE / "compatibility-plan.json")
    improvements = read_json(HERE / "improvement-fixtures.json")
    require(plan["decisionSet"] == DECISION_SET, "Unexpected decision set")
    require(improvements["decisionSet"] == DECISION_SET, "Sidecar decision set differs")
    decisions = plan["decisions"]
    require(set(decisions) == {f"R{i:02}" for i in range(1, 19)}, "R01-R18 missing")
    classifications = Counter(d["classification"] for d in decisions.values())
    require(
        classifications == {"KEEP": 2, "FIX NOW": 15, "DEFER": 1},
        "Decision classification changed without updating the specification",
    )
    require(decisions["R02"]["classification"] == "KEEP", "R02 must be KEEP")
    require(decisions["R17"]["classification"] == "KEEP", "R17 must be KEEP")
    require(decisions["R07"]["classification"] == "DEFER", "R07 must be DEFER")
    decision_text = (HERE / "improvement-decisions.md").read_text(encoding="utf-8")
    for number, decision in decisions.items():
        require(
            f"| {number} | {decision['classification']} |" in decision_text,
            f"Decision table disagrees: {number}",
        )
        if decision["classification"] == "FIX NOW":
            require(
                f"### {number} — `{decision['reason']}`" in decision_text,
                f"Missing normative reason: {number}",
            )
            section = decision_text.split(f"### {number} —", 1)[1].split("\n### ", 1)[0]
            for field in range(1, 9):
                require(
                    re.search(rf"^{field}\. \*\*", section, re.M) is not None,
                    f"Missing eight-field requirement {field}: {number}",
                )

    originals = {}
    for suite, (prefix, count) in SUITES.items():
        cases = read_json(HERE / "fixtures" / suite)
        require(len(cases) == count, f"Wrong original suite size: {suite}")
        for case in cases:
            key = prefix + ":" + case["id"]
            require(key not in originals, f"Duplicate original case: {key}")
            originals[key] = (suite, case)
    policies = {}
    valid_statuses = {
        "reference-ready", "expected-defined", "needs-expectation", "not-in-slice"
    }
    for policy in plan["cases"]:
        key = policy["caseKey"]
        require(key in originals and key not in policies, f"Invalid/duplicate policy: {key}")
        suite, case = originals[key]
        require(policy["reference"] == {"suite": suite, "id": case["id"]}, key)
        require(policy["status"] in valid_statuses, f"Invalid status: {key}")
        require(policy["compatibility"] in {"strict", "intentional-deviation"}, key)
        reasons = []
        for number in policy["decisions"]:
            require(number in decisions, f"Unknown decision: {key}/{number}")
            if decisions[number]["classification"] == "FIX NOW":
                reasons.append(decisions[number]["reason"])
        require(policy["reasons"] == reasons, f"Policy reason mismatch: {key}")
        if policy["status"] == "not-in-slice":
            require(policy["scope"] == "host-integration", f"Only host evidence may be deferred: {key}")
        if policy["status"] == "reference-ready":
            require(policy["compatibility"] == "strict", f"Strict evidence required: {key}")
        policies[key] = policy
    require(set(policies) == set(originals), "Original cases missing from policy plan")

    defined = set()
    for item in improvements["cases"]:
        key = item["caseKey"]
        require(key in policies and key not in defined, f"Invalid/duplicate improvement: {key}")
        policy = policies[key]
        require(policy["status"] == "expected-defined", f"Unregistered expectation: {key}")
        require(item["compatibility"] == "intentional-deviation", key)
        require(item["decisionSet"] == DECISION_SET, key)
        for field in ["reference", "decisions", "reasons"]:
            require(item[field] == policy[field], f"Policy/expectation mismatch: {key}/{field}")
        require(bool(item["decisions"]), f"No decision justifies expectation: {key}")
        for number in item["decisions"]:
            require(decisions[number]["classification"] == "FIX NOW", key)
        original_expected = originals[key][1]["expected"]
        delta = changed_paths(original_expected, item["expected"])
        require(
            len(set(item["changedPaths"])) == len(item["changedPaths"])
            and sorted(delta) == sorted(item["changedPaths"]),
            f"Changed fields disagree: {key}: {delta}",
        )
        require(bool(delta), f"Deviation has no changed original fields: {key}")
        defined.add(key)
    require(
        defined == {k for k, p in policies.items() if p["status"] == "expected-defined"},
        "Missing exact improvement expectation",
    )

    jis = read_json(HERE / "fixtures" / "jis-oracle.json")
    require(len(jis["values"]) == 17672, "Wrong exhaustive JIS oracle size")
    strict_suites = {item["suite"] for item in plan["exhaustiveStrict"]}
    require(
        strict_suites == {"jis-oracle.json", "warning-format-fixture.json"},
        "Missing exhaustive strict evidence",
    )

    checked_links = 0
    for document in HERE.glob("*.md"):
        body = document.read_text(encoding="utf-8")
        # Markdown targets in these design documents have no unescaped parentheses.
        for target in re.findall(r"\]\(([^)]+)\)", body):
            target = target.strip("<>")
            if urlsplit(target).scheme or target.startswith("#"):
                continue
            local = unquote(target.split("#", 1)[0])
            require((document.parent / local).exists(), f"Broken link: {document.name}: {target}")
            checked_links += 1

    statuses = Counter(p["status"] for p in policies.values())
    print("PASS: Python source and 8 original oracle hashes unchanged")
    print("PASS: R01-R18, 15 eight-field FIX specifications, 344 case references")
    print(f"PASS: {len(defined)} exact sidecars and their changedPaths; JIS 17,672 retained")
    print(f"PASS: {checked_links} local Markdown links")
    print("Design plan:", dict(statuses))
    print("Pending expectations are design tasks, not passing TypeScript tests.")


if __name__ == "__main__":
    main()
