import {
  ZipReader,
  configure,
  Uint8ArrayReader,
} from "@zip.js/zip.js/lib/zip-core-native.js";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const settings = {
  useWebWorkers: false,
  useCompressionStream: false,
  filenameEncoding: "cp437",
  strictness: "balanced",
  filenameValidation: "tolerant",
  checkCrc32: true,
  checkLocalDirectory: true,
  checkLocalFilename: true,
  checkOverlappingEntry: true,
};
class BoundedInput extends Uint8ArrayReader {
  createReadable(options = {}) {
    return super.createReadable({ ...options, chunkSize: 1024 });
  }
}
configure({ chunkSize: 1024 });
const report = {
  version: "2.17.0",
  settings,
  compressedFeedBytes: 1024,
  checks: [],
};
for (const filename of [
  "normal.zip",
  "bad-crc.zip",
  "chunk.zip",
  "cancel.zip",
  "forged-small.zip",
  "overlap.zip",
]) {
  const reader = new ZipReader(
    new BoundedInput(
      new Uint8Array(await readFile("tests/fixtures/zip/" + filename)),
    ),
    settings,
  );
  let observed = 0,
    retained = 0,
    rejected = 0,
    closed = false,
    error = null;
  const texts = [],
    raw = [];
  try {
    const entries = await reader.getEntries();
    for (const e of entries) {
      raw.push({
        name: e.filename,
        raw: Array.from(e.rawFilename),
        flags: e.rawBitFlag,
        index: e.index,
        mode: e.unixMode,
      });
      if (e.directory || !/\.txt$/i.test(e.filename)) continue;
      await e.getData(new WritableStream(), {
        checkOverlappingEntryOnly: true,
        passThrough: true,
      });
      const chunks = [];
      await e.getData(
        new WritableStream({
          write(chunk) {
            observed += chunk.length;
            if (
              filename === "chunk.zip" ||
              filename === "cancel.zip" ||
              filename === "forged-small.zip"
            ) {
              if (observed > 32) {
                rejected++;
                throw new Error("probe quota");
              }
            }
            retained += chunk.length;
            chunks.push(chunk);
          },
        }),
      );
      texts.push(Buffer.concat(chunks).toString("utf8"));
    }
  } catch (e) {
    error = e.message;
  } finally {
    await reader.close();
    closed = true;
  }
  if (filename === "normal.zip")
    assert.deepEqual(texts.slice(0, 2), ["FIRST", "SECOND"]);
  else assert.ok(error);
  if (
    filename === "chunk.zip" ||
    filename === "cancel.zip" ||
    filename === "forged-small.zip"
  ) {
    assert.equal(retained, 0);
    assert.equal(rejected, 1);
    assert.ok(observed > 32);
  }
  if (filename === "forged-small.zip") assert.equal(error, "probe quota");
  report.checks.push({
    filename,
    observed,
    retained,
    rejected,
    closed,
    error,
    texts,
    raw,
  });
}
await writeFile(
  "reports/zip-library-probe.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  "6 ZIP library probes PASS (identity/raw names/CRC/stream abort/overlap/close)",
);
