export { convertText } from "./core/pipeline.js";
export {
  DEFAULT_OPTIONS,
  DEFAULT_HEADING_LEVELS,
  CONTENT_OPTION_KEYS,
  ConversionOptionsError,
} from "./core/options.js";
export type * from "./core/types.js";
export { convertGaiji, jis0213ToUnicode } from "./core/gaiji.js";
export { convertTcy } from "./core/tcy.js";
export { convertEmphasis } from "./core/emphasis.js";
export { convertUnderline } from "./core/underline.js";
export { convertBouten } from "./core/bouten.js";
export { convertHeadings } from "./core/headings.js";
export { convertIndent } from "./core/indent.js";
export { convertAlignEnd } from "./core/align.js";
export { convertPageBreaks } from "./core/pageBreak.js";
export { removeAnnotationBlocks } from "./core/annotationBlocks.js";
export { removeAozoraFooter } from "./core/footer.js";
export { readFrontmatter, createFrontmatter } from "./core/frontmatter.js";
export { parseLegacyFrontmatter } from "./core/legacyFrontmatter.js";
export {
  parseAozoraHeader,
  getNamingMetadata,
  reconstructHeader,
} from "./core/metadata.js";
export {
  scanRemainingNotes,
  formatRemainingNoteLogLines,
} from "./core/remainingNotes.js";
export { protectedRanges } from "./core/protectedRanges.js";
