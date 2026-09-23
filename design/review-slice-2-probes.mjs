import { deflateRawSync, inflateRawSync } from "node:zlib";
import { writeFile } from "node:fs/promises";
import { prepareImport } from "../dist/import/index.js";
const plain = {
  conversion: {
    addFrontmatter: false,
    removeAnnotationBlocks: false,
    removeAozoraFooter: false,
  },
};
function crc32(b) {
  let n = 0xffffffff;
  for (const x of b) {
    n ^= x;
    for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  }
  return (n ^ 0xffffffff) >>> 0;
}
function zip({
  body = Buffer.from("OK"),
  method = 8,
  payload = deflateRawSync(body),
  prefix = Buffer.alloc(0),
  diskEntries = 1,
  extra = Buffer.alloc(0),
  localExtra = extra,
  flags = 0,
} = {}) {
  const name = Buffer.from("a.txt");
  const lh = Buffer.alloc(30);
  lh.writeUInt32LE(0x04034b50);
  lh.writeUInt16LE(20, 4);
  lh.writeUInt16LE(flags, 6);
  lh.writeUInt16LE(method, 8);
  lh.writeUInt32LE(crc32(body), 14);
  lh.writeUInt32LE(payload.length, 18);
  lh.writeUInt32LE(body.length, 22);
  lh.writeUInt16LE(name.length, 26);
  lh.writeUInt16LE(localExtra.length, 28);
  const local = Buffer.concat([prefix, lh, name, localExtra, payload]);
  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50);
  cd.writeUInt16LE(0x0314, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(flags, 8);
  cd.writeUInt16LE(method, 10);
  cd.writeUInt32LE(crc32(body), 16);
  cd.writeUInt32LE(payload.length, 20);
  cd.writeUInt32LE(body.length, 24);
  cd.writeUInt16LE(name.length, 28);
  cd.writeUInt16LE(extra.length, 30);
  cd.writeUInt32LE(0o100644 * 65536, 38);
  cd.writeUInt32LE(prefix.length, 42);
  const central = Buffer.concat([cd, name, extra]);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50);
  e.writeUInt16LE(diskEntries, 8);
  e.writeUInt16LE(1, 10);
  e.writeUInt32LE(central.length, 12);
  e.writeUInt32LE(local.length, 16);
  return new Uint8Array(Buffer.concat([local, central, e]));
}
const cases = [];
cases.push(["valid-deflate", zip(), true]);
for (let n = 1; n <= 6; n++)
  cases.push([
    "prepended-rebased-" + n,
    zip({ prefix: Buffer.alloc(n, 0x41) }),
    false,
  ]);
for (const n of [0, 2, 65535])
  cases.push(["eocd-count-" + n, zip({ diskEntries: n }), false]);
const body = Buffer.from("HELLO");
const compressed = deflateRawSync(body);
for (let n = 1; n <= compressed.length; n++)
  cases.push([
    "truncated-deflate-" + n,
    zip({ body, payload: compressed.subarray(0, compressed.length - n) }),
    false,
  ]);
for (const trailer of [
  Buffer.from([0xff]),
  Buffer.from("JUNK"),
  deflateRawSync(Buffer.from("HIDDEN")),
])
  cases.push([
    "deflate-trailer-" + trailer.toString("hex"),
    zip({ body, payload: Buffer.concat([compressed, trailer]) }),
    false,
  ]);
// Stored deflate block with BFINAL cleared and no following final block.
const nonfinal = Buffer.from([0x00, 0x05, 0x00, 0xfa, 0xff, ...body]);
cases.push(["nonfinal-deflate-block", zip({ body, payload: nonfinal }), false]);
const out = [];
for (const [name, bytes, shouldPass] of cases) {
  const r = await prepareImport(
    [{ id: name, name: name + ".zip", kind: "zip", bytes }],
    plain,
  );
  const item = {
    name,
    expected: shouldPass ? "completed" : "failed",
    actual: r.status,
    artifacts: r.artifacts.map((a) => a.conversion.text),
    diagnostics: r.diagnostics,
    metrics: r.metrics,
  };
  out.push(item);
  console.log(
    JSON.stringify({
      name,
      expected: item.expected,
      actual: r.status,
      artifacts: item.artifacts,
      diagnostics: r.diagnostics,
    }),
  );
}
let native;
try {
  inflateRawSync(nonfinal);
  native = "accepted";
} catch (e) {
  native = e.code;
}
console.log("native-inflate-nonfinal", native);
await writeFile(
  "reports/review-slice-2-probes.json",
  JSON.stringify({ nativeNonfinal: native, cases: out }, null, 2) + "\n",
);
await writeFile(
  "reports/review-slice-2-inputs.json",
  JSON.stringify(
    cases.map(([name, bytes, shouldPass]) => ({
      name,
      bytes: [...bytes],
      shouldPass,
    })),
  ) + "\n",
);

const mismatches = out.filter((c) => c.actual !== c.expected);
console.log(
  JSON.stringify({
    cases: out.length,
    matched: out.length - mismatches.length,
    mismatches: mismatches.map((c) => c.name),
  }),
);
if (mismatches.length) process.exitCode = 1;
