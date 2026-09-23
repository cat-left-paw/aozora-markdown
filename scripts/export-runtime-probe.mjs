import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { prepareExport } from "../dist/export/index.js";
import { prepareImport } from "../dist/import/index.js";
import {
  exportArtifacts,
  runExportContract,
} from "../tests/browser/export-contract.mjs";
const result = await runExportContract(prepareExport);
const bytes = Buffer.from(result.zip);
if (process.argv.includes("--child"))
  process.stdout.write(bytes.toString("base64"));
else {
  const entries = exportArtifacts().map((a) => ({
    relativePath: a.relativePath,
    base64: Buffer.from(a.bytes).toString("base64"),
  }));
  const independent = spawnSync("python3", ["scripts/check_export_zip.py"], {
    input: JSON.stringify({ zip: bytes.toString("base64"), entries }),
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
    assert.equal(child.stdout, bytes.toString("base64"));
  }
  // Valid UTF-8 corpus for auxiliary import; opaque bytes above are intentionally not decoded.
  const ordinary = await prepareExport(
    [
      {
        fileId: "a",
        relativePath: "a.md",
        format: "md",
        bytes: new TextEncoder().encode("本文"),
      },
    ],
    { mode: "zip" },
  );
  assert.equal(ordinary.status, "ready");
  const imported = await prepareImport(
    [
      {
        id: "exported",
        kind: "zip",
        name: "exported.zip",
        bytes: ordinary.bytes,
      },
    ],
    { conversion: { addFrontmatter: false } },
  );
  assert.equal(imported.status, "completed");
  assert.equal(imported.artifacts.length, 1);
  const after = await prepareExport(exportArtifacts(), { mode: "zip" });
  assert.deepEqual(Buffer.from(after.bytes), bytes);
  const report = {
    contract: "aozora-export-v1",
    startedAt: new Date().toISOString(),
    node: process.version,
    passed: result.passed,
    cases: result.cases,
    metrics: result.metrics,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    independent: JSON.parse(independent.stdout),
    timezones: ["UTC", "Asia/Tokyo"],
    importInterop: true,
    completed: true,
  };
  // Prove old entry bundles remain writer-free / unchanged relative to the recorded baseline.
  const bundles = JSON.parse(
    await readFile("reports/bundle-sizes.json", "utf8"),
  );
  assert.ok(
    !bundles.entries.browser.inputs.some(
      (p) => p.includes("src/export/") || p.includes("zip.js"),
    ),
  );
  assert.ok(
    !bundles.entries.browserExport.inputs.some(
      (p) => p.includes("zip-writer") || p.includes("src/import/"),
    ),
  );
  report.runtimeAssets = (await readdir("dist", { recursive: true })).filter(
    (p) => /\.(js|wasm)$/.test(p),
  );
  await writeFile(
    "reports/export-runtime-probe.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
}
