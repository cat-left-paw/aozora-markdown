import type { Context, Metadata, NamingMetadata } from "./types.js";
import { lines, strip } from "./pythonStringCompat.js";
import { TrackedText, copy, type Part } from "./trackedText.js";
import { readFrontmatter, serializeFrontmatter } from "./frontmatter.js";
export interface HeaderOwner {
  line: number;
  key: keyof Metadata;
  index?: number;
  startUtf16: number;
  endUtf16: number;
  valueStart: number;
  valueEnd: number;
}
export interface HeaderResult {
  metadata: Metadata;
  body: string;
  bodyStart: number;
  owners: HeaderOwner[];
}
export function parseAozoraHeader(
  text: string,
  context: Context = "markdown",
): HeaderResult {
  const t = new TrackedText(text, context),
    rows = lines(text);
  const end = rows.findIndex((r) => strip(r.text) === "");
  const empty = {
    metadata: {},
    body: text,
    bodyStart: 0,
    owners: [],
  } as HeaderResult;
  if (end <= 0 || t.blocked(0, rows[end].start)) return empty;
  const header = rows.slice(0, end).map((r, i) => {
    const value = strip(r.text),
      offset = r.text.indexOf(value);
    return {
      value,
      line: i + 1,
      start: r.start + offset,
      end: r.start + offset + value.length,
    };
  });
  const metadata: Metadata = {},
    owners: HeaderOwner[] = [];
  const assign = (key: keyof Metadata, indices: number[]) => {
    if (!indices.length) return;
    const values = indices.map((i) => header[i].value);
    const arr = key === "authors" || key === "translators";
    if (arr) metadata[key] = values;
    else metadata[key] = values.join("\n");
    let offset = 0;
    indices.forEach((i, n) => {
      const h = header[i];
      owners.push({
        line: h.line,
        key,
        ...(arr ? { index: n } : {}),
        startUtf16: h.start,
        endUtf16: h.end,
        valueStart: arr ? 0 : offset,
        valueEnd: (arr ? 0 : offset) + h.value.length,
      });
      offset += h.value.length + 1;
    });
  };
  assign("title", [0]);
  if (header.length === 2) assign("author", [1]);
  else if (header.length >= 3) {
    const translators = header
      .map((h, i) => (i > 0 && h.value.endsWith("訳") ? i : -1))
      .filter((i) => i >= 0);
    if (translators.length) {
      assign(
        translators.length === 1 ? "translator" : "translators",
        translators,
      );
      const a = translators[0] - 1;
      if (a >= 1) assign("author", [a]);
      const used = new Set([0, ...translators, ...(a >= 1 ? [a] : [])]);
      assign(
        "raw_header",
        header.map((_, i) => i).filter((i) => !used.has(i)),
      );
    } else {
      assign("raw_header", [1]);
      assign(
        header.length === 3 ? "author" : "authors",
        header.map((_, i) => i).slice(2),
      );
    }
  }
  let bodyStart = rows[end].start;
  while (text[bodyStart] === "\n") bodyStart++;
  return {
    metadata,
    body: text.slice(bodyStart),
    bodyStart,
    owners: owners.sort((a, b) => a.line - b.line),
  };
}
export function reconstructHeader(metadata: Metadata): string {
  const parts: string[] = [];
  if (metadata.title !== undefined) parts.push(metadata.title);
  if (metadata.raw_header !== undefined)
    parts.push(
      metadata.raw_header.endsWith("\n")
        ? metadata.raw_header.slice(0, -1)
        : metadata.raw_header,
    );
  const authors = metadata.authors?.filter((x) => strip(x));
  if (authors?.length) parts.push(...authors);
  else if (metadata.author !== undefined) parts.push(metadata.author);
  const translators = metadata.translators?.filter((x) => strip(x));
  if (translators?.length) parts.push(...translators);
  else if (metadata.translator !== undefined) parts.push(metadata.translator);
  return parts.length ? parts.join("\n") + "\n\n" : "";
}
export function getNamingMetadata(
  text: string,
  context: Context = "markdown",
): NamingMetadata {
  const fm = context === "markdown" ? readFrontmatter(text) : null;
  if (fm?.exists && !fm.ok) return { ok: false, diagnostics: fm.diagnostics };
  const all = fm?.exists
    ? (fm.metadata ?? {})
    : parseAozoraHeader(text, context).metadata;
  const metadata: NonNullable<NamingMetadata["metadata"]> = {};
  if (all.title !== undefined) metadata.title = all.title;
  if (all.authors?.length) {
    metadata.authors = [...all.authors];
    metadata.author = all.authors[0];
  } else if (all.author !== undefined) metadata.author = all.author;
  return { ok: true, metadata, diagnostics: [] };
}
export function frontmatterStage(
  t: TrackedText,
  options: { addFrontmatter: boolean; addHeaderToBody: boolean },
): string | null {
  const fm = readFrontmatter(t.text);
  if (fm.exists) {
    for (const d of fm.diagnostics) {
      const r = d.range!;
      t.diagnose(d.code, d.stage, r.startUtf16, r.endUtf16, d.details);
    }
    if (!fm.ok || !options.addHeaderToBody) return null;
    const env = fm.envelope!;
    let start = env.endUtf16;
    while (t.text[start] === "\n") start++;
    const body = t.text.slice(start),
      metadata = fm.metadata ?? {};
    if (
      metadata.title &&
      body
        .split("\n")
        .slice(0, 10)
        .some((r) => strip(r) === metadata.title)
    )
      return null;
    const header = reconstructHeader(metadata);
    t.apply([
      {
        start: env.endUtf16,
        end: t.text.length,
        parts: ["\n", header, copy(start, t.text.length)],
      },
    ]);
    return "header-restored";
  }
  if (!options.addFrontmatter) return null;
  const parsed = parseAozoraHeader(t.text, t.context);
  if (!Object.keys(parsed.metadata).length) return null;
  const generated = serializeFrontmatter(parsed.metadata);
  // Transfer only the explicitly owned, verbatim scalar spans. Escaped values have no placement.
  const regions = t.regions.filter((r) => r.kind === "preserved-note");
  const mapped = [];
  for (const r of regions)
    for (const owner of parsed.owners) {
      if (owner.startUtf16 > r.startUtf16 || r.endUtf16 > owner.endUtf16)
        continue;
      const valueStart = owner.valueStart + r.startUtf16 - owner.startUtf16,
        valueEnd = valueStart + r.text.length;
      for (const p of generated.placements) {
        if (
          p.key !== owner.key ||
          p.index !== owner.index ||
          valueStart < p.sourceStart ||
          valueEnd > p.sourceEnd
        )
          continue;
        const start = p.valueStart + valueStart - p.sourceStart;
        mapped.push({
          ...r,
          startUtf16: start,
          endUtf16: start + r.text.length,
        });
      }
    }
  const parts: Part[] = [
    { text: generated.text, regions: mapped },
    "\n",
    copy(options.addHeaderToBody ? 0 : parsed.bodyStart, t.text.length),
  ];
  t.apply([{ start: 0, end: t.text.length, parts }]);
  return options.addHeaderToBody
    ? "frontmatter-added"
    : "frontmatter-added-header-removed";
}
