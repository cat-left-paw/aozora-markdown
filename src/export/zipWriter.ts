import {
  ZipWriter,
  Uint8ArrayReader,
  type CreateReadableOptions,
} from "@zip.js/zip.js/lib/zip-core-native.js";
import {
  checkExportAbort,
  COPY_CHUNK_BYTES,
  ExportFailure,
  reportProgress,
  yieldExport,
} from "./limits.js";
import type {
  ExportArtifact,
  ExportContext,
  ExportLimits,
  ExportMetrics,
} from "./types.js";

// No configure(): import's private 1 KiB compressed feed must remain intact.
export const EXPORT_ZIP_SETTINGS = Object.freeze({
  level: 0,
  useWebWorkers: false,
  useCompressionStream: false,
  zip64: false,
  bufferedWrite: false,
  keepOrder: true,
  useUnicodeFileNames: true,
  dataDescriptor: true,
  dataDescriptorSignature: true,
  rawLastModDate: 0x00210000,
  extendedTimestamp: false,
  ntfsTimestamp: false,
  versionMadeBy: 0x0314,
  externalFileAttributes: 0o100644 * 65536,
  msDosCompatible: false,
  preventClose: true,
});
export async function writeExportZip(
  artifacts: readonly ExportArtifact[],
  limits: ExportLimits,
  context: ExportContext,
  metrics: ExportMetrics,
): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = [];
  let failure: unknown;
  const stream = new WritableStream<Uint8Array>({
    write(chunk) {
      try {
        checkExportAbort(context.signal);
        metrics.outputChunks++;
        metrics.outputBytes += chunk.byteLength;
        if (metrics.outputBytes > limits.maxOutputBytes)
          throw new ExportFailure(
            "OUTPUT_BYTES_LIMIT",
            "package",
            "writer-chunk-budget",
          );
        chunks.push(chunk.slice());
        metrics.retainedBytes += chunk.byteLength;
        metrics.peakRetainedBytes = Math.max(
          metrics.peakRetainedBytes,
          metrics.retainedBytes,
        );
      } catch (cause) {
        failure = cause;
        throw cause;
      }
    },
  });
  let closed = false;
  metrics.writersStarted++;
  try {
    const writer = new ZipWriter(stream, EXPORT_ZIP_SETTINGS);
    for (const artifact of artifacts) {
      reportProgress(context, "package", metrics);
      let fileRead = 0;
      class Input extends Uint8ArrayReader {
        override createReadable(
          options: CreateReadableOptions = {},
        ): ReadableStream<Uint8Array> {
          return super
            .createReadable({ ...options, chunkSize: COPY_CHUNK_BYTES })
            .pipeThrough(
              new TransformStream<Uint8Array, Uint8Array>({
                async transform(chunk, controller) {
                  checkExportAbort(context.signal);
                  fileRead += chunk.byteLength;
                  metrics.processedBytes += chunk.byteLength;
                  if (
                    fileRead > artifact.bytes.byteLength ||
                    fileRead > limits.maxFileBytes ||
                    metrics.processedBytes > limits.maxInputBytes
                  )
                    throw new ExportFailure(
                      "INPUT_BYTES_LIMIT",
                      "package",
                      "actual-read-budget",
                      artifact.fileId,
                    );
                  reportProgress(context, "package", metrics);
                  await yieldExport();
                  checkExportAbort(context.signal);
                  controller.enqueue(chunk);
                },
              }),
            );
        }
      }
      await writer.add(artifact.relativePath, new Input(artifact.bytes), {
        signal: context.signal,
      });
      checkExportAbort(context.signal);
      if (fileRead !== artifact.bytes.byteLength)
        throw new ExportFailure(
          "INVALID_BYTES",
          "package",
          "input-length-changed",
          artifact.fileId,
        );
      metrics.entriesAdded++;
    }
    reportProgress(context, "close", metrics);
    await yieldExport();
    checkExportAbort(context.signal);
    await writer.close();
    checkExportAbort(context.signal);
    const lock = stream.getWriter();
    try {
      await lock.close();
    } finally {
      lock.releaseLock();
    }
    closed = true;
    metrics.writersClosed++;
    const output = new Uint8Array(metrics.retainedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      checkExportAbort(context.signal);
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return output;
  } catch (cause) {
    throw failure ?? cause;
  } finally {
    if (!closed) {
      metrics.writersAborted++;
      const lock = stream.getWriter();
      try {
        await lock.abort();
      } catch {
        /* An errored sink is already stopped. */
      } finally {
        lock.releaseLock();
      }
    }
    chunks.length = 0;
  }
}
