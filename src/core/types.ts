export type Context = "markdown" | "text";
export interface Range {
  startUtf16: number;
  endUtf16: number;
}
export interface Region extends Range {
  kind: "preserved-note" | "generated-markup";
  sourceOccurrenceId?: string;
  text: string;
  baseText?: string;
}
/** Diagnostic ranges refer to the original Unicode input, in UTF-16 code units. */
export interface Diagnostic {
  code: string;
  severity: "warning";
  stage: string;
  range?: Range;
  sourceOccurrenceId?: string;
  details: Readonly<Record<string, string | number | boolean>>;
}
export interface RemainingNote {
  line: number;
  text: string;
}
export interface Metadata {
  title?: string;
  author?: string;
  authors?: string[];
  translator?: string;
  translators?: string[];
  raw_header?: string;
}
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export interface HeadingLevels {
  large: HeadingLevel;
  medium: HeadingLevel;
  small: HeadingLevel;
}
/**
 * Content options only. The output file extension is an adapter setting
 * (`ImportOptions.outputExtension`); it never changes conversion.
 */
export interface ConversionOptions {
  convertGaiji?: boolean;
  /** Postfix ［＃「対象」は縦中横］ → Nyoze ｟対象｠. Default true. */
  convertTcy?: boolean;
  convertBouten?: boolean;
  convertHeadings?: boolean;
  headingLevels?: Partial<HeadingLevels>;
  addFrontmatter?: boolean;
  removeAnnotationBlocks?: boolean;
  removeAozoraFooter?: boolean;
  addHeaderToBody?: boolean;
  boutenChar?: string;
  convertNyozeIndent?: boolean;
  preserveIndentNotes?: boolean;
  convertNyozeAlignEnd?: boolean;
  approximateJiage?: boolean;
  preserveAlignNotes?: boolean;
  convertNyozePageBreak?: boolean;
  approximateSpreadBreaks?: boolean;
  preservePageBreakNotes?: boolean;
  convertMarkdownEmphasis?: boolean;
  convertUnderline?: boolean;
  underlineOutputFormat?: "nyoze" | "html";
  approximateOtherUnderlineStyles?: boolean;
  approximateLeftUnderline?: boolean;
}
export interface StageStats {
  gaiji: { converted: number; unconverted: number };
  tcy: { converted: number; unconverted: number };
  emphasis: { bold: number; italic: number; both: number; unconverted: number };
  underline: { converted: number; approximated: number; unconverted: number };
  bouten: { converted: number; unconverted: number };
  headings: { converted: number; unsupported: number };
  indent: { converted: number; unconverted: number };
  align: { converted: number; approximated: number; unconverted: number };
  pageBreak: {
    pageBreaks: number;
    blankPages: number;
    spreadApproximated: number;
    unconverted: number;
    kaidanUnconverted: number;
  };
  footerRemoved: boolean;
  remainingNotes: number;
}
export interface ProcessingEvent {
  stage: string;
  action: string;
  count?: number;
}
export interface NamingMetadata {
  ok: boolean;
  metadata?: Pick<Metadata, "title" | "author" | "authors">;
  diagnostics: Diagnostic[];
}
export interface ConversionResult {
  text: string;
  outputEncoding: "utf-8";
  stats: StageStats;
  remainingNotes: RemainingNote[];
  diagnostics: Diagnostic[];
  processingEvents: ProcessingEvent[];
  namingMetadata: NamingMetadata;
}
export interface StageResult<S> {
  text: string;
  stats: S;
  regions: Region[];
  diagnostics: Diagnostic[];
}
