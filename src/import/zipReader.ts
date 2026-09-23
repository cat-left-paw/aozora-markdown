import {
  ZipReader,
  configure,
  Uint8ArrayReader,
  type FileEntry,
  type Entry,
  type ArchiveWarning,
  type CreateReadableOptions,
} from "@zip.js/zip.js/lib/zip-core-native.js";
import {
  validateZipEntry,
  type ValidatedZipEntry,
} from "../policies/zipPaths.js";
import { basicFilename, unicodeFilename } from "./filenameDecoding.js";
import { validateZipStructure } from "./zipStructure.js";
import {
  ImportFailure,
  checkAbort,
  checkLimit,
  fileId,
  inputKind,
} from "./limits.js";
import type {
  ImportInput,
  ImportLimits,
  ImportMetrics,
  ImportContext,
  ImportOutcome,
  ImportDiagnostic,
} from "./types.js";
export const ZIP_SETTINGS = Object.freeze({
  useWebWorkers: false,
  useCompressionStream: false,
  filenameEncoding: "cp437",
  strictness: "balanced" as const,
  filenameValidation: "tolerant" as const,
  checkCrc32: true,
  checkLocalDirectory: true,
  checkLocalFilename: true,
  checkOverlappingEntry: true,
  // Do not let the library's heuristic or lossy Unicode Path decoder choose a name.
  decodeText: (bytes: Uint8Array, encoding: string, type: string) =>
    type === "filename" ? basicFilename(bytes, false) : "",
});
// The bundled JS codec can enqueue all output for ONE compressed input chunk
// synchronously. Limit that feed separately from its 64 KiB output chunks; do not
// allow a default 64 KiB compressed read to inflate tens of MiB ahead of quota.
const COMPRESSED_FEED_BYTES = 1024;
// zip.js rechunks before the codec too. Configure this private bundled copy,
// otherwise a bounded Reader alone would be merged back into 64 KiB feeds.
configure({ chunkSize: COMPRESSED_FEED_BYTES });
class BoundedZipInput extends Uint8ArrayReader {
  constructor(
    bytes: Uint8Array,
    private metrics: ImportMetrics,
  ) {
    super(bytes);
  }
  override createReadable(
    options: CreateReadableOptions = {},
  ): ReadableStream<Uint8Array> {
    return super
      .createReadable({ ...options, chunkSize: COMPRESSED_FEED_BYTES })
      .pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform: (chunk, controller) => {
            this.metrics.compressedBytesRead += chunk.length;
            controller.enqueue(chunk);
          },
        }),
      );
  }
}
export interface ReadableZipEntry {
  entry: Entry;
  validated: ValidatedZipEntry;
  outcome: ImportOutcome;
}
function warningsSafe(warnings: readonly ArchiveWarning[] = []): void {
  for (const warning of warnings) {
    if (
      ![
        "duplicate filename",
        "unsorted central directory",
        "malformed extra field",
      ].includes(warning.reason)
    )
      throw new ImportFailure(
        "ZIP_AMBIGUOUS",
        "structure",
        "unit",
        warning.reason,
      );
  }
}
// Directory entries also expose getData at runtime in pinned 2.17.0; the published
// union omits it. Narrow by capability rather than casting raw bytes/library objects
// into public contracts. Only internal calls use this method.
function readable(entry: Entry): FileEntry["getData"] {
  if (!("getData" in entry) || typeof entry.getData !== "function")
    throw new ImportFailure(
      "ZIP_UNSUPPORTED",
      "structure",
      "unit",
      "entry-reader-unavailable",
    );
  return entry.getData.bind(entry) as FileEntry["getData"];
}
export async function withZip(
  input: ImportInput,
  limits: ImportLimits,
  metrics: ImportMetrics,
  context: ImportContext,
  outcomes: ImportOutcome[],
  diagnostics: ImportDiagnostic[],
  consume: (
    entries: ReadableZipEntry[],
    read: (entry: ReadableZipEntry) => Promise<Uint8Array>,
  ) => Promise<void>,
): Promise<void> {
  const reader = new ZipReader(
    new BoundedZipInput(input.bytes, metrics),
    ZIP_SETTINGS,
  );
  metrics.readersOpened++;
  const records: ReadableZipEntry[] = [];
  let activeIndex: number | undefined;
  try {
    for await (const entry of reader.getEntriesGenerator()) {
      checkAbort(context.signal);
      const index = records.length;
      activeIndex = index;
      const outcome: ImportOutcome = {
        inputId: input.id,
        entryIndex: index,
        fileId: fileId(input.id, index),
        kind: "ignored",
        status: "discarded",
        zipName: {
          rawBytes: entry.rawFilename.slice(),
          flags: entry.rawBitFlag ?? 0,
          entryIndex: index,
          offset: entry.offset,
          compressedBytes: entry.compressedSize,
          declaredBytes: entry.uncompressedSize,
          unixMode: entry.unixMode,
        },
      };
      outcomes.push(outcome);
      metrics.zipEntries++;
      checkLimit(
        metrics.zipEntries,
        limits.totalEntries,
        "totalEntries",
        "batch",
        "metadata",
      );
      checkLimit(
        index + 1,
        limits.archiveEntries,
        "archiveEntries",
        "unit",
        "metadata",
      );
      checkLimit(
        entry.rawFilename.length,
        limits.filenameBytes,
        "filenameBytes",
        "unit",
        "metadata",
      );
      const flags = entry.rawBitFlag;
      if (
        flags === undefined ||
        flags & ~0x080e ||
        entry.encrypted ||
        entry.diskNumberStart !== 0
      )
        throw new ImportFailure(
          "ZIP_UNSUPPORTED",
          "metadata",
          "unit",
          "encryption-disk-or-flags",
        );
      for (const n of [
        entry.offset,
        entry.compressedSize,
        entry.uncompressedSize,
      ])
        if (!Number.isSafeInteger(n) || n < 0)
          throw new ImportFailure(
            "ZIP_INVALID_SIZE",
            "metadata",
            "unit",
            "unsafe-size-or-offset",
          );
      metrics.declaredBytes += entry.uncompressedSize;
      checkLimit(
        metrics.declaredBytes,
        limits.declaredBytes,
        "declaredBytes",
        "batch",
        "metadata",
      );
      const basic = basicFilename(entry.rawFilename, !!(flags & 0x800));
      const adopted = unicodeFilename(
        entry.rawFilename,
        entry.rawExtraField,
        basic,
      );
      outcome.status = "ignored";
      outcome.zipName!.basicName = basic;
      outcome.zipName!.adoptedName = adopted.name;
      if (adopted.warning)
        diagnostics.push({
          code: "ZIP_UNICODE_PATH_IGNORED",
          severity: "warning",
          stage: "metadata",
          inputId: input.id,
          entryIndex: index,
          reason: adopted.warning,
        });
      const validation = validateZipEntry({
        archiveId: input.id,
        centralDirectoryIndex: index,
        rawName: basic,
        decodedName: adopted.name,
        isDirectory:
          ((entry.unixMode ?? entry.unixExternalUpper ?? 0) & 0xf000) ===
            0x4000 ||
          (entry.msDosCompatible &&
            !!((entry.msdosAttributesRaw ?? 0) & 0x10)) ||
          /[\\/]$/u.test(adopted.name),
        isSymlink: entry.symlink,
        unixMode: entry.unixMode,
      });
      if (!validation.ok) {
        outcome.status = "failed";
        throw new ImportFailure(
          validation.code,
          "metadata",
          "unit",
          validation.reason,
        );
      }
      const kind = inputKind(validation.entry.relativeName);
      if (!validation.entry.isDirectory && (kind === "txt" || kind === "md")) {
        outcome.kind = kind;
        outcome.status = "discarded";
        checkLimit(
          entry.uncompressedSize,
          limits.textBytes,
          "textBytes",
          "unit",
          "metadata",
        );
        if (![0, 8].includes(entry.compressionMethod))
          throw new ImportFailure(
            "ZIP_UNSUPPORTED",
            "metadata",
            "unit",
            "compression-method",
          );
      }
      records.push({ entry, validated: validation.entry, outcome });
      context.onProgress?.({
        stage: "enumerating",
        inputId: input.id,
        entryIndex: index,
        metrics: { ...metrics },
      });
    }
    activeIndex = undefined;
    validateZipStructure(
      input.bytes,
      records.map((record) => record.entry.offset),
      reader.comment.length,
    );
    warningsSafe(reader.warnings);
    // Validate ranges and local headers before reading ANY supported payload.
    for (const record of records) {
      activeIndex = record.outcome.entryIndex;
      checkAbort(context.signal);
      const metadataSink = new WritableStream();
      try {
        await readable(record.entry)(metadataSink, {
          checkOverlappingEntryOnly: true,
          passThrough: true,
          signal: context.signal,
        });
      } finally {
        await metadataSink.close();
      }
      const local = record.entry.localDirectory;
      if (
        !local ||
        local.rawBitFlag !== record.entry.rawBitFlag ||
        (!local.bitFlag.dataDescriptor &&
          (local.crc32 !== record.entry.crc32 ||
            local.compressedSize !== record.entry.compressedSize ||
            local.uncompressedSize !== record.entry.uncompressedSize))
      )
        throw new ImportFailure(
          "ZIP_HEADER_MISMATCH",
          "structure",
          "unit",
          "local-central-fields",
        );
      // Unicode Path is optional in local headers; when present and valid it
      // must not introduce an unsafe or contradictory alternate path.
      const localName = unicodeFilename(
        record.entry.rawFilename,
        local.rawExtraField,
        record.outcome.zipName!.basicName!,
      );
      if (
        localName.warning &&
        !diagnostics.some(
          (d) =>
            d.inputId === input.id &&
            d.entryIndex === record.outcome.entryIndex &&
            d.reason === localName.warning,
        )
      )
        diagnostics.push({
          code: "ZIP_UNICODE_PATH_IGNORED",
          severity: "warning",
          stage: "structure",
          inputId: input.id,
          entryIndex: record.outcome.entryIndex,
          reason: "local-" + localName.warning,
        });
      if (!localName.warning) {
        const validation = validateZipEntry({
          archiveId: input.id,
          centralDirectoryIndex: record.outcome.entryIndex!,
          rawName: record.outcome.zipName!.basicName!,
          decodedName: localName.name,
        });
        if (!validation.ok)
          throw new ImportFailure(
            validation.code,
            "structure",
            "unit",
            validation.reason,
          );
        if (
          localName.name !== record.outcome.zipName!.basicName &&
          localName.name !== record.outcome.zipName!.adoptedName
        )
          throw new ImportFailure(
            "ZIP_HEADER_MISMATCH",
            "structure",
            "unit",
            "local-unicode-path",
          );
      }
      if (local.bitFlag.dataDescriptor) {
        const descriptor = local.dataDescriptor;
        if (
          !descriptor ||
          descriptor.crc32 !== record.entry.crc32 ||
          descriptor.compressedSize !== record.entry.compressedSize ||
          descriptor.uncompressedSize !== record.entry.uncompressedSize ||
          (local.crc32 !== 0 && local.crc32 !== record.entry.crc32) ||
          (local.compressedSize !== 0 &&
            local.compressedSize !== record.entry.compressedSize) ||
          (local.uncompressedSize !== 0 &&
            local.uncompressedSize !== record.entry.uncompressedSize)
        )
          throw new ImportFailure(
            "ZIP_HEADER_MISMATCH",
            "structure",
            "unit",
            "data-descriptor-fields",
          );
      }
      const descriptorBytes = local.bitFlag.dataDescriptor
        ? (record.entry.extraFieldZip64 ? 20 : 12) +
          (local.dataDescriptor?.signature ? 4 : 0)
        : 0;
      if (
        reader.directoryOffset === undefined ||
        !Number.isSafeInteger(reader.directoryOffset) ||
        local.dataOffset + record.entry.compressedSize + descriptorBytes >
          reader.directoryOffset
      )
        throw new ImportFailure(
          "ZIP_HEADER_MISMATCH",
          "structure",
          "unit",
          "payload-overlaps-central-directory",
        );
      warningsSafe(record.entry.warnings);
    }
    await consume(records, async (record) => {
      activeIndex = record.outcome.entryIndex;
      checkAbort(context.signal);
      metrics.payloadReads++;
      const chunks: Uint8Array[] = [];
      let length = 0;
      const writer = new WritableStream<Uint8Array>({
        write(chunk) {
          checkAbort(context.signal);
          length += chunk.length;
          metrics.expandedBytes += chunk.length;
          try {
            checkLimit(
              metrics.expandedBytes,
              limits.expandedBytes,
              "expandedBytes",
              "batch",
              "read",
            );
            checkLimit(length, limits.textBytes, "textBytes", "unit", "read");
          } catch (error) {
            metrics.rejectedChunks++;
            throw error;
          }
          chunks.push(chunk.slice());
          metrics.retainedExpandedBytes += chunk.length;
          context.onProgress?.({
            stage: "reading",
            inputId: input.id,
            entryIndex: record.outcome.entryIndex,
            metrics: { ...metrics },
          });
          checkAbort(context.signal);
        },
      });
      let succeeded = false;
      try {
        await readable(record.entry)(writer, {
          signal: context.signal,
          preventClose: true,
        });
        succeeded = true;
      } finally {
        // Own the final stream operation so even the zip.js close path cannot
        // retain a writer lock. pipeTo has released its lock when getData settles.
        const handle = writer.getWriter();
        try {
          if (succeeded) {
            await handle.close();
            metrics.payloadStreamsClosed++;
          } else {
            await handle.abort();
            metrics.payloadStreamsAborted++;
          }
        } finally {
          handle.releaseLock();
        }
      }
      checkAbort(context.signal);
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return bytes;
    });
  } catch (cause) {
    const error =
      cause instanceof ImportFailure
        ? cause
        : new ImportFailure(
            "ZIP_INVALID",
            "read",
            "unit",
            "invalid-structure-or-data",
          );
    error.entryIndex = activeIndex;
    const failed = outcomes.find(
      (o) => o.inputId === input.id && o.entryIndex === activeIndex,
    );
    if (failed && activeIndex !== undefined) {
      failed.status = "failed";
      failed.reason = error.code;
    }
    throw error;
  } finally {
    await reader.close();
    metrics.readersClosed++;
  }
}
