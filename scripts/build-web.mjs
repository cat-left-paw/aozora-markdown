import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import {
  readFile,
  writeFile,
  mkdir,
  rm,
  copyFile,
  readdir,
} from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
// A standalone web build always refreshes both public adapters and Worker assets.
const fresh = spawnSync("npm", ["run", "build"], { stdio: "inherit" });
if (fresh.status !== 0) process.exit(fresh.status ?? 1);
const { DEFAULT_OPTIONS, CONTENT_OPTION_KEYS } = await import(
  "../dist/index.js"
);
const { DEFAULT_IMPORT_LIMITS } = await import("../dist/import/index.js");
// Read constants from freshly built public APIs. Avoid importing their unrelated
// codec/data registration side effects into the UI just to display defaults.
const publicDefaults = {
  name: "public-defaults",
  setup(builder) {
    builder.onResolve(
      { filter: /^\.\.\/src\/(?:index|import\/index)\.js$/ },
      (args) =>
        args.importer.endsWith("/web/options.ts")
          ? { path: args.path, namespace: "public-defaults" }
          : undefined,
    );
    builder.onLoad({ filter: /.*/, namespace: "public-defaults" }, () => ({
      // Deep freeze: DEFAULT_OPTIONS.headingLevels is a nested object.
      contents: `const f=(o)=>{for(const v of Object.values(o))if(v&&typeof v==="object")f(v);return Object.freeze(o)};export const DEFAULT_OPTIONS=f(${JSON.stringify(DEFAULT_OPTIONS)});export const CONTENT_OPTION_KEYS=f(${JSON.stringify(CONTENT_OPTION_KEYS)});export const DEFAULT_IMPORT_LIMITS=f(${JSON.stringify(DEFAULT_IMPORT_LIMITS)});`,
      loader: "js",
    }));
  },
};
await rm("web-dist", { recursive: true, force: true });
await mkdir("web-dist/notices", { recursive: true });
const options = {
  entryPoints: ["web/main.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  charset: "utf8",
  sourcemap: false,
  legalComments: "external",
  metafile: true,
  plugins: [publicDefaults],
};
const raw = await build({ ...options, write: false, outfile: "main.js" });
const output = await build({
  ...options,
  minify: true,
  outfile: "web-dist/main.js",
});
// The Markdown parser lives only in this dedicated Worker; main never loads it.
const previewOptions = {
  entryPoints: ["web/preview/preview.worker.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  charset: "utf8",
  sourcemap: false,
  legalComments: "external",
  metafile: true,
};
const previewRaw = await build({
  ...previewOptions,
  write: false,
  outfile: "preview.worker.js",
});
const preview = await build({
  ...previewOptions,
  minify: true,
  outfile: "web-dist/preview.worker.js",
});
const mainInputs = Object.keys(output.metafile.inputs),
  previewInputs = Object.keys(preview.metafile.inputs);
const leaked = [
  ...mainInputs.filter(
    (p) =>
      p.includes("node_modules/markdown-it/") || p === "web/preview/parse.ts",
  ),
  ...previewInputs.filter(
    (p) =>
      /^web\/(?!preview\/)/.test(p) ||
      /^web\/preview\/(?:client|session|render|messages|source)\.ts$/.test(p) ||
      p.startsWith("src/adapters/") ||
      p.includes("node_modules/@zip.js/"),
  ),
];
if (leaked.length) {
  console.error("preview dependency graph leak:", leaked);
  process.exit(1);
}
for (const name of ["index.html", "styles.css"])
  await copyFile("web/" + name, "web-dist/" + name);
for (const name of ["import", "export"]) {
  await copyFile(
    `dist/adapters/browser/${name}.worker.min.js`,
    `web-dist/${name}.worker.js`,
  );
  const legal = `dist/adapters/browser/${name}.worker.min.js.LEGAL.txt`;
  if (
    (await readdir("dist/adapters/browser")).includes(
      `${name}.worker.min.js.LEGAL.txt`,
    )
  )
    await copyFile(legal, `web-dist/${name}.worker.js.LEGAL.txt`);
}
await copyFile("LICENSE", "web-dist/LICENSE.txt");
const notices = (await readdir("notices"))
  .filter((n) => n.endsWith(".txt"))
  .sort();
for (const name of notices)
  await copyFile("notices/" + name, "web-dist/notices/" + name);
await writeFile(
  "web-dist/notices/index.html",
  `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>第三者のライセンス — Aozora Markdown</title><link rel="stylesheet" href="../styles.css"><body><main class="shell"><h1>第三者のライセンス・notice</h1><p>著作権・ライセンス文面は原文のまま同梱しています。</p><ul>${notices.map((n) => `<li><a href="./${n}">${n}</a></li>`).join("")}</ul><a href="../">アプリに戻る</a></main></body></html>`,
);
const files = (await readdir("web-dist", { recursive: true })).filter((n) =>
  /\.[a-z]+$/i.test(n),
);
const assets = {};
for (const name of files) {
  const bytes = await readFile("web-dist/" + name);
  assets[name] = {
    bytes: bytes.length,
    gzipBytes: gzipSync(bytes, { level: 9 }).length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
const report = {
  builtAt: new Date().toISOString(),
  node: process.version,
  rawMainBytes: raw.outputFiles.find((f) => f.path.endsWith("main.js")).contents
    .length,
  assets,
  inputs: mainInputs,
  previewWorker: {
    contract: "aozora-preview-v1",
    rawBytes: previewRaw.outputFiles.find((f) =>
      f.path.endsWith("preview.worker.js"),
    ).contents.length,
    inputs: previewInputs,
  },
};
await mkdir("reports", { recursive: true });
await writeFile(
  "reports/web-build.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({ webBuild: true, rawMainBytes: report.rawMainBytes, assets }),
);
