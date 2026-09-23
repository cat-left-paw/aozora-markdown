import {
  ZipWriter,
  Uint8ArrayReader,
} from "@zip.js/zip.js/lib/zip-core-native.js";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const settings = {
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
};
const entries = [
  {
    relativePath: "著者/題😀.md",
    base64: Buffer.from([239, 187, 191, 0, 13, 10, 255]).toString("base64"),
  },
  { relativePath: "空.txt", base64: "" },
  {
    relativePath: "e\u0301_converted2.md",
    base64: Buffer.from("abc").toString("base64"),
  },
];
async function make(limit = Infinity) {
  let retained = 0,
    attempted = 0;
  const chunks = [];
  const stream = new WritableStream({
    write(c) {
      attempted += c.length;
      if (retained + c.length > limit) throw Error("budget");
      retained += c.length;
      chunks.push(c.slice());
    },
  });
  const writer = new ZipWriter(stream, settings);
  try {
    for (const e of entries)
      await writer.add(
        e.relativePath,
        new Uint8ArrayReader(Buffer.from(e.base64, "base64")),
      );
    await writer.close();
    const lock = stream.getWriter();
    try {
      await lock.close();
    } finally {
      lock.releaseLock();
    }
    return { bytes: Buffer.concat(chunks), retained, attempted };
  } catch {
    const lock = stream.getWriter();
    try {
      await lock.abort();
    } finally {
      lock.releaseLock();
    }
    return { retained, attempted, failed: true };
  }
}
const output = await make();
if (process.argv.includes("--child")) {
  process.stdout.write(output.bytes.toString("base64"));
} else {
  const provenance = JSON.parse(
    await readFile("notices/zip-provenance.json", "utf8"),
  );
  const installed = JSON.parse(
    await readFile("node_modules/@zip.js/zip.js/package.json", "utf8"),
  );
  assert.equal(installed.version, "2.17.0");
  assert.equal(
    createHash("sha256")
      .update(
        await readFile("node_modules/@zip.js/zip.js/lib/core/zip-writer.js"),
      )
      .digest("hex"),
    provenance.exportProfile.writerSourceSha256,
  );
  assert.equal(
    createHash("sha256")
      .update(await readFile("notices/zip.js-source-notices.txt"))
      .digest("hex"),
    provenance.sourceNoticesSha256,
  );
  const independent = spawnSync("python3", ["scripts/check_export_zip.py"], {
    input: JSON.stringify({ zip: output.bytes.toString("base64"), entries }),
    encoding: "utf8",
  });
  assert.equal(independent.status, 0, independent.stderr);
  for (const TZ of ["UTC", "Asia/Tokyo"]) {
    const child = spawnSync(
      process.execPath,
      [import.meta.filename, "--child"],
      { env: { ...process.env, TZ }, encoding: "utf8" },
    );
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout, output.bytes.toString("base64"));
  }
  const limited = await make(output.bytes.length - 1);
  assert.equal(limited.failed, true);
  assert.ok(limited.retained < limited.attempted);
  assert.ok(limited.retained <= output.bytes.length - 1);
  await mkdir("reports", { recursive: true });
  const report = {
    settings,
    entries,
    sha256: createHash("sha256").update(output.bytes).digest("hex"),
    bytes: output.bytes.length,
    limited,
    independent: JSON.parse(independent.stdout),
    timezones: ["UTC", "Asia/Tokyo"],
  };
  await writeFile(
    "reports/export-library-probe.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
}
