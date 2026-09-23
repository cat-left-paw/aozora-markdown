// Independent Slice 8 batching probe. A valid frontmatter-only model must
// yield during large DOM construction so switching/closing can cancel it.
import { build } from "esbuild";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const temp = await mkdtemp(join(tmpdir(), "aozora-s8-render-review-"));
try {
  for (const name of ["model", "render", "parse"]) {
    const result = await build({
      entryPoints: [`web/preview/${name}.ts`],
      bundle: true,
      platform: "node",
      format: "cjs",
      write: false,
      outfile: `${name}.cjs`,
    });
    await writeFile(join(temp, `${name}.cjs`), result.outputFiles[0].contents);
  }
  const require = createRequire(import.meta.url);
  const { validateModel } = require(join(temp, "model.cjs"));
  const { renderPreview } = require(join(temp, "render.cjs"));
  const { parsePreview } = require(join(temp, "parse.cjs"));
  const source = "---\nauthors:\n" +
    Array.from({ length: 5000 }, (_, i) => `  - 著者${i}`).join("\n") +
    "\n---\n";
  const model = parsePreview(source);
  const validation = validateModel(model);
  let yields = 0;
  let cancelled = false;
  let domNodes = 0;
  const dom = {
    createElement(tag) { domNodes++; return { tag, children: [] }; },
    createTextNode(value) { domNodes++; return { value }; },
    append(parent, child) { parent.children.push(child); },
    setClass() {},
    setAttribute() {},
  };
  const rendered = await renderPreview(model, dom, {
    batchSize: 400,
    cancelled: () => cancelled,
    yieldControl: async () => { yields++; cancelled = true; },
  });
  const result = {
    valid: validation.ok,
    modelNodes: validation.ok ? validation.nodes : undefined,
    domNodes,
    yields,
    status: rendered.status,
  };
  const passed = result.valid && result.yields > 0 && result.status === "cancelled";
  console.log(JSON.stringify({ status: passed ? "PASS" : "FAIL", result }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  await rm(temp, { recursive: true, force: true });
}
