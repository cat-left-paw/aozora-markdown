// Independent follow-up evidence. Uses fixed Python-produced ZIPs and explicit
// binary mutations; expected results never come from the product runtime.
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { resolve, sep } from "node:path";
import { chromium } from "playwright";
import { prepareImport } from "../dist/import/index.js";
const plain = {
  conversion: {
    addFrontmatter: false,
    removeAnnotationBlocks: false,
    removeAozoraFooter: false,
  },
};
const base = await readFile("tests/fixtures/zip/prefix-rebased-0.zip");
const zip64 = await readFile("tests/fixtures/zip/zip64-end-record.zip");
const cases = [];
const add = (name, bytes, shouldPass, body = shouldPass ? ["OK"] : []) =>
  cases.push({ name, bytes: [...bytes], shouldPass, body });
add("ordinary-store", base, true);
add("empty", await readFile("tests/fixtures/zip/empty.zip"), true, []);
add("zip64-count-sentinels", zip64, true);
for (const disk of [0, 1, 2])
  for (const mode of ["size", "offset", "both"]) {
    const bytes = Buffer.from(zip64),
      e = bytes.length - 22;
    bytes.writeUInt16LE(disk, e + 8);
    bytes.writeUInt16LE(1, e + 10);
    if (mode === "size" || mode === "both")
      bytes.writeUInt32LE(0xffffffff, e + 12);
    if (mode === "offset" || mode === "both")
      bytes.writeUInt32LE(0xffffffff, e + 16);
    add(`zip64-disk-${disk}-${mode}`, bytes, disk === 1);
  }
function commented(comment) {
  const bytes = Buffer.concat([base, comment]);
  bytes.writeUInt16LE(comment.length, base.length - 2);
  return bytes;
}
add("comment-plain", commented(Buffer.from("Archive comment")), true);
add(
  "comment-signature-only",
  commented(Buffer.from([0x50, 0x4b, 0x05, 0x06])),
  true,
);
for (const [prefix, suffix] of [
  [0, 0],
  [3, 0],
  [0, 7],
]) {
  const fake = Buffer.alloc(22);
  fake.writeUInt32LE(0x06054b50);
  fake.writeUInt16LE(1, 8);
  fake.writeUInt16LE(1, 10);
  fake.writeUInt32LE(1, 12);
  fake.writeUInt16LE(suffix, 20);
  // Both supposed CD positions point away from a CD signature. This byte pattern
  // in the comment cannot be a second valid end record for the actual archive.
  add(
    `comment-unreachable-${prefix}-${suffix}`,
    commented(
      Buffer.concat([Buffer.alloc(prefix, 65), fake, Buffer.alloc(suffix, 65)]),
    ),
    true,
  );
}
{
  const bytes = Buffer.from(zip64),
    record = bytes.length - 22 - 20 - 56;
  bytes.writeBigUInt64LE(0n, record + 24);
  add("zip64-record-count-mismatch", bytes, false);
}
{
  const bytes = Buffer.from(zip64),
    locator = bytes.length - 22 - 20;
  bytes.writeUInt32LE(0, locator);
  add("zip64-locator-missing", bytes, false);
}
{
  const bytes = Buffer.from(zip64),
    locator = bytes.length - 22 - 20;
  bytes.writeBigUInt64LE(9007199254740992n, locator + 8);
  add("zip64-locator-unsafe", bytes, false);
}
// A second candidate that actually points at the real central directory remains
// an ambiguity error; preserving valid comment data must not weaken this check.
add(
  "comment-real-ambiguity",
  commented(base.subarray(base.length - 22)),
  false,
);
const snapshot = (r) => ({
  status: r.status,
  bodies: r.artifacts.map((a) => a.conversion.text),
  diagnostics: r.diagnostics,
  payloadReads: r.metrics.payloadReads,
  conversions: r.metrics.conversions,
  closed: r.metrics.readersClosed === r.metrics.readersOpened,
});
const node = [];
for (const c of cases) {
  const r = await prepareImport(
    [
      {
        id: c.name,
        name: c.name + ".zip",
        kind: "zip",
        bytes: new Uint8Array(c.bytes),
      },
    ],
    plain,
  );
  node.push({ name: c.name, ...snapshot(r) });
}
const root = resolve("."),
  server = createServer(async (req, res) => {
    try {
      if (req.url === "/review/") {
        res.setHeader("content-type", "text/html");
        res.end(
          '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,">',
        );
        return;
      }
      if (!req.url.startsWith("/review/")) throw Error();
      const path = resolve(
        root,
        decodeURIComponent(req.url.slice("/review/".length)),
      );
      if (!path.startsWith(root + sep)) throw Error();
      res.setHeader("content-type", "text/javascript");
      res.end(await readFile(path));
    } catch {
      res.writeHead(404).end();
    }
  });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:" + server.address().port + "/review/");
  const surfaces = await page.evaluate(
    async ({ cases, plain }) => {
      const { prepareImport } = await import("./dist/import/index.js");
      const { importFiles } = await import("./dist/adapters/browser/index.js");
      const snapshot = (r) => ({
        status: r.status,
        bodies: r.artifacts.map((a) => a.conversion.text),
        diagnostics: r.diagnostics,
        payloadReads: r.metrics.payloadReads,
        conversions: r.metrics.conversions,
        closed: r.metrics.readersClosed === r.metrics.readersOpened,
      });
      const out = [];
      for (const c of cases) {
        const input = {
          id: c.name,
          name: c.name + ".zip",
          kind: "zip",
          bytes: new Uint8Array(c.bytes),
        };
        const main = await prepareImport([input], plain);
        const delivered = await importFiles(
          [{ id: c.name, file: new File([input.bytes], input.name) }],
          plain,
          {
            requestId: c.name,
            attemptId: "recheck-1",
            workerUrl: new URL(
              "./dist/adapters/browser/import.worker.js",
              location.href,
            ),
          },
        );
        out.push({
          name: c.name,
          main: snapshot(main),
          worker: {
            ...snapshot(delivered.result),
            blobs: await Promise.all(
              delivered.artifacts.map((a) => a.blob.text()),
            ),
            artifactFiles: delivered.stats.artifactFiles,
            remainingNotes: delivered.stats.remainingNotes,
            savedFiles: delivered.stats.savedFiles,
          },
        });
      }
      return out;
    },
    { cases, plain },
  );
  const results = cases.map((c, i) => {
    const surfacesForCase = {
      node: node[i],
      main: surfaces[i].main,
      worker: surfaces[i].worker,
    };
    const expected = {
      status: c.shouldPass ? "completed" : "failed",
      bodies: c.body,
    };
    const checks = Object.fromEntries(
      Object.entries(surfacesForCase).map(([surface, s]) => [
        surface,
        s.status === expected.status &&
          JSON.stringify(s.bodies) === JSON.stringify(c.body) &&
          s.closed &&
          (c.shouldPass || (s.payloadReads === 0 && s.conversions === 0)),
      ]),
    );
    const w = surfacesForCase.worker;
    checks.worker =
      checks.worker &&
      JSON.stringify(w.blobs) === JSON.stringify(c.body) &&
      w.artifactFiles === c.body.length &&
      w.savedFiles === 0 &&
      w.remainingNotes === 0;
    return { name: c.name, expected, ...surfacesForCase, checks };
  });
  const summary = {
    cases: results.length,
    passed: results.filter((r) => Object.values(r.checks).every(Boolean))
      .length,
    mismatches: results
      .filter((r) => Object.values(r.checks).some((p) => !p))
      .map((r) => r.name),
  };
  await writeFile(
    "reports/review-slice-2-recheck-inputs.json",
    JSON.stringify(cases, null, 2) + "\n",
  );
  await writeFile(
    "reports/review-slice-2-recheck.json",
    JSON.stringify(
      { chrome: browser.version(), summary, cases: results },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify(summary));
  if (summary.mismatches.length) process.exitCode = 1;
} finally {
  await browser?.close();
  await new Promise((r) => server.close(r));
}
