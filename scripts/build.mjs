import { build } from "esbuild";
import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
await mkdir("dist", { recursive: true });
await mkdir("reports", { recursive: true });
const entries = {
  core: ["src/index.ts", "dist/index.js"],
  encoding: ["src/encoding/index.ts", "dist/encoding/index.js"],
  policies: ["src/policies/index.ts", "dist/policies/index.js"],
};
entries.import = ["src/import/index.ts", "dist/import/index.js"];
entries.browser = [
  "src/adapters/browser/index.ts",
  "dist/adapters/browser/index.js",
];
entries.worker = [
  "src/adapters/browser/import.worker.ts",
  "dist/adapters/browser/import.worker.js",
];
entries.export = ["src/export/index.ts", "dist/export/index.js"];
entries.browserExport = [
  "src/adapters/browser/export.ts",
  "dist/adapters/browser/export.js",
];
entries.exportWorker = [
  "src/adapters/browser/export.worker.ts",
  "dist/adapters/browser/export.worker.js",
];
const report = {
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  entries: {},
};
for (const [name, [entry, outfile]] of Object.entries(entries)) {
  const raw = await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    charset: "utf8",
    sourcemap: true,
    metafile: true,
    legalComments: "external",
  });
  const minfile = outfile.replace(/\.js$/, ".min.js");
  await build({
    entryPoints: [entry],
    outfile: minfile,
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    charset: "utf8",
    minify: true,
    legalComments: "external",
  });
  const inputs = Object.keys(raw.metafile.inputs);
  const prohibited = inputs.filter((p) =>
    /^(?:node:|fs$|path$|electron|obsidian)/.test(p),
  );
  if (prohibited.length) throw new Error("Host imports: " + prohibited);
  if (
    name === "core" &&
    inputs.some((p) =>
      /src\/(encoding|policies|import|export|adapters)\//.test(p),
    )
  )
    throw new Error("Main core imported another entry");
  const bytes = await readFile(outfile),
    min = await readFile(minfile);
  report.entries[name] = {
    rawBytes: bytes.length,
    minifiedBytes: min.length,
    gzipRawBytes: gzipSync(bytes, { level: 9 }).length,
    gzipMinifiedBytes: gzipSync(min, { level: 9 }).length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    inputs,
  };
}
await cp("notices", "dist/notices", { recursive: true });
await cp("LICENSE", "dist/LICENSE");
await writeFile(
  "reports/bundle-sizes.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    Object.fromEntries(
      Object.entries(report.entries).map(([k, v]) => [
        k,
        {
          raw: v.rawBytes,
          minified: v.minifiedBytes,
          gzip: v.gzipMinifiedBytes,
        },
      ]),
    ),
  ),
);
