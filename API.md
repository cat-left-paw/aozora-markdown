# Public API — aozora-ts-v3

Package version 0.2.0. The output extension is separate from the conversion content. Core decisions are `aozora-ts-v3`, import is `aozora-import-v2`, and the Web screen is `aozora-web-v6` (Slice 8's read-only Markdown preview is `aozora-preview-v1`; the vertical reference mode and the later guide, typeface, and intro note are display-only and do not change that wire schema). Export (`aozora-export-v1`) is unchanged. The approved deltas from v2 are in [compatibility-v3](./design/compatibility-v3.md).

## Migration from 0.1.0 (aozora-ts-v2 / aozora-import-v1)

| 0.1.0 | 0.2.0 |
| --- | --- |
| `convertText(text, { sourceFormat: 'txt' })` | `convertText(text)` or `convertText(text, {})`. The input format no longer selects a conversion. |
| `convertText(text, { sourceFormat: 'md', renameToMd: false })` | `convertText(text, {})`. The result is identical for TXT and MD input. |
| `prepareImport(inputs, { conversion: { renameToMd: true } })` | `prepareImport(inputs, { outputExtension: 'md' })` (the default) |
| `prepareImport(inputs, { conversion: { renameToMd: false } })` | `prepareImport(inputs, { outputExtension: 'txt' })`. The body is converted exactly like `.md`. |
| `importFiles(files, { conversion: { renameToMd } }, context)` | `importFiles(files, { outputExtension }, context)` |
| `result.isMarkdownOutput` | removed; use `PreparedArtifact.format` (`'md'` or `'txt'`) |
| `ImportResult.contract === 'aozora-import-v1'` | `'aozora-import-v2'`; Worker results carrying v1 are rejected as `INVALID_WORKER_RESULT` |
| gaiji, bouten and headings always on for the Markdown path | `convertGaiji`, `convertBouten`, `convertHeadings` (default true) |
| headings fixed at `##`/`###`/`####` | `headingLevels: { large, medium, small }`, each 1–6, default 2/3/4 |

`sourceFormat` and `renameToMd` are removed, not remapped. A value other than `undefined` throws `ConversionOptionsError` (a `TypeError`) with `field` set to the removed name, `removed: true`, and a message that names the replacement. In `prepareImport`/`importFiles` the same fields under `conversion` give `INVALID_OPTION` (reason `conversion.sourceFormat` / `conversion.renameToMd`) before any payload read or Worker start. Explicit `undefined` is accepted so that spread option objects keep working. `outputExtension` lives only in `ImportOptions`: the core returns text and does not know about file names.

The old TXT path (`sourceFormat:'txt'` with `renameToMd:false`) ran only gaiji, footer and annotation-block removal. The nearest 0.2.0 settings are `{ convertMarkdownEmphasis: false, convertUnderline: false, convertBouten: false, convertHeadings: false, convertTcy: false, addFrontmatter: false }`. Two differences remain by design: code fences, inline code and existing frontmatter are now protected in TXT input too, and the residual scan now also runs for `.txt` output. The ledger records these as `COMMON_PROTECTION_FOR_TEXT_INPUT` and `RESIDUAL_SCAN_FOR_TXT_OUTPUT`.

## Entries and runtime

| Entry | Main exports | Host dependencies |
| --- | --- | --- |
| `.` | `convertText`, converters, metadata/frontmatter, residual scanner/formatter | none; browser-compatible YAML parser bundled |
| `/encoding` | `decodeTextBytes`, `DecodeOptions`, `DecodeResult` | none; generated CPython codec tables |
| `/policies` | `sanitizeFilename`, `collisionKey`, `planOutputs`, `authorizeDestination`, `validateZipEntry`, `planZipEntries`, `initialJobStats`, `reduceJobStats` | none; all inputs are values or an optional pure host canonical-key callback |

`dist/index.js`, `dist/encoding/index.js`, `dist/policies/index.js` are standalone ESM bundles with declaration files. ES2022 is the build target. The current tested browsers/runtimes are recorded in `reports/browser-smoke.json`; no legacy browser support is implied.

## convertText

`convertText(text: string, options?: ConversionOptions): ConversionResult` is synchronous and deterministic. Omitted options and `{}` both mean the defaults; a non-object throws `ConversionOptionsError` with `field: ""`. No Unicode normalization or global newline cleanup is performed on string input. There is no `convertUtf8` option; `outputEncoding` is always `'utf-8'`.

| Options | Defaults |
| --- | --- |
| `convertGaiji`, `convertTcy`, `convertBouten`, `convertHeadings` | true |
| `addFrontmatter`, `removeAnnotationBlocks`, `removeAozoraFooter` | true |
| `convertMarkdownEmphasis`, `convertUnderline` | true |
| `addHeaderToBody`, `convertNyozeIndent`, `preserveIndentNotes` | false |
| `convertNyozeAlignEnd`, `approximateJiage`, `preserveAlignNotes` | false |
| `convertNyozePageBreak`, `approximateSpreadBreaks`, `preservePageBreakNotes` | false |
| `approximateOtherUnderlineStyles`, `approximateLeftUnderline` | false |
| `boutenChar` | `﹅`; first Unicode code point, empty falls back |
| `underlineOutputFormat` | `'nyoze'`; also `'html'` |
| `headingLevels` | `{ large: 2, medium: 3, small: 4 }`; each an integer 1–6 |

Omitted or explicitly `undefined` optional fields use their defaults; explicit `false` stays off. `headingLevels` is merged per key with the defaults (`{ medium: 5 }` keeps large 2 and small 4); `DEFAULT_OPTIONS` and `DEFAULT_HEADING_LEVELS` are deep-frozen and never shared with a caller. An unknown kind or a level outside 1–6 throws `ConversionOptionsError` with `field` such as `headingLevels.medium`. Levels are validated even when `convertHeadings` is false. Levels need not be ordered; `large: 4, small: 1` is honoured as given. Disabled parent options do not rewrite child option values (`boutenChar`, `headingLevels`, preserve/approximation flags); a child whose parent is off changes nothing.

Every input uses one Markdown-aware pipeline: code fences, inline code and existing frontmatter are protected for TXT exactly as for MD, and the residual scan always runs. The thirteen content fields in `CONTENT_OPTION_KEYS` (gaiji, tate-chu-yoko, emphasis, underline, bouten, headings, indent, align, page break, footer, annotation blocks, frontmatter, header-to-body) are the only switches that change text. When all thirteen are false, `result.text === text` for every string, including empty text, CR/CRLF, BOM characters, existing frontmatter, invalid notes, emoji, PUA and code; the residual scan still reports what remains. Adapters still decode strictly, drop a BOM, normalize newlines to LF and write UTF-8, so all-off output bytes are not the original file bytes.

Pipeline: readonly protection index → gaiji → tate-chu-yoko → emphasis → underline → bouten → headings → indent → align → page → **naming metadata snapshot** → footer → annotation blocks → frontmatter/header → residual → finalize. Counts belong to the stage that ran; later deletion never subtracts earlier counts. Generated indent/directive content continues to block downstream align/page conversion (R17).

`convertTcy` (default true) converts only the postfix note `［＃「対象」は縦中横］` when that quote is the immediate same-line suffix and the body is 1–4 characters from `[A-Za-z0-9!?]`. Output brackets are U+FF5F and U+FF60 (`｟` / `｠`) with no added inner space. A span generated by this call keeps its base characters so a later emphasis, underline or heading note in the same call can wrap it. Notes inside code, fences, frontmatter, ruby, or an existing `｟…｠` stay as written. `false` skips the stage, leaves both `stats.tcy` counters at 0, and leaves the note for the residual scan. An unconverted postfix note records `TCY_NOT_CONVERTED` with `details.reason` of `empty`, `invalid-body`, `target-mismatch`, `ruby-context` or `existing-tcy`. Block and range spellings are not counted by this stage. `stats.tcy` is `{ converted, unconverted }` on every result, including when the stage is off.

The result includes final `text`, `outputEncoding`, all `stats` fields (disabled stages are zero), final `remainingNotes`, `diagnostics`, `processingEvents` and `namingMetadata`. Exact public interfaces are in `src/core/types.ts` and the generated declarations. `processingEvents` list nonzero converter counters in pipeline order, followed by footer removal, an annotation-removal-pass event when enabled (including count zero), and any frontmatter/header operation. They are not legacy Qt log lines.

`remainingNotes` has `{line,text}` per actual final occurrence, 1-based LF line numbers. Its count is independent of converter-specific unconverted counters. Diagnostic ranges are **original input UTF-16 offsets**, end-exclusive; `sourceOccurrenceId` is `source:start:end`. Residual summary diagnostics have no single range. A reason diagnostic does not increment residual count. Current reason codes: `EMPHASIS_NOT_CONVERTED`, `UNDERLINE_NOT_CONVERTED`, `HEADING_TARGET_MISMATCH`, `BOUTEN_RUBY_CONTEXT`, `BOUTEN_NOT_CONVERTED`, `TCY_NOT_CONVERTED`, `UNCLOSED_ANNOTATION_BLOCK`, `FOOTER_CANDIDATE_PRESERVED`, `FRONTMATTER_PARSE_FAILED`, `FRONTMATTER_INVALID_TYPE`, `REMAINING_AOZORA_NOTES`. A quote that cuts through a `｟body｠` stays in place. An opener whose body is not a valid span does not hide a later valid `｟body｠` on the same line. That includes a bare span generated in the same call, the same span after emphasis or underline has wrapped it (`｠**`, `｠||`, `｠</u>`), and brackets that were already in the input. Emphasis uses `EMPHASIS_NOT_CONVERTED` / `target-mismatch` and underline uses `UNDERLINE_NOT_CONVERTED` / `target-mismatch`. A quote of the whole input `｟body｠` may still be wrapped by emphasis or underline. Bouten uses `BOUTEN_NOT_CONVERTED` / `tcy-overlap` for any overlap with those brackets, including the whole span, a wrapped `**｟body｠**`, and a range note `［＃傍点］…［＃傍点終わり］`. The range is one unconverted occurrence; its start and end notes stay for the residual scan. Quoting the base `12` inside an input `｟12｠` is an ordinary mismatch and does not record `BOUTEN_NOT_CONVERTED`.

## Individual stages and protection

`convertGaiji(text, context?)`, `convertTcy(text, context?)`, `convertEmphasis(text, context?)`, `convertBouten(text, mark?, context?)`, `convertHeadings(text, context?, levels?)`, `removeAozoraFooter(text, context?)`, `removeAnnotationBlocks(text, context?)` return `{text,stats,regions,diagnostics}`. `levels` is `Partial<HeadingLevels>` merged with the defaults. `convertUnderline`, `convertIndent`, `convertAlignEnd`, `convertPageBreaks` take named stage-specific option objects; see exported signatures. Individual stages default to Markdown context, which `convertText` now always uses. Explicit `'text'` context remains for compatibility probes of the v2 behaviour only.

All Markdown stages share the bounded R13 grammar: 3+ backticks/tildes with leading space/tab/fullwidth-space; close uses the same character, at least the opening length, and whitespace only after it. Unclosed fence runs to EOF. Inline spans pair maximal same-length backtick runs on one LF line; an unmatched run remains literal. Backslash escape processing and full CommonMark parsing are outside scope. New text is reindexed between transformation passes. A construct crossing protected text is preserved, not joined across the protected part.

`regions` on stage results are current-output UTF-16 ranges for generated markup or successfully preserved notes. They are call-local provenance, never embedded markers. `convertText` finalizes them internally. When generated underline markup encloses generated markup, complete inner regions contribute their composed base text for later heading matching; identical input Markdown/HTML has no such provenance. A separate converter call starts a fresh context; to preserve generated-markup provenance through a whole pipeline, use `convertText`. Internal `TrackedText` helpers are not a stable exported package entry.

`scanRemainingNotes(text,{preservedNotes?,context?})` accepts trusted surviving regions from the same transformation; input PUA never grants suppression. Existing plain saved notes are not treated as preserved on reimport. `formatRemainingNoteLogLines` keeps first-seen grouping, first three occurrences and first fifty kinds, matching the old formatter.

## Metadata and YAML

`readFrontmatter(text)` returns `{exists,ok,envelope,metadata?,diagnostics}`. It accepts one mapping using YAML failsafe schema, rejects aliases/custom tags/duplicate keys, and projects only known string/string-array fields. It never merges keys into object prototypes. Unknown keys remain in the original document, outside the naming projection. Empty/null author arrays are unspecified; scalar authors become one-element arrays. Non-string compound values for known fields fail with `FRONTMATTER_INVALID_TYPE`.

The initial standalone `---` starts an envelope. A closing candidate is a standalone `---` with optional outer space/tab and terminal CR, outside YAML literal/folded block scalars and single/double-quoted scalars. Indented `---` inside those scalars is data, including with explicit block indentation. Standard column-zero delimiters close after the scalar; ambiguous indented markers stay inside the scalar. The legacy whitespace-delimiter extension still takes precedence over plain-scalar continuation. The writer always emits column-zero delimiters. Boundary indexing uses source token ranges without resolving YAML aliases/tags or projecting metadata early. An unclosed envelope is readonly to EOF and fails parsing; no extra FM is appended. Existing source formatting is kept verbatim. `parseLegacyFrontmatter` is a separate comparison-only projection and is never used to repair or write product YAML.

`createFrontmatter(metadata)` uses fixed key order, retains safe plain scalars, quotes unsafe/typed/comment/control values, and chooses literal-block chomping for exact `raw_header` LF counts. LF-only values use keep chomping. Values consisting only of spaces/tabs/LF with any space or tab use double-quoted escaping to preserve all whitespace; empty values remain empty literals. Every other prospective raw_header literal is parsed with YAML core schema and accepted only if it has no errors/warnings and its scalar value exactly equals the input. A mismatching literal falls back to double-quoted escaping, including mixed text with trailing whitespace lines. Rejected literal placements are discarded; placements for unchanged fields remain. The final whole-envelope round-trip check still runs after either choice. The generated envelope is parsed and compared immediately; the tests also independently parse it with YAML core schema. The writer's parser normalizes empty authors for product use while YAML serialization preserves actual array/scalar values.

`parseAozoraHeader` returns metadata/body plus one `owners` entry per consumed source header line. It leaves the whole candidate in the body if it crosses readonly text. `getNamingMetadata` runs before deletion and FM generation and returns `{ok,metadata?,diagnostics}`. Invalid existing FM stops naming inference instead of becoming an Aozora header. `reconstructHeader` drops exactly one final LF from raw_header before combining fields.

## Byte decode

`decodeTextBytes(bytes,{encoding?:'auto'|'utf-8'|'cp932'|'shift_jis'})` returns either `{ok:true,text,encoding,bom}` or `{ok:false,code}` without partial text. It does not mutate bytes.

Auto recognizes a UTF-8 BOM and strictly decodes the remainder without codec fallback. Otherwise it tries strict UTF-8 → CP932 → Shift_JIS. UTF-16/32 BOMs are `UNSUPPORTED_ENCODING`; UTF-8 BOM with explicit non-UTF8 is `ENCODING_BOM_CONFLICT`; other failures are `DECODE_FAILED`. Success normalizes CRLF/CR to LF. Explicit mode tries only the selected codec. BOM-free bytes may be valid in more than one codec; UTF-8 priority is a policy, not a guarantee of detecting the original encoding. The internal codec tests compare all 256 single-byte and 65,536 two-byte inputs per legacy codec before BOM/newline policy.

## Pure output/ZIP policies

`sanitizeFilename(name,{maxCodePoints?,extension?,suffix?})` handles **one segment**, preserving Unicode display spelling. It replaces Windows forbidden punctuation, removes C0/C1 controls, trims outer Python whitespace/dots together, prefixes reserved stems, and reserves suffix/extension space before truncating. The resulting segment is at most 100 code points and 240 UTF-8 bytes, including suffix/extension. `extension` is only `md`/`txt`; collision suffix is `_converted`, `_converted2`, etc. Extension-less segment calls are supported. `collisionKey` uses per-segment NFC/lowercase/trailing ASCII space-dot removal; it is not a proof of all native identity equivalences.

`planOutputs(requests,snapshot)` reserves **all** inputs, existing files/directories and batch outputs. Request order is authoritative. It returns create-only commands, relative proposals, collision history and required capabilities. Directory `groupId` ties all members to one reserved parent; different logical groups that sanitize identically get stable distinct names. A safe preexisting directory may be reused. An optional `snapshot.canonicalKey` supplies additional host aliases without weakening the portable key. `canonicalIdentity` documents snapshot identities; the host must still perform the final identity/alias checks.

`authorizeDestination(capabilities,observed)` refuses unsafe roots, aliases/symlink parents/existing leaves and unavailable exclusive creation. A successful check authorizes only an **atomic create-if-absent**, never an exists-then-write sequence. A race must fail or replan without deleting/replacing the competing entry. No actual writer is supplied.

`validateZipEntry(metadata)` validates raw and decoded names before normalization; rejects C0, absolute/drive/UNC paths, any `..` component and symlinks; treats slash/backslash as separators; removes `.`/empty components; never percent-decodes. It returns separate `{archiveId,centralDirectoryIndex}` identity, validated relative name and a raw/decoded audit record. A wrapper must retain the audit record and read bytes by entry identity.

`planZipEntries(archives,options?,snapshot?)` validates every entry before returning commands, rejects the complete plan on any unsafe archive, preserves hierarchy and duplicate entries, sanitizes/reserves wrapper and directory groups, and optionally groups by author. Metadata is keyed by `JSON.stringify([archiveId,index])`. Only TXT/MD entries are converted; nontext and nested ZIP identities are listed as ignored. Commands expose validated names, not raw executable paths. No decompression occurs. ZIP raw-byte filename decoding, CRC, quotas and cancellation remain host/ZIP adapter work.

## Job state

`reduceJobStats(state,event)` is immutable. Every event carries `fileId` and `attemptId`; retry uses a new attempt ID. `WriteCommitted` adds document residual counts once per file, `WriteFailed` adds errors once per failed attempt and preserves its result in `failedResults`. `Skipped`, `Cancelled`, `ArchiveFailed` have distinct accounting; cancellations do not increment errors. Replayed events are idempotent.

Commit delivery is explicitly `'filesystem'` or `'browser-artifact'`. `savedFiles` and `artifactFiles` are separate. Browser download OS completion cannot be observed; preparing a download artifact must not be described as saving a file. The Browser artifact adapter is described below. Filesystem/Vault writers and their capability verification are not implemented.

## Import runtime — aozora-import-v2

Import uses the **aozora-ts-v3** core above. S2-01 through S2-06 are adapter contracts, separate from the 90 core intentional deviations. v2 differs from v1 only in `outputExtension`, the removed `conversion` fields, `INVALID_OPTION` and the contract string; limits, ZIP safety, accounting and naming policies are unchanged.

```ts
import { prepareImport } from 'aozora-markdown/import';

const result = await prepareImport([
  { id: 'selected-1', name: '作品.zip', kind: 'zip', bytes: zipBytes },
  { id: 'selected-2', name: '本文.txt', kind: 'txt', bytes: textBytes },
], {
  encoding: 'auto',
  outputExtension: 'md',
  conversion: { addFrontmatter: true },
  organizeByAuthor: false,
}, { signal, onProgress: progress => console.log(progress.stage) });
```

The import entry exports `prepareImport`, `DEFAULT_IMPORT_LIMITS`, `resolveLimits`, and the types from `src/import/types.ts`. `prepareImport(inputs, options?, context?)` resolves to `ImportResult`; validation/processing failures are represented in the result. Inputs and options are borrowed and never changed or detached. A caller must not mutate borrowed bytes while a call is running. `ImportInput` has readonly `id`, `name`, `kind:'txt'|'md'|'zip'`, and `bytes:Uint8Array`. IDs must be nonblank and unique; duplicate display names are allowed. Format is determined from the explicit kind and case-insensitive extension, with contradictions rejected. A display name's basename is the only input reservation; no physical path or host identity is inferred.

`ImportOptions` contains `conversion?:ConversionOptions`, `outputExtension?:'md'|'txt'` (default `'md'`), `encoding?:'auto'|Encoding`, `organizeByAuthor?:boolean` (false), and `limits?:Partial<ImportLimits>`. The same conversion applies to every loose file and ZIP entry, whatever its kind. `outputExtension` decides only the artifact `format`, the file-name extension and the Blob MIME (`text/markdown;charset=utf-8` or `text/plain;charset=utf-8`); body bytes and the whole `conversion` result are identical for both values. The options are validated once per batch before any payload read or Worker start: a non-object gives `INVALID_OPTION` reason `options`, an extension other than `'md'`/`'txt'` (including `null`) gives `outputExtension`, and any rejected conversion field gives `conversion.<field>` such as `conversion.renameToMd` or `conversion.headingLevels.small`. Such a batch has status `failed`, no artifacts and zero read metrics. The existing undefined/default/false semantics remain. Strict body decoding uses the existing encoding entry. Each supported body calls core exactly once. Its `namingMetadata`, text, stage counts, residuals and diagnostics remain attached. Missing/invalid naming metadata falls back to the original stem and `unknown_author` when author grouping is requested. Existing core parse diagnostics are retained.

Selected supported files produce candidates even if unchanged or named `_converted`; the Python folder-scan exclusion and `need_write` gate do not apply (S2-01). Direct calls process each loose input/archive as one unit. Input order, then central-directory order, determine all candidate/outcome order and names. One `planOutputs` call reserves selected basenames and all successful loose/ZIP requests together; accepted R03/R05/R18 policies supply sanitization, suffixes and directory groups. `relativePath` is a validated proposal, not a saved path. The input basename is reserved, so a loose `作品.txt` becomes `作品.md` with `.md` output but `作品_converted.txt` with `.txt` output; ZIP entries keep `archive-stem/dir/name.ext`, and author folders give `author/title.ext`.

`PreparedArtifact` contains `fileId`, `source:{inputId,entryIndex?}`, `relativePath`, UTF-8 `bytes` without an added BOM, `format:'txt'|'md'`, full `conversion:ConversionResult`, and `decoded:{encoding,bom}`. Loose IDs are `JSON.stringify([inputId])`; ZIP IDs are `JSON.stringify([inputId,index])`. ZIP index means central-directory index, not a filename lookup.

`ImportResult` contains `contract:'aozora-import-v2'`, `status`, `artifacts`, `outcomes`, `diagnostics` and `metrics`:

| status | Meaning |
| --- | --- |
| completed | All input units succeeded; empty/ignored archives are valid outcomes. |
| partial | At least one unit failed and another completed (including an empty unit). Only successful units publish candidates. |
| failed | All units failed, or a batch validation/budget failure discarded all candidates. |
| cancelled | Signal cancellation discarded the entire batch. |

Each input has an outcome, followed by outcomes for metadata entries reached before rejection. Outcome status is `prepared`, `failed`, `ignored`, `empty`, `discarded`, or `cancelled`. A failed archive exposes no candidates; earlier prepared entries become `discarded`, the failing entry is marked when identifiable, and unread entries are discarded. Enumeration can stop at the first unsafe entry or limit; unseen entries are not fabricated. Every enumerated ZIP entry carries `zipName` audit data: copied `rawBytes`, `basicName`/`adoptedName` when decoding succeeded, numeric flags, index, offset, compressed/declared sizes and Unix mode when available. No library entry object is public.

Import diagnostics are separate from conversion diagnostics: `{code,severity,stage,inputId,entryIndex?,reason}`. Batch/delivery diagnostics use empty `inputId` when no single source applies. Reasons are bounded categories, never copied body text or library exception messages. Main categories include `INVALID_INPUT`, `INVALID_OPTION`, `INVALID_LIMIT`, `LIMIT_EXCEEDED`, strict decoder codes, `ZIP_FILENAME_ENCODING`, `ZIP_UNICODE_PATH_IGNORED`, `UNSAFE_ZIP_ENTRY`, `ZIP_UNSUPPORTED`, `ZIP_INVALID_SIZE`, `ZIP_AMBIGUOUS`, `ZIP_HEADER_MISMATCH`, `ZIP_INVALID`, `IMPORT_FAILED`, and `CANCELLED`.

## ZIP bridge and limits

ZIP support uses pinned `@zip.js/zip.js` 2.17.0, direct reader/entry APIs and the bundled JavaScript codec. STORE and DEFLATE are supported. Encryption, split archives, unknown flags and unsupported compression on supported text entries fail explicitly. ZIP64 values must be safe nonnegative integers within limits. The adopted single-disk profile requires the first local header at byte 0, rejects prepended data even when offsets were rebased, and cross-checks the EOCD per-disk/total entry counts against the enumerated entries. Each classic EOCD field uses its ZIP64 value only when that field contains its sentinel; every non-sentinel value must agree with the corresponding ZIP64 value. ZIP64 sentinels require a consistent ZIP64 end record and locator. EOCD position follows the reader's adopted raw comment length, so signature-like bytes inside a valid comment are retained while real central-directory ambiguity remains rejected. These structure checks finish before any payload read. All metadata, including directories/images/nested ZIPs, passes existing R06 checks before any body is read. Ignored payloads are not expanded. Both basic and adopted names are checked; unsafe names are never repaired into accepted input. Structural local-header/range checks also run on ignored entries.

UTF-8-flagged filenames use fatal UTF-8; otherwise CP437, without heuristics. Unicode Path extra fields require version 1, raw-name CRC32 match and fatal UTF-8. Invalid fields fall back to the basic name and emit a warning. Raw bytes are not coerced into the pure validator's string `rawName` field. Symlink and Unix mode metadata are explicitly bridged. Duplicate names are permitted; appended/prepended/ambiguous structures, payload overlap, local/central/descriptor disagreement, CRC failure and invalid compressed data are rejected. The reader's permissive filename mode exists only to let our raw/adopted R06 validation run before any payload; it does not bypass the validator.

Every `ImportLimits` field is a positive safe integer; omission or `undefined` uses the finite default. Zero, negative, NaN, Infinity and unsafe integers are invalid. Exact equality is permitted.

| key | Default | Enforcement / failure scope |
| --- | ---: | --- |
| sources | 64 | Preflight; batch |
| inputBytes | 64 MiB | Before each reader; unit in direct API, batch preflight in Browser |
| totalInputBytes | 128 MiB | All-input reservation and Browser actual reads; batch |
| archiveEntries | 2,000 | During enumeration, including ignored/empty entries; archive |
| totalEntries | 8,000 | Across archives during enumeration; batch |
| filenameBytes | 4,096 | Raw filename bytes during enumeration; archive |
| textBytes | 16 MiB | Before loose decode, ZIP declaration, and each expanded chunk; unit |
| declaredBytes | 128 MiB | Sum of all reached ZIP declarations, including ignored entries; batch |
| expandedBytes | 128 MiB | Each supported-entry chunk, checked before retention; batch |
| outputBytes | 128 MiB | UTF-8 length before encoding/staging and before publication; batch |
| jobTimeoutMs | 60,000 | Browser caller watchdog, including File reading; failed delivery |

MiB = 1,048,576 bytes. Metrics include reserved/observed input bytes, ZIP entry/declaration counts, compressed payload bytes fed to the codec (`compressedBytesRead`), bytes offered to the counted writer (`expandedBytes`), retained bytes, rejected chunks, produced UTF-8 bytes, conversion/payload-read counts, reader open/close counts and payload-stream close/abort counts. Counters are cumulative work within **one call**, including failed/discarded units; no internal retries or refunds exist. A host retry is a new job with new budgets and attempt identity. The direct caller's already allocated input is outside these protections. A codec may reject corrupt data before offering any output to our writer; metrics do not claim visibility into its private buffers. Byte quotas are not a JavaScript heap ceiling: bounded input/CD buffers, codec windows, transient stream chunks, strings, copies, and artifact metadata also consume memory.

The library receives a `Uint8ArrayReader` subclass limiting compressed payload feed to **1 KiB per chunk**, and a counted `WritableStream`, never a whole-output `Uint8ArrayWriter`/TextWriter/BlobWriter. The bundled JS codec can synchronously enqueue the expansion of one compressed input chunk; the separate feed cap bounds this read-ahead instead of letting its default 64 KiB feed inflate tens of MiB before the writer runs. The private bundled zip.js copy is also configured to a 1 KiB chunk size, preventing its input rechunker from merging the bounded feed back into 64 KiB. Codec-internal chunks can still be 64 KiB, with stream queues and codec windows still outside the retained-byte counter. Rejected chunks are not retained. The bridge closes its reader in `finally`, and explicitly closes/aborts the payload stream and releases the writer lock. Direct `ImportContext.signal` is cooperative at entry/chunk/core boundaries; it cannot interrupt synchronous core code or dispatch an event while that thread is busy. Progress snapshots (`enumerating`, `reading`, `converting`, `converted`) are not commits. Use the Browser adapter for caller-thread cancellation during core work.

## Browser File / Worker / Blob adapter

```ts
import { importFiles } from 'aozora-markdown/browser';

// For a static build hosted at any subpath. A bundler can instead resolve the
// exported `aozora-markdown/import.worker.js` asset and supply a workerFactory.
const workerUrl = new URL('./dist/adapters/browser/import.worker.js', import.meta.url);
const delivered = await importFiles([
  { id: 'picked-1', file: selectedFile },
], { encoding: 'auto' }, {
  requestId: 'selection-1',
  attemptId: 'attempt-1',
  workerFactory: () => new Worker(workerUrl, { type: 'module' }),
  signal,
});
// delivered.artifacts contain Blob objects. No download or OS save is performed.
```

The browser entry exports `importFiles`, `BrowserInput`, `BrowserImportContext`, `BrowserArtifact`, `BrowserImportResult`, `ImportWorkerRequest` and `ImportWorkerResponse`. `BrowserInput` is `{id,file,kind?}`. `BrowserImportContext` extends signal/progress with required nonblank `requestId` and `attemptId`, plus `workerFactory?:()=>Worker` or `workerUrl?:string|URL`. Factory takes precedence and must return a **new dedicated Worker**; the adapter owns termination, so do not return a shared Worker. Optional `createBlob(bytes,mime)` permits a host Blob constructor; throwing rejects the entire delivery. No functions/signals/File objects cross the Worker protocol.

All File sizes/counts/names/IDs are preflighted before the first `arrayBuffer` call. Actual sizes are checked again and must equal the reservation. File MIME is not authoritative. Browser-read buffers belong to the adapter and are transferred to its Worker; direct import caller buffers are never detached. File.arrayBuffer itself is not abortable; a cancelled/timed-out read settles the job immediately, and any late read is ignored without starting a Worker. Processing is sequential inside one Worker per invocation, with no pool or nested zip.js Worker.

Only matching request IDs are accepted. Terminal settlement, cleanup and commit occur once; duplicate/late completions cannot revive cancelled output. Signal cancellation and watchdog timeout terminate the owned Worker even during synchronous conversion. All timers/listeners are removed on result/error/transfer failure/cancel, and the next invocation creates a fresh Worker. No Worker starts at module import time. Worker unavailable/missing asset/load/message/transfer errors fail explicitly; there is no heavy main-thread fallback. The package and codec are bundled locally; no runtime CDN, external fetch, object URLs or automatic download is used. The factory/URL is caller-provided and must refer to the local matching build.

`BrowserImportResult` is `{result:ImportResult,artifacts:BrowserArtifact[],stats:JobState}`. `BrowserArtifact` adds `blob` to `PreparedArtifact`. Only after receiving a valid final result **and constructing all Blobs** does the adapter issue reducer commits with `delivery:'browser-artifact'`. Partial import may commit only its successful units. Blob/transfer/cancel/timeout failure commits none, including remaining-note counts; `savedFiles` is always 0. Candidates/metrics are not committed stats. Worker termination reports the latest observed progress metrics, which may precede the actual instant of termination; it does not claim graceful reader-close counters from a killed Worker.

Accounting: each failed ZIP input gives one `ArchiveFailed`; failed loose input gives one `WriteFailed`. Batch/delivery failure marks affected input units failed. Cancellation counts input units, not every possible unseen ZIP member. `Skipped` counts validated ignored entry outcomes and one outcome for an empty archive; a nonempty ignored archive parent is not counted again. Each successful artifact commits by stable fileId. The reducer deduplicates the same `(event type,fileId,attemptId)`; a new failure attempt may count again, but a file already committed is not committed twice. The adapter starts a fresh stats state per invocation; hosts combining jobs can use the existing reducer explicitly.

The import runtime assets remain the five original ESM entries plus `dist/adapters/browser/import.worker.js`; each has a minified build and the raw build has a source map. Notices/licenses are copied to `dist/notices/` and `dist/LICENSE`. No auxiliary WASM or internal Worker asset is required. `npm run test:import-browser` verifies subpath serving, real main/Worker parity, cancellation/timeout/restart, missing Worker handling and the complete observed network request set. Node filesystem/Vault saving is not implemented. The Web UI is described below, after the export entries.

## Export runtime — aozora-export-v1

`aozora-markdown/export` exports `prepareExport`, `DEFAULT_EXPORT_LIMITS`, `EXPORT_CONTRACT` and the types in `src/export/types.ts`. It depends on Web Streams and AbortSignal, but no DOM, Blob, Worker, Node filesystem, Python, network or import/core conversion API. Core does not re-export it. `prepareExport(artifacts, options, context?)` returns a Promise of a discriminated `ExportResult`; validation, writer and callback failures resolve as structured failures.

```ts
import { prepareExport } from 'aozora-markdown/export';

const ready = await prepareExport(selected.map(a => ({
  fileId: a.fileId,
  relativePath: a.relativePath,
  format: a.format,
  bytes: a.bytes,
})), { mode: 'zip', archiveName: '作品集.zip' }, { signal });
if (ready.status === 'ready') {
  // ready.bytes, filename, mime; no filesystem writes or automatic download.
}
```

`ExportArtifact` has readonly `fileId:string`, `relativePath:string`, `format:'md'|'txt'` and `bytes:Uint8Array`. IDs must be nonblank and unique. The ordered selection is the entire export, with no sorting, deduplication by content, path repair, author/wrapper recomputation or collision renaming. Zero artifacts fail; `single` requires exactly one, and `zip` requires at least one. An empty file is valid. Bytes are the only content authority: export never reads a BrowserArtifact's old Blob or conversion text, decodes bytes, invokes core, writes YAML, changes newlines/BOM, or normalizes content/names. Arbitrary callers are responsible for supplying converted UTF-8; opaque bytes, including NUL/BOM or invalid UTF-8, are preserved without repair.

Borrowed inputs must remain unchanged until the Promise settles. Direct export never changes/detaches them, honors view offsets/lengths, and rejects SharedArrayBuffer and detached buffers. Single output is an independent copy. ZIP writer output is also independent. No export/download operation emits `WriteCommitted`, changes import diagnostics or updates `JobState` (`filesConverted`, `remainingNotes`, `artifactFiles`, `savedFiles`). Export failure does not roll back successful import.

`ExportOptions` requires `mode:'single'|'zip'`; it is never inferred. Only zip accepts `archiveName?:string`, default `aozora-markdown.zip`. `limits?:Partial<ExportLimits>` is optional. `ExportContext` has `signal?` and `onProgress?`. Progress snapshots use `validate`, `copy`, `package`, `close`, `delivery` as applicable and are never commits. Callback exceptions fail the whole job. Direct cancellation is cooperative at chunk/entry/close boundaries; synchronous allocation/library work cannot be interrupted immediately. `jobTimeoutMs` is the Browser preparation deadline, not a direct-runtime preemption guarantee.

| Result field | Meaning |
| --- | --- |
| contract / mode | `aozora-export-v1` / requested valid mode |
| status | `ready`, `failed`, `cancelled` |
| manifest | Ordered `{fileId,relativePath,format,byteLength}` selection, without body/ConversionResult; empty when preflight did not finish |
| diagnostics | `{code,severity:'error',stage,fileId?,reason}`, bounded categories without copied body or library exception text |
| metrics | Attempt measurements; `readyFiles` is set only after complete success |
| filename / mime / bytes | Present **only** on direct `ready`; all-or-nothing output, no partial ZIP |

For a malformed mode, validation fails with `INVALID_MODE`; the required mode field uses `single` as a structural fallback, never as a successful inference. MIME is exactly `text/markdown;charset=utf-8`, `text/plain;charset=utf-8`, or `application/zip`. Single filename is the relative path's basename; the manifest still retains its full original path.

### Export preflight and limits

All selected IDs, names, formats and byte lengths are checked before any payload copy, writer or Browser Worker starts. Paths must be canonical `/`-separated relative file paths. Absolute/drive/UNC/backslash paths, empty/`.`/`..` segments, trailing slash, C0/DEL/C1 controls, unpaired surrogates and nonmatching or uppercase extensions fail. Each segment must equal the existing generic R18 `sanitizeFilename` result, including its reserved-name, outside-whitespace/dot, forbidden-character, 100 code point and 240 UTF-8 byte constraints. The validated path itself is never replaced with a sanitized value. Supplementary and decomposed Unicode names are retained. Percent escapes are literal, never decoded.

Exact or `collisionKey` (NFC/lowercase/trailing space-dot) file collisions and file/parent-directory collisions fail, regardless of input order. Shared directory prefixes and equal basenames in different folders are valid. These portable comparisons do not establish OS identities or provide exclusive saving. ZIP archive names must be a safe basename ending in lowercase `.zip`, including the extension within the same 100 code point/240 byte budget. The generic sanitizer is used without casting `.zip` into its md/txt extension parameter.

| Export limit key | Default | Hard ceiling / boundary |
| --- | ---: | --- |
| maxFiles | 8,192 | 65,534; all selection metadata before copy/writer |
| maxFileBytes | 128 MiB | 0xfffffffe; each input before copy/read and during ZIP read |
| maxInputBytes | 128 MiB | 0xfffffffe; preflight sum and actual ZIP read |
| maxPathBytes | 4,096 UTF-8 bytes | 65,535; separate from segment limits |
| maxOutputBytes | 192 MiB | 0xfffffffe; single preflight and every ZIP chunk before retention, including headers/central/EOCD |
| jobTimeoutMs | 60,000 | Positive safe integer; Browser caller deadline through copy/Worker/Blob construction |

MiB = 1,048,576 bytes. Every setting must be a positive safe integer; omitted/`undefined` means default, while null, bad types, 0, negative, NaN and Infinity fail. Equality is allowed. Import and export budgets are separate; an accepted import artifact can fail an export limit with a new export diagnostic. Export ZIPs need not fit the default import input/entry limits.

Diagnostic codes include `INVALID_MODE`, `INVALID_LIMIT`, `NO_ARTIFACTS`, `SINGLE_FILE_COUNT`, `INVALID_FILE_ID`, `DUPLICATE_FILE_ID`, `INVALID_FORMAT`, `INVALID_BYTES`, `INVALID_ARCHIVE_NAME`, `UNSAFE_PATH`, `PATH_COLLISION`, `PATH_LIMIT`, `FILE_COUNT_LIMIT`, `FILE_BYTES_LIMIT`, `INPUT_BYTES_LIMIT`, `OUTPUT_BYTES_LIMIT`, `PROGRESS_FAILED`, `EXPORT_FAILED`, and `CANCELLED`. Browser preparation adds `INVALID_REQUEST_ID`, `WORKER_UNAVAILABLE`, `WORKER_FAILED`, `INVALID_WORKER_RESULT`, `DELIVERY_FAILED`, `BLOB_FAILED`, `JOB_TIMEOUT`.

### Fixed ZIP profile and memory accounting

Pinned zip.js **2.17.0** writes STORE (method 0), sequential awaited file additions in selection order, UTF-8 flags/names, DOS date/time `0x00210000` (1980-01-01 00:00:00), version-made-by `0x0314`, ordinary non-executable Unix mode `0100644`. `extendedTimestamp:false`, `ntfsTimestamp:false`, `zip64:false`, `bufferedWrite:false`, `keepOrder:true`, `dataDescriptor:true`, `dataDescriptorSignature:true`, `useUnicodeFileNames:true`, `level:0`, `useWebWorkers:false`, `useCompressionStream:false`, `preventClose:true` are explicit. Empty entries use the library's descriptor-free representation. No directory entries, extra artifacts, archive comment, input extra fields, encryption, split or self-extracting prefix are emitted. `rawLastModDate` fixes encoded time independent of local TZ/current time. Node/Chrome main/Worker and UTC/Asia-Tokyo determinism is tested for this version/profile; future library versions are not promised binary compatibility.

The writer uses a counted WritableStream, not a whole-archive Uint8ArrayWriter. Every chunk is counted before copying/retaining it; rejected chunks are never appended. Success explicitly closes/releases the owned sink. Failure aborts/releases it and discards the ZipWriter without invoking its salvage-capable `close()`. There is no ZipWriter abort API: `writersAborted` measures this discard plus owned-stream abort path. Export never calls global `configure()`, preserving import's 1 KiB compressed feed. Direct source-module coexistence and built-bundle order/parallelism are tested.

Metrics: `selectedFiles` and `inputBytes` record preflight observations; `processedBytes` counts actual ZIP input reads (single's completed copy), `copiedBytes` counts snapshot/copy work even on failure; `outputBytes`/`outputChunks` count offered writer chunks, including a rejected over-limit chunk. `retainedBytes` is published output storage (0 on failure), while `peakRetainedBytes` preserves the maximum retained output chunks, not a heap estimate. `entriesAdded`, `writersStarted`, `writersClosed`, `writersAborted` preserve attempts. `readyFiles` is 0 until complete publication. Browser termination reports the latest received Worker measurements, not proof that a killed Worker's finally block ran.

These finite byte budgets are **not JS heap ceilings**. Existing caller allocations cannot be prevented. Browser preparation copies only selected views into owned snapshots in 64 KiB steps with yields, then transfers those buffers; direct ZIP reads borrowed views in bounded chunks. Library stream queues/CRC buffers and central-directory metadata still allocate separately. Each output chunk is retained as a copy, final concatenation temporarily coexists with those chunks, transfer moves that final buffer, and Blob construction may allocate another copy. Single preparation uses one owned snapshot plus Blob storage. Multiple independent jobs each own their budgets and memory. No Worker pool, WASM/CDN/internal Worker or network fetch is needed.

## Browser export and explicit download

`aozora-markdown/browser/export` exports `prepareBrowserExport`, `createDownloadHandle`, `DOWNLOAD_URL_LIFETIME_MS` and their types. `aozora-markdown/export.worker.js` is the separate module Worker asset (`dist/adapters/browser/export.worker.js`). Both have minified variants and raw source maps. Existing browser import clients do not import the export writer; the browser export client itself also contains no ZIP writer.

`prepareBrowserExport(artifacts, options, context)` requires a nonblank `context.requestId`. ZIP also requires a caller-supplied `workerFactory:()=>Worker` or `workerUrl:string|URL` at runtime (factory takes precedence); each factory call must return a new trusted dedicated module Worker which the client owns and terminates. Single needs no Worker. Optional `signal`, `onProgress` and `createBlob(bytes,mime)` are supported. No Worker/URL/DOM operation occurs on module evaluation.

After full preflight the client copies only `fileId/relativePath/format/bytes`, never conversion/metadata/stale Blob. Only its owned snapshots are transferred. Signal/watchdog cover copy, Worker, and Blob receipt/construction (including a deadline check after synchronous work). Caller bytes remain attached for retry. Errors, timeout and cancel terminate the Worker, clear timers/listeners, expose no Blob and cannot be revived by duplicate/late messages. Request IDs, final contract/status/mode, ordered manifest, filename/MIME, byte type/length, metrics and limits are checked before Blob construction. A trusted factory is not permission to accept corrupt protocol results. There is no main-thread ZIP fallback.

`BrowserExportResult` has the same base fields and statuses as the direct result. Only `ready` has `blob`, `filename`, `mime`; it does not expose duplicate `bytes`. Ready means Blob preparation completed; all preparation resources are already released. It is not a download request or OS save.

```ts
import { prepareBrowserExport, createDownloadHandle } from 'aozora-markdown/browser/export';
import type { DownloadHandle } from 'aozora-markdown/browser/export';

// called by selection/preparation logic; not a download handler
let handle: DownloadHandle | undefined;
async function prepareSelected(delivered, selectedIds: ReadonlySet<string>) {
  if (delivered.result.status !== 'completed' && delivered.result.status !== 'partial') return;
  // Outer delivered.artifacts passed ALL Blob creation. result.artifacts are candidates.
  const selected = delivered.artifacts.filter(a => selectedIds.has(a.fileId));
  const prepared = await prepareBrowserExport(selected, { mode: 'zip' }, {
    requestId: crypto.randomUUID(),
    workerUrl: new URL('./dist/adapters/browser/export.worker.js', import.meta.url),
  });
  // Keep delivered.result.diagnostics and delivered.stats for partial imports.
  if (prepared.status === 'ready') {
    handle?.dispose(); // release a previous screen's handle when replacing it
    handle = createDownloadHandle(prepared.blob, prepared.filename);
    downloadButton.disabled = false;
  }
}
downloadButton.addEventListener('click', () => {
  const issued = handle?.request(); // synchronous; no await, Worker, fetch or popup
  // issued.status === 'requested' only means the request was issued.
});
function onScreenDestroyed() { handle?.dispose(); handle = undefined; }
```

This is an API example, not a product UI. Single preparation uses `{mode:'single'}` with one selected artifact and `{requestId}`; its download filename is the basename, not a promise to create folders. Re-download requires a **new** handle from the same ready Blob. Do not immediately call `request(); dispose()` in an ordinary click handler: that may revoke the URL before the browser consumes it. Disposing a previous requested handle during screen replacement has the same limitation and should follow the host's lifecycle policy.

`createDownloadHandle(blob, filename, host?)` validates Blob/safe md/txt/zip basename and creates no URL/anchor yet. State starts `ready` or `failed`. `request()` synchronously creates an object URL, sets anchor href/download properties, appends/clicks once, and removes the anchor in finally. No innerHTML, remote/data URL input, fake user activation, async wait or automatic click follows preparation. It returns `{status:'requested'}` or `{status:'failed',diagnostic}`. Each handle reserves at most one request; repeat calls return `ALREADY_REQUESTED`, and disposed handles return `DISPOSED`, without clicking. URL/anchor/click failures return `DOWNLOAD_FAILED` and release created resources; invalid input reports `INVALID_DOWNLOAD` on the handle.

After request the URL is retained for **60,000 ms**, then revoked and state becomes `disposed`. `dispose()` is idempotent, clears the timer, revokes a remaining URL at most once, and drops the handle's Blob reference. Before request it releases the ready Blob reference without creating anything. `DownloadHost` is a small optional DOM/URL/timer seam for tests or another document; it must implement native semantics. Fake-clock tests check 59,999/60,000 ms and explicit disposal; real Chrome acquisition tests independently verify downloads.

`requested` is never `saved`: the [download attribute](https://developer.mozilla.org/en-US/docs/Web/API/HTMLAnchorElement/download) does not report browser blocking, user cancellation/renaming, disk failure, overwrite or successful OS storage. Equal basename collisions on separate downloads belong to Browser/OS behavior. The [object URL release API](https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static) releases a resource; 60 seconds is this product's retention policy, not a completion observation or browser-wide guarantee. Background timer throttling may delay cleanup. Dispose does not promise to cancel an OS download. Playwright waiting for a download and saving test bytes is test-side evidence, not a capability of this public API.

Reproduce the export checks with `npm run export:check`, `npm run test:export-browser`, or `npm run verify`. Pages/PWA/service workers, Vault/filesystem writers, exclusive create/alias/race guarantees, output DEFLATE/ZIP64/encryption and original ZIP images are not implemented.

## Minimal Web application — aozora-web-v6

The separate `web/` application consumes public entry modules; it adds no package export or changes to existing contracts. `npm run dev:web` performs a fresh build and serves **http://127.0.0.1:4173/** until Ctrl+C. `npm run build:web` regenerates `web-dist/` including the import/export Worker bundles and the preview Worker. For a subpath test server:

```sh
node --input-type=module -e 'import {createWebServer} from "./scripts/serve-web.mjs"; console.log((await createWebServer({prefix:"/aozora-markdown/",port:4173})).url)'
```

Stop with Ctrl+C. Static hosting must serve JavaScript/module Workers with the correct MIME type over HTTP(S). No root-absolute asset URLs, network conversion service, browser storage, or main-thread conversion fallback are used. Unsupported hosts or missing Workers produce Japanese diagnostics. This is not a Pages deployment or a `file://` application.

`web/options.ts` maps `encoding`, `organizeByAuthor` and `outputExtension` at the import level; all 23 conversion settings are under `conversion`, with `headingLevels` as one nested object copied on every job snapshot. The UI model holds explicit booleans, including false. Disabled child controls (bouten mark, heading levels, preserve/approximation) keep their values and are sent unchanged. Limits are omitted and the adapter applies defaults. Defaults come from `DEFAULT_OPTIONS` and `DEFAULT_IMPORT_LIMITS`; the Web build extracts these constants from the freshly built public APIs without bundling unrelated converter/data registration into the main UI. Bouten is neither trimmed nor normalized; empty and supplementary characters reach the core unchanged. The `.md`/`.txt` radio changes only names, format and MIME, and the screen says so permanently. Changing it, like any conversion setting, invalidates the import result, so a ready result is never renamed in place. When the thirteen content parents are all off (computed from the parents alone, so an enabled child does not count), the screen states 「本文の変換なし。文字コードはUTF-8、改行はLFで出力します。」 and still allows import and download. Remaining notes are labelled 「未変換注記（OFFにした処理の注記を含む）」.

`web/catalog.ts` is the UI copy index: label, always-visible summary, supplemental detail, API field, and group for encoding, organize-by-author, every conversion field, and the main actions. The visible file count comes from the controller File list. A dedicated button opens the native picker; the hidden input is not the status display, not a tab stop, and not an announced control. Help is one shared popover. Only the explanation button opens it, by click, tap, Enter, or Space. The same button closes it immediately, another explanation button switches it, and a 15-second timer restarts on each open. Hover, focus, and moving the pointer onto the popover do not open or extend it. The popover opens directly below the explanation button, or directly above it when the area below is too short. Only its horizontal position is shifted to stay inside the viewport, and its height shrinks, with its own scrollbar, when vertical room is short. It may cover other buttons, labels, and fields. It does not cover the explanation button that opened it. A click outside the popover, including a control in the same setting, closes it without replacing that control's own action. Escape and hiding the explanation's control also close it. Opening or closing help emits only a help change: it does not edit settings, invalidate an import result, or start a Worker. A parent that is off disables the child input and still leaves the explanation button usable. The advanced-settings disclosure uses the native `details` element. At 900 CSS px and wider, each advanced group lays its controls out in two columns; narrower viewports, including 200% zoom at a 720 CSS px layout width, stay in one column.

`delivery` on the controller is `single` or `zip`. A new import result or a change of the output selection resets it: one artifact to single, more than one to zip. The same selection may then switch a single artifact to zip. That switch drops export preparation only. Busy or unavailable refuses the switch. Zero selected artifacts disable creation. The create button does not download; a later click calls `request()`. User-facing text treats that as a browser download request, not a confirmed OS save.

`Controller` in `web/controller.ts` is an internal UI controller, not a new library API. Its small service seam substitutes only import/export adapters for race tests. Selection generation and an increasing job token guard every progress/result/finally callback. A job snapshots input identity/order and settings. Only one import/export preparation runs at a time; controller guards supplement disabled controls. Cancel aborts the adapter, ignores late results, retains inputs/settings (and an already successful import during export cancellation). Clear additionally advances generation and drops File/result/ready-Blob references while preserving settings. Settings/input changes invalidate the import result; output selection changes invalidate only export preparation. Only outer `delivered.artifacts` from completed/partial import can be exported, in their original order.

The result summary displays authoritative `JobState.artifactFiles`, `errors`, and `remainingNotes`. Ignored input archives, ignored ZIP entries, and empty archives are separately labelled; these populations are never summed. Import diagnostics, conversion diagnostics, and remaining notes are distinct. Remaining-note line numbers refer to output lines (1-based); a conversion diagnostic range refers to original UTF-16 offsets. The summary never rescans or re-counts; the optional preview below is a separate view. Input/results/diagnostic/note lists use 50-item pages; selection and actual bytes remain complete.

Preparation (`prepareBrowserExport`) never requests a download. A later synchronous click creates a **new** `createDownloadHandle` from the ready Blob and calls `request()`. `Downloads` keeps at most eight outstanding requested handles, independent of the current File/result/ready-Blob state. Result invalidation/clear does not prematurely revoke issued URLs. The accepted adapter's 60-second timer disposes each handle; one UI tracking timer releases disposed references (first check just after the deadline, delayed callbacks recheck at one-second intervals). This observes resource state, never OS save completion. When no handle remains there is no tracking timer. A full manager refuses another request without revoking an old URL. Pagehide/app disposal aborts preparation, unregisters view listeners, clears the tracking timer, disposes issued handles, and drops references; pageshow recreates an initial controller after disposal, including bfcache restoration.

The UI does not promise download success, exclusive filesystem writes, persistence, all-browser/mobile compatibility, comprehensive accessibility certification, or memory usage bounded by the byte budgets. Unit tests use substituted adapters and fake clocks where noted; the Browser gates exercise the built UI in Chrome.

### Markdown preview — aozora-preview-v1

Each result row has a **プレビュー** button next to the warnings button. It opens one delivered artifact of the current result generation for reading before download. The source of truth is `delivered.artifacts[].bytes`, decoded as UTF-8 without normalization; `convertText`/`decodeTextBytes` are never re-run. `.md` and `.txt` artifacts use the same preview because both contain the same Markdown/Nyoze syntax. Opening, switching tabs or closing never changes the export selection, delivery, a ready Blob or issued URLs, and a preview failure is not an import/export failure. Tabs are **プレビュー** (reference rendering) and **出力テキスト** (the bytes as text, first 128 KiB cut on a UTF-8 boundary, with an explicit "not the full text" message when shortened). The プレビュー tab has a **横書き／縦書き** toggle (`aria-pressed`). The first view is horizontal. The choice is kept for later files on the same page and returns to horizontal on reload; it is not a conversion setting and is not stored. Changing the mode, or opening another file, scrolls that mode to its reading start. The source tab stays horizontal. Beside that toggle, **ゴシック／明朝** (`aria-pressed`) changes only the reading face (body, headings, ruby, emphasis marks, and tate-chu-yoko) in both directions. Code stays monospace and frontmatter keeps the information-panel gothic stack. The face is kept like the writing direction and returns to gothic on reload. A face-only change does not scroll back to the reading start. The long vertical operating guide is not always visible: while the preview tab is vertical, **縦書きの操作** opens that same text in the existing help popover (click, tap, Enter, or Space only; the same button, an outside click, Escape, 15 seconds, leaving vertical mode, the source tab, close, clear, result invalidation, and pagehide all close it). The reading surface uses `min(80dvh, 48rem)` with a `min(80vh, 48rem)` fallback. An informational note, without `aria-live`, sits under the introduction and above the privacy paragraph even when no file is selected. These display-only additions are the `aozora-web-v6` screen contract. They do not change `aozora-preview-v1`, package version 0.2.0, or download bytes. Fonts are OS stacks only. Mode changes do not re-parse, re-decode or rebuild the model; they apply CSS (`writing-mode: vertical-rl`) to the already-rendered DOM. Vertical TCY uses `text-combine-upright` on the existing `span.preview-tcy`. Frontmatter and fenced/indented code become horizontal islands inside the vertical surface. The preview is a reference display: it does not claim to match Nyoze, Typora or Obsidian, and there is no pagination or editing.

The parser is markdown-it **15.0.2** (exact pin), running only in a dedicated module Worker `preview.worker.js` (one Worker per request). The Worker returns a typed model (`web/preview/model.ts`), never HTML. The main thread checks the contract/requestId/generation, then validates the model strictly (known kinds and keys only, plain prototypes, numeric ranges, budgets) and builds DOM from a fixed element/class/attribute allowlist with `createElement`/`textContent`. No `a`, `img`, `script`, `style`, `iframe`, `object`, `embed`, `svg` or `math` elements, URL attributes, `style` attributes or `innerHTML` are created from content, so the preview makes no network request. Links are shown as a label plus the URL as text; images as alt text plus "画像は読み込みません" and the URL. Raw HTML stays visible as text, except the exact attribute-free `<u>…</u>`, which is underlined. There is no main-thread parsing fallback.

Supported display: headings h1–h6 (U+3000 preserved), paragraphs (single newlines shown as line breaks), strong/em, blockquotes, ordered/unordered lists, hr, inline/fenced/indented code (extension syntax inside code stays literal), explicit `｜base《reading》` and conservative kanji ruby (including the core's bouten output), `||text||` and exact `<u>` underline, `｟body｠` TCY (1–4 of `[A-Za-z0-9!?]`, side by side in horizontal mode with a `tcy-horizontal` notice; combined upright in vertical mode with a different notice), top-level non-nested `:::indent-1`…`:::indent-6`, `:::align-end` (a `:::` line inside fenced, indented or multi-line inline code never closes a block, an opener inside code never opens one, and an unclosed fence runs to the end of the document), `:::page-break` and `:::blank-page` (labelled separators, no blank space), and valid frontmatter as a separate field list with the raw text available. Invalid or unclosed frontmatter, tables, strikethrough, reference definitions, unconverted Aozora notes and malformed syntax are shown as literal text; preview notices are listed separately from conversion warnings and never change core diagnostics or counts.

| Budget | Value | When exceeded |
| --- | --- | --- |
| Input | 4 MiB of UTF-8 | No Worker, no copy; guidance to the source tab/download |
| Model nodes / depth / text | 20,000 / 64 / 2,097,152 UTF-16 units | Checked in the Worker, the validator and the DOM builder; nothing is partially shown |
| Watchdog | 5,000 ms including Worker start-up | `terminate()`; retry and source tab offered |
| Source tab | 128 KiB | First part only, labelled |

Only an owned copy of the bytes is transferred; the borrowed artifact is never detached. At most one preview job runs. Opening another file, closing, clear, result invalidation (input or conversion setting change) and pagehide terminate the Worker and drop the DOM; late results are ignored. Starting an import or export cancels a running preview, and new previews are refused until the job ends. These budgets bound display work, not heap usage; extreme input under 4 MiB can still time out. Reproduce the preview checks with `npm run test:s8-browser`, `npm run test:vp-browser`, and `npm run test:fui-browser`.
