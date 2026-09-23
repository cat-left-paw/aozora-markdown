import * as core from "../../src/index.js";
import { sanitizeFilename } from "../../src/policies/index.js";
export interface UnitCase {
  id: string;
  function: string;
  input: any;
  options: Record<string, any>;
  expected: any;
}
export function runUnit(c: UnitCase): { projection: any; details?: any } {
  const o = c.options,
    s = c.input;
  let result: any;
  let value: any;
  switch (c.function) {
    case "convert_aozora_gaiji":
      result = core.convertGaiji(s);
      break;
    case "convert_aozora_markdown_emphasis":
      result = core.convertEmphasis(s);
      break;
    case "convert_aozora_underline":
      result = core.convertUnderline(s, {
        outputFormat: o.output_format,
        approximateOtherStyles: o.approximate_other_styles,
        approximateLeft: o.approximate_left,
      });
      break;
    case "convert_aozora_bouten":
      result = core.convertBouten(s, o.bouten_char);
      break;
    case "convert_aozora_headings":
      result = core.convertHeadings(s);
      break;
    case "convert_aozora_indent":
      result = core.convertIndent(s, { preserveNotes: o.preserve_notes });
      break;
    case "convert_aozora_align_end":
      result = core.convertAlignEnd(s, {
        approximateJiage: o.approximate_jiage,
        preserveNotes: o.preserve_notes,
      });
      break;
    case "convert_aozora_page_breaks":
      result = core.convertPageBreaks(s, {
        approximateSpreadBreaks: o.approximate_spread_breaks,
        preserveNotes: o.preserve_notes,
      });
      break;
    case "remove_aozora_footer_metadata":
      result = core.removeAozoraFooter(s);
      break;
    case "jis0213_to_unicode":
      value = core.jis0213ToUnicode(s, o.row, o.cell);
      break;
    case "remove_aozora_annotations":
      result = core.removeAnnotationBlocks(s);
      value = result.text;
      break;
    case "scan_remaining_aozora_notes":
      value = core.scanRemainingNotes(s);
      break;
    case "strip_preserved_aozora_note_markers":
      value = s;
      break; // retired: finalize is identity
    case "parse_aozora_header": {
      const r = core.parseAozoraHeader(s);
      value = [r.metadata, r.body];
      break;
    }
    case "extract_frontmatter_metadata":
      value = core.parseLegacyFrontmatter(s);
      break;
    case "get_metadata_from_text":
      value = core.getNamingMetadata(s).metadata;
      break;
    case "create_frontmatter":
      value = core.createFrontmatter(s);
      break;
    case "reconstruct_header_from_metadata":
      value = core.reconstructHeader(s);
      break;
    case "sanitize_filename":
      value = sanitizeFilename(s, o.max_length ?? 100);
      break;
    default:
      throw new Error("Unmapped original function " + c.function);
  }
  if (result && c.function !== "remove_aozora_annotations")
    return {
      projection: {
        return: [result.text, ...Object.values(result.stats)],
        warnings: [],
        output: result.text,
        stats: result.stats,
      },
      details: result,
    };
  return { projection: { return: value, warnings: [] }, details: result };
}
export function changedPaths(a: any, b: any, path = ""): string[] {
  if (a === b) return [];
  if (
    typeof a !== typeof b ||
    a === null ||
    b === null ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return [path];
  if (typeof a !== "object") return [path];
  if (Array.isArray(a)) {
    if (a.length !== b.length) return [path];
    return a.flatMap((v, i) => changedPaths(v, b[i], path + "/" + i));
  }
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length || keys.some((k) => !(k in b)))
    return [path];
  return keys.flatMap((k) =>
    changedPaths(
      a[k],
      b[k],
      path + "/" + k.replace(/~/g, "~0").replace(/\//g, "~1"),
    ),
  );
}
