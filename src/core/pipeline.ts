import type {
  ConversionOptions,
  ConversionResult,
  ProcessingEvent,
} from "./types.js";
import { normalizeOptions, zeroStats } from "./options.js";
import { TrackedText } from "./trackedText.js";
import { gaijiStage } from "./gaiji.js";
import { tcyStage } from "./tcy.js";
import { emphasisStage } from "./emphasis.js";
import { underlineStage } from "./underline.js";
import { boutenStage } from "./bouten.js";
import { headingsStage } from "./headings.js";
import { indentStage } from "./indent.js";
import { alignStage } from "./align.js";
import { pageBreakStage } from "./pageBreak.js";
import { getNamingMetadata, frontmatterStage } from "./metadata.js";
import { footerStage } from "./footer.js";
import { annotationBlocksStage } from "./annotationBlocks.js";
import { scanRemainingNotes } from "./remainingNotes.js";
/**
 * One pipeline for every input. There is no input or output format: the
 * Markdown-aware protection (fence, inline code, frontmatter) always applies.
 */
export function convertText(
  text: string,
  options?: ConversionOptions,
): ConversionResult {
  const o = normalizeOptions(options);
  const t = new TrackedText(text, "markdown"),
    stats = zeroStats(),
    processingEvents: ProcessingEvent[] = [];
  t.protected(); // stage 0: read-only indexing, never content transformation.
  if (o.convertGaiji) stats.gaiji = gaijiStage(t);
  // S7: after gaiji, before emphasis. Later stages keep their relative order.
  if (o.convertTcy) stats.tcy = tcyStage(t);
  if (o.convertMarkdownEmphasis) stats.emphasis = emphasisStage(t);
  if (o.convertUnderline)
    stats.underline = underlineStage(t, {
      outputFormat: o.underlineOutputFormat,
      approximateOtherStyles: o.approximateOtherUnderlineStyles,
      approximateLeft: o.approximateLeftUnderline,
    });
  if (o.convertBouten) stats.bouten = boutenStage(t, o.boutenChar);
  if (o.convertHeadings) stats.headings = headingsStage(t, o.headingLevels);
  if (o.convertNyozeIndent)
    stats.indent = indentStage(t, o.preserveIndentNotes);
  if (o.convertNyozeAlignEnd)
    stats.align = alignStage(t, {
      approximateJiage: o.approximateJiage,
      preserveNotes: o.preserveAlignNotes,
    });
  if (o.convertNyozePageBreak)
    stats.pageBreak = pageBreakStage(t, {
      approximateSpreadBreaks: o.approximateSpreadBreaks,
      preserveNotes: o.preservePageBreakNotes,
    });
  // Read-only: naming metadata is taken before footer/annotation/frontmatter edits.
  const namingMetadata = getNamingMetadata(t.text, t.context);
  for (const stage of [
    "gaiji",
    "tcy",
    "emphasis",
    "underline",
    "bouten",
    "headings",
    "indent",
    "align",
    "pageBreak",
  ] as const)
    for (const [action, count] of Object.entries(stats[stage]))
      if (count) processingEvents.push({ stage, action, count });
  if (o.removeAozoraFooter) {
    stats.footerRemoved = footerStage(t).removed;
    if (stats.footerRemoved)
      processingEvents.push({ stage: "footer", action: "removed" });
  }
  if (o.removeAnnotationBlocks) {
    const r = annotationBlocksStage(t);
    processingEvents.push({
      stage: "annotationBlocks",
      action: "removal-pass",
      count: r.removedBlocks,
    });
  }
  // Always runs: with addFrontmatter and addHeaderToBody both false it only diagnoses.
  const action = frontmatterStage(t, o);
  if (action) processingEvents.push({ stage: "frontmatter", action });
  const remainingNotes = scanRemainingNotes(t.text, {
    preservedNotes: t.regions,
  });
  stats.remainingNotes = remainingNotes.length;
  if (remainingNotes.length)
    t.diagnostics.push({
      code: "REMAINING_AOZORA_NOTES",
      severity: "warning",
      stage: "residual",
      details: { count: remainingNotes.length },
    });
  return {
    text: t.text,
    outputEncoding: "utf-8",
    stats,
    remainingNotes,
    diagnostics: t.diagnostics,
    processingEvents,
    namingMetadata,
  };
}
