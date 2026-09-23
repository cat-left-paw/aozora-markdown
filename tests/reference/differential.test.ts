import { it, expect } from "vitest";
import cases from "../fixtures/differential.json";
import manifest from "../../design/fixtures/manifest.json";
import { runUnit } from "./unitAdapter.js";
import {
  isspace,
  strip,
  splitlines,
} from "../../src/core/pythonStringCompat.js";
for (const c of cases)
  it("strict regression:" + c.id, () =>
    expect(runUnit(c).projection).toEqual(c.expected),
  );
it("CPython Unicode whitespace exactly pinned over all scalar values", () => {
  const found = [];
  for (let n = 0; n < 0x110000; n++)
    if (isspace(String.fromCodePoint(n))) found.push(n);
  expect(found).toEqual(manifest.pythonWhitespaceCodepoints);
  expect(strip("\ufeff x \ufeff")).toBe("\ufeff x \ufeff");
});
it("Python splitlines including CRLF and non-LF terminators", () =>
  expect(splitlines("a\r\nb\rc\x1cd\u2028")).toEqual(["a", "b", "c", "d"]));
