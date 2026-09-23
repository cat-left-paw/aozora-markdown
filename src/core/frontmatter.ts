import {
  parseDocument,
  isMap,
  isSeq,
  isScalar,
  isAlias,
  visit,
  Scalar,
} from "yaml";
import type { Diagnostic, Metadata } from "./types.js";
import { frontmatterEnvelope, type Envelope } from "./protectedRanges.js";
import { strip } from "./pythonStringCompat.js";
export interface FrontmatterReadResult {
  exists: boolean;
  ok: boolean;
  envelope: Envelope | null;
  metadata?: Metadata;
  diagnostics: Diagnostic[];
}
const scalarKeys = ["title", "author", "translator", "raw_header"] as const;
const arrayKeys = ["authors", "translators"] as const;
function failure(
  envelope: Envelope,
  code: string,
  reason: string,
): FrontmatterReadResult {
  return {
    exists: true,
    ok: false,
    envelope,
    diagnostics: [
      {
        code,
        severity: "warning",
        stage: "frontmatter",
        range: { startUtf16: envelope.startUtf16, endUtf16: envelope.endUtf16 },
        sourceOccurrenceId: `source:${envelope.startUtf16}:${envelope.endUtf16}`,
        details: { reason },
      },
    ],
  };
}
const absent = (v: unknown) =>
  v === null ||
  v === undefined ||
  (isScalar(v) &&
    v.type === Scalar.PLAIN &&
    /^(?:null|Null|NULL|~)?$/u.test(String(v.value ?? "")));
export function readFrontmatter(text: string): FrontmatterReadResult {
  const envelope = frontmatterEnvelope(text);
  if (!envelope)
    return { exists: false, ok: true, envelope: null, diagnostics: [] };
  if (!envelope.closed)
    return failure(envelope, "FRONTMATTER_PARSE_FAILED", "unclosed-envelope");
  const raw = text.slice(envelope.contentStart, envelope.contentEnd);
  const doc = parseDocument(raw, {
    schema: "failsafe",
    customTags: [],
    uniqueKeys: true,
    strict: true,
    logLevel: "silent",
  });
  let unsafe = false;
  visit(doc, (_key, node) => {
    if (isAlias(node)) unsafe = true;
    if (
      node &&
      typeof node === "object" &&
      "tag" in node &&
      node.tag &&
      ![
        "tag:yaml.org,2002:str",
        "tag:yaml.org,2002:seq",
        "tag:yaml.org,2002:map",
      ].includes(String(node.tag))
    )
      unsafe = true;
  });
  if (
    doc.errors.length ||
    doc.warnings.length ||
    unsafe ||
    (doc.contents !== null && !isMap(doc.contents))
  )
    return failure(
      envelope,
      "FRONTMATTER_PARSE_FAILED",
      unsafe ? "alias-or-tag" : "invalid-mapping",
    );
  const metadata: Metadata = {};
  if (isMap(doc.contents))
    for (const pair of doc.contents.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== "string")
        return failure(envelope, "FRONTMATTER_PARSE_FAILED", "non-string-key");
      const key = pair.key.value,
        value = pair.value;
      if (absent(value)) continue;
      if ((scalarKeys as readonly string[]).includes(key)) {
        if (!isScalar(value) || typeof value.value !== "string")
          return failure(envelope, "FRONTMATTER_INVALID_TYPE", key);
        metadata[key as (typeof scalarKeys)[number]] = value.value;
      } else if ((arrayKeys as readonly string[]).includes(key)) {
        const values = isSeq(value) ? value.items : [value];
        const strings: string[] = [];
        for (const node of values) {
          if (!isScalar(node) || typeof node.value !== "string")
            return failure(envelope, "FRONTMATTER_INVALID_TYPE", key);
          if (strip(node.value)) strings.push(node.value);
        }
        if (strings.length)
          metadata[key as (typeof arrayKeys)[number]] = strings;
      }
    }
  return { exists: true, ok: true, envelope, metadata, diagnostics: [] };
}
function quoteScalar(s: string): string {
  // Test a prospective plain value independently under the usual YAML core schema.
  if (
    s &&
    s === strip(s) &&
    !/[\x00-\x1f\x7f-\x9f\u2028\u2029]/u.test(s) &&
    s !== "---" &&
    s !== "..."
  ) {
    const doc = parseDocument(`value: ${s}\n`, {
      schema: "core",
      uniqueKeys: true,
      logLevel: "silent",
    });
    if (
      !doc.errors.length &&
      !doc.warnings.length &&
      isMap(doc.contents) &&
      doc.contents.items.length === 1
    ) {
      const node = doc.contents.items[0].value;
      if (isScalar(node) && node.type === Scalar.PLAIN && node.value === s)
        return s;
    }
  }
  return doubleQuotedScalar(s);
}
function doubleQuotedScalar(s: string): string {
  return JSON.stringify(s).replace(
    /[\x7f-\x9f\u2028\u2029]/gu,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}
export interface ValuePlacement {
  key: keyof Metadata;
  index?: number;
  valueStart: number;
  valueEnd: number;
  sourceStart: number;
  sourceEnd: number;
}
export function serializeFrontmatter(metadata: Metadata): {
  text: string;
  placements: ValuePlacement[];
} {
  if (!Object.keys(metadata).length) return { text: "", placements: [] };
  let text = "---";
  const placements: ValuePlacement[] = [];
  const scalar = (
    key: keyof Metadata,
    value: string,
    index?: number,
    forceQuoted = false,
  ) => {
    const encoded = forceQuoted
      ? doubleQuotedScalar(value)
      : quoteScalar(value);
    text += index === undefined ? `\n${key}: ` : "\n  - ";
    if (encoded === value)
      placements.push({
        key,
        index,
        valueStart: text.length,
        valueEnd: text.length + value.length,
        sourceStart: 0,
        sourceEnd: value.length,
      });
    text += encoded;
  };
  for (const key of [
    "title",
    "author",
    "authors",
    "translator",
    "translators",
    "raw_header",
  ] as const) {
    const value = metadata[key];
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      if (!value.length) {
        text += `\n${key}: []`;
        continue;
      }
      text += `\n${key}:`;
      value.forEach((s, i) => scalar(key, s, i));
    } else if (
      key === "raw_header" &&
      !(/^[ \t\n]*$/u.test(value) && /[ \t]/u.test(value)) &&
      !/[\x00-\x08\x0b\x0c\x0d\x0e-\x1f\x7f-\x9f\u2028\u2029]/u.test(value)
    ) {
      const fieldStart = text.length;
      const placementStart = placements.length;
      const tail = value.match(/\n*$/u)![0].length;
      const chomp = tail === 0 ? "-" : tail === 1 && value !== "\n" ? "" : "+";
      // Explicit indentation is needed when the first non-empty data line begins with spaces.
      const indent = /^[ \t]/u.test(value.replace(/^\n+/u, "")) ? "2" : "";
      text += `\nraw_header: |${indent}${chomp}`;
      const rows = value.split("\n");
      if (tail) rows.pop();
      let offset = 0;
      for (const row of rows) {
        text += "\n  ";
        placements.push({
          key,
          valueStart: text.length,
          valueEnd: text.length + row.length,
          sourceStart: offset,
          sourceEnd: offset + row.length,
        });
        text += row;
        offset += row.length + 1;
      }
      // Chomping and indentation interact even when the value contains text.
      // Admit the literal only if its actual YAML meaning is exactly the input.
      const candidate = parseDocument(text.slice(fieldStart + 1) + "\n", {
        schema: "core",
        uniqueKeys: true,
        strict: true,
        logLevel: "silent",
      });
      const node =
        isMap(candidate.contents) && candidate.contents.items.length === 1
          ? candidate.contents.items[0].value
          : null;
      if (
        candidate.errors.length ||
        candidate.warnings.length ||
        !isScalar(node) ||
        node.value !== value
      ) {
        text = text.slice(0, fieldStart);
        // Escaping changes the text spans: none of the rejected literal's
        // placements may survive into preserved-note provenance.
        placements.length = placementStart;
        scalar(key, value, undefined, true);
      }
    } else scalar(key, value);
  }
  text += "\n---";
  const parsed = readFrontmatter(text);
  // Compare typed values; empty arrays are intentionally treated as unspecified by the reader.
  const expected = { ...metadata };
  for (const key of arrayKeys) {
    if (expected[key]) {
      expected[key] = expected[key]!.filter((v) => strip(v));
      if (!expected[key]!.length) delete expected[key];
    }
  }
  if (
    !parsed.ok ||
    JSON.stringify(ordered(parsed.metadata ?? {})) !==
      JSON.stringify(ordered(expected))
  )
    throw new Error("Frontmatter serialization round-trip failed");
  return { text, placements };
}
function ordered(m: Metadata): unknown {
  return [
    m.title,
    m.author,
    m.authors,
    m.translator,
    m.translators,
    m.raw_header,
  ];
}
export const createFrontmatter = (metadata: Metadata): string =>
  serializeFrontmatter(metadata).text;
