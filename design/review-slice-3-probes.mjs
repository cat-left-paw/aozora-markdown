// Independent review corpus: no production changes or regenerated expectations.
export function corpus() {
  return [
    ["空.txt", 0],
    ["著者/𠮷😀_converted.md", 1],
    ["別著者/e\u0301.md", 31],
    ["記号/[]{}();#$&'=+,%@.txt", 65535],
    ["区切\u2028文字/本文.md", 65536],
    ["folder/本文.txt", 65537],
    ["folder/続き.md", 131073],
  ].map(([relativePath, length], i) => {
    const backing = new Uint8Array(length + 23).fill(0xee);
    const bytes = backing.subarray(7, 7 + length);
    for (let n = 0; n < length; n++) bytes[n] = (n * 37 + i * 19) % 256;
    return {
      fileId: `review-${i}`,
      relativePath,
      format: relativePath.endsWith(".md") ? "md" : "txt",
      bytes,
    };
  });
}

export async function run(prepare, { sweep = false } = {}) {
  const checks = [];
  const check = (name, actual, expected) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw Error(
        name +
          ": " +
          JSON.stringify(actual) +
          " != " +
          JSON.stringify(expected),
      );
    checks.push(name);
  };
  const items = corpus();
  const before = items.map((a) => Array.from(a.bytes));
  const zip = await prepare(items, {
    mode: "zip",
    archiveName: "独立検証.zip",
  });
  check("corpus ready", zip.status, "ready");
  check(
    "manifest matches inputs",
    zip.manifest,
    items.map(({ bytes, ...a }) => ({ ...a, byteLength: bytes.length })),
  );
  check(
    "caller view and backing unchanged",
    items.map((a) => Array.from(a.bytes)),
    before,
  );
  check(
    "backing guards unchanged",
    items.map((a) => [
      new Uint8Array(a.bytes.buffer)[0],
      new Uint8Array(a.bytes.buffer).at(-1),
    ]),
    items.map(() => [238, 238]),
  );
  const exact = await prepare(items, {
    mode: "zip",
    limits: { maxOutputBytes: zip.bytes.length },
  });
  check("exact output budget ready", exact.status, "ready");
  check(
    "budget-independent bytes",
    Array.from(exact.bytes),
    Array.from(zip.bytes),
  );
  const low = await prepare(items, {
    mode: "zip",
    limits: { maxOutputBytes: zip.bytes.length - 1 },
  });
  check(
    "EOCD overflow unpublished",
    [
      low.status,
      low.diagnostics[0]?.code,
      "bytes" in low,
      low.metrics.retainedBytes,
      low.metrics.readyFiles,
    ],
    ["failed", "OUTPUT_BYTES_LIMIT", false, 0, 0],
  );
  check(
    "overflow attempt retained separately",
    low.metrics.outputBytes > low.metrics.peakRetainedBytes,
    true,
  );
  for (const a of items) {
    const single = await prepare([a], { mode: "single" });
    check("single ready " + a.fileId, single.status, "ready");
    check(
      "single view " + a.fileId,
      Array.from(single.bytes),
      Array.from(a.bytes),
    );
    single.bytes.fill(99);
    check(
      "single owns bytes " + a.fileId,
      Array.from(a.bytes),
      before[items.indexOf(a)],
    );
  }
  for (const paths of [
    ["é.md", "e\u0301.md"],
    ["A.md/b.txt", "a.md"],
    ["a.md", "A.md/b.txt"],
    ["ok.md", "x/../bad.md"],
    ["ok.md", "x\ud800.md"],
  ]) {
    const r = await prepare(
      paths.map((relativePath, i) => ({
        ...items[0],
        fileId: String(i),
        relativePath,
        format: relativePath.endsWith(".txt") ? "txt" : "md",
      })),
      { mode: "zip" },
    );
    check(
      "preflight " + JSON.stringify(paths),
      [r.status, r.metrics.writersStarted, r.metrics.copiedBytes, "bytes" in r],
      ["failed", 0, 0, false],
    );
  }
  if (sweep) {
    const tiny = [
      {
        fileId: "tiny",
        relativePath: "a.md",
        format: "md",
        bytes: new Uint8Array([0, 1, 255]),
      },
    ];
    const full = await prepare(tiny, { mode: "zip" });
    check("sweep baseline", full.status, "ready");
    for (
      let maxOutputBytes = 1;
      maxOutputBytes < full.bytes.length;
      maxOutputBytes++
    ) {
      const r = await prepare(tiny, {
        mode: "zip",
        limits: { maxOutputBytes },
      });
      check(
        "output budget " + maxOutputBytes,
        [
          r.status,
          r.diagnostics[0]?.code,
          "bytes" in r,
          r.metrics.readyFiles,
          r.metrics.retainedBytes,
          r.metrics.peakRetainedBytes <= maxOutputBytes,
          r.metrics.writersAborted,
        ],
        ["failed", "OUTPUT_BYTES_LIMIT", false, 0, 0, true, 1],
      );
    }
  }
  return { checks, zip: Array.from(zip.bytes), manifest: zip.manifest };
}

if (
  typeof process !== "undefined" &&
  process.argv[1]?.endsWith("review-slice-3-probes.mjs")
) {
  const { prepareExport } = await import("../dist/export/index.js");
  const { readFile, writeFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const { spawnSync } = await import("node:child_process");
  const { createServer } = await import("node:http");
  const { chromium } = await import("playwright");
  const assert = (await import("node:assert/strict")).default;
  const startedAt = new Date().toISOString();
  const node = await run(prepareExport, { sweep: true });
  const request = {
    zip: Buffer.from(node.zip).toString("base64"),
    entries: corpus().map((a) => ({
      path: a.relativePath,
      bytes: Buffer.from(a.bytes).toString("base64"),
    })),
  };
  const independent = spawnSync(
    "python3",
    [
      "-c",
      `
import sys,json,base64,io,zipfile,binascii
r=json.load(sys.stdin)
with zipfile.ZipFile(io.BytesIO(base64.b64decode(r['zip']))) as z:
 assert z.namelist()==[e['path'] for e in r['entries']]
 assert z.testzip() is None
 for info,e in zip(z.infolist(),r['entries']):
  b=base64.b64decode(e['bytes'])
  assert z.read(info)==b
  assert info.CRC==binascii.crc32(b) and info.compress_type==0
  assert info.flag_bits & 0x800
  assert info.date_time==(1980,1,1,0,0,0)
  assert info.external_attr==0o100644<<16 and not info.extra
print(json.dumps({'entries':len(r['entries']),'pass':True}))
`,
    ],
    { input: JSON.stringify(request), encoding: "utf8" },
  );
  assert.equal(independent.status, 0, independent.stderr);
  const base = "/independent/slice3/";
  const allowed = new Set([
    "design/review-slice-3-probes.mjs",
    "dist/export/index.js",
    "dist/adapters/browser/export.js",
    "dist/adapters/browser/export.worker.js",
  ]);
  const server = createServer(async (req, res) => {
    if (req.url === base) {
      res.setHeader("content-type", "text/html");
      res.end('<!doctype html><link rel="icon" href="data:,">');
      return;
    }
    const path = req.url?.startsWith(base) ? req.url.slice(base.length) : "";
    if (!allowed.has(path)) {
      res.writeHead(404).end();
      return;
    }
    try {
      res.setHeader("content-type", "text/javascript");
      res.end(await readFile(path));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}${base}`);
    const actual = await page.evaluate(async () => {
      const { run } = await import("./design/review-slice-3-probes.mjs");
      const { prepareExport } = await import("./dist/export/index.js");
      const { prepareBrowserExport } = await import(
        "./dist/adapters/browser/export.js"
      );
      let id = 0,
        started = 0,
        terminated = 0;
      const main = await run(prepareExport);
      const worker = await run(async (a, o) => {
        const r = await prepareBrowserExport(a, o, {
          requestId: `independent-${++id}`,
          workerFactory: () => {
            const w = new Worker(
              new URL(
                "./dist/adapters/browser/export.worker.js",
                location.href,
              ),
              { type: "module" },
            );
            started++;
            const end = w.terminate.bind(w);
            w.terminate = () => {
              terminated++;
              end();
            };
            return w;
          },
        });
        return r.status === "ready"
          ? { ...r, bytes: new Uint8Array(await r.blob.arrayBuffer()) }
          : r;
      });
      return { main, worker, started, terminated };
    });
    assert.deepEqual(actual.main.zip, node.zip);
    assert.deepEqual(actual.worker.zip, node.zip);
    assert.equal(actual.started, actual.terminated);
    assert.deepEqual(errors, []);
    const report = {
      startedAt,
      finishedAt: new Date().toISOString(),
      nodeChecks: node.checks.length,
      chrome: browser.version(),
      mainChecks: actual.main.checks.length,
      workerChecks: actual.worker.checks.length,
      workers: { started: actual.started, terminated: actual.terminated },
      independent: JSON.parse(independent.stdout),
      zipSha256: createHash("sha256")
        .update(Buffer.from(node.zip))
        .digest("hex"),
      checks: node.checks,
      passed: true,
    };
    await writeFile(
      "reports/review-slice-3-probes.json",
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify({ ...report, checks: undefined }));
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
