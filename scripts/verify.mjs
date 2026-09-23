import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

await mkdir("reports", { recursive: true });
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
const packageInfo = JSON.parse(await readFile("package.json", "utf8"));
const dependencies = {
  lockfileVersion: lock.lockfileVersion,
  lockfileSha256: sha256(await readFile("package-lock.json")),
  directRuntime: packageInfo.dependencies,
  directDevelopment: packageInfo.devDependencies,
  packages: Object.fromEntries(
    Object.entries(lock.packages)
      .filter(([path]) => path)
      .map(([path, value]) => [
        path,
        {
          version: value.version,
          license: value.license ?? "not specified in lockfile",
          resolved: value.resolved,
          integrity: value.integrity,
          developmentOnly: value.dev === true,
          optional: value.optional === true,
        },
      ]),
  ),
};
await writeFile(
  "reports/dependencies.json",
  JSON.stringify(dependencies, null, 2) + "\n",
);

const oracleLock = JSON.parse(
  await readFile("design/python-oracle-lock.json", "utf8"),
);
const expectedHashes = {
  "aozora_zip_batch_gui.py": oracleLock.sourceSha256,
  "design/reference_oracle.py":
    "d4732f80b5538b280c67d4a4deb83f93c88197fac8465cddf88d85637bacf5fe",
  "design/reference_io_probes.py":
    "937c5dcee4fafbbef4ea902596c592c2a8687c7ffc127bc7923187e1fa56daa1",
  ...Object.fromEntries(
    Object.entries(oracleLock.files).map(([path, hash]) => [
      "design/fixtures/" + path,
      hash,
    ]),
  ),
};
const integrity = {};
for (const [path, expected] of Object.entries(expectedHashes)) {
  const actual = sha256(await readFile(path));
  integrity[path] = { expected, actual, unchanged: expected === actual };
  if (actual !== expected)
    throw new Error("Original evidence changed: " + path);
}
const report = {
  decisionSet: "aozora-ts-v3",
  adapterContract: "aozora-import-v2",
  exportContract: "aozora-export-v1",
  webContract: "aozora-web-v6",
  previewContract: "aozora-preview-v1",
  startedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  sourceIntegrity: integrity,
  commands: [],
  completed: false,
};
const commands = [
  [
    "npm",
    [
      "test",
      "--",
      "--reporter=default",
      "--reporter=json",
      "--outputFile=reports/vitest-results.json",
    ],
    "test-command.txt",
  ],
  ["npm", ["run", "typecheck"], "typecheck-command.txt"],
  ["npm", ["run", "build"], "build-command.txt"],
  ["npm", ["run", "test:browser"], "browser-command.txt"],
  ["npm", ["run", "zip:check"], "zip-command.txt"],
  ["npm", ["run", "test:import-browser"], "import-browser-command.txt"],
  ["npm", ["run", "export:check"], "export-command.txt"],
  ["npm", ["run", "test:export-browser"], "export-browser-command.txt"],
  ["node", ["design/review-slice-2-probes.mjs"], "slice2-probes-command.txt"],
  ["node", ["design/review-slice-2-browser.mjs"], "slice2-browser-command.txt"],
  ["node", ["design/review-slice-2-recheck.mjs"], "slice2-recheck-command.txt"],
  ["node", ["reports/review-reproduce.mjs"], "review-reproduce-command.txt"],
  ["node", ["reports/review-recheck.mjs"], "review-recheck-command.txt"],
  ["npm", ["run", "data:check"], "data-command.txt"],
  ["npm", ["run", "reference:check"], "reference-command.txt"],
  [
    "python3",
    ["design/reference_io_probes.py", "--check"],
    "io-reference-command.txt",
  ],
  ["npm", ["run", "format:check"], "format-command.txt"],
  ["npm", ["audit", "--json"], "npm-audit.json"],
  ["node", ["design/review-slice-3-probes.mjs"], "slice3-probes-command.txt"],
  ["npm", ["run", "build:web"], "web-build-command.txt"],
  ["npm", ["run", "test:web"], "web-command.txt"],
  ["node", ["design/review-slice-4-probes.mjs"], "slice4-probes-command.txt"],
  [
    "node",
    ["design/review-slice-5-pointer-probe.mjs"],
    "slice5-pointer-probe-command.txt",
  ],
  ["npm", ["run", "compat:v3"], "compat-v3-command.txt"],
  ["npm", ["run", "test:s6-browser"], "s6-browser-command.txt"],
  ["npm", ["run", "test:s7-browser"], "s7-browser-command.txt"],
  ["node", ["design/review-slice-7-probes.mjs"], "slice7-probes-command.txt"],
  [
    "node",
    ["design/review-slice-7-followup-probes.mjs"],
    "slice7-followup-probes-command.txt",
  ],
  [
    "node",
    ["design/review-slice-7-second-followup-probes.mjs"],
    "slice7-second-followup-probes-command.txt",
  ],
  [
    "node",
    ["design/review-slice-7-third-followup-probes.mjs"],
    "slice7-third-followup-probes-command.txt",
  ],
  ["npm", ["run", "test:s8-browser"], "s8-browser-command.txt"],
  ["node", ["design/review-slice-8-probes.mjs"], "slice8-probes-command.txt"],
  [
    "node",
    ["design/review-slice-8-render-probe.mjs"],
    "slice8-render-probe-command.txt",
  ],
  [
    "node",
    ["design/review-slice-8-inline-code-probe.mjs"],
    "slice8-inline-code-probe-command.txt",
  ],
  ["npm", ["run", "test:vp-browser"], "vp-browser-command.txt"],
  ["npm", ["run", "test:fui-browser"], "fui-browser-command.txt"],
];
for (const [program, args, log] of commands) {
  const started = Date.now();
  const result = spawnSync(program, args, {
    encoding: "utf8",
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", NO_COLOR: "1" },
    maxBuffer: 32 * 1024 * 1024,
  });
  await writeFile("reports/" + log, result.stdout + result.stderr);
  const item = {
    command: [program, ...args].join(" "),
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    exitCode: result.status,
    durationMs: Date.now() - started,
    log: "reports/" + log,
  };
  report.commands.push(item);
  console.log(JSON.stringify(item));
  await writeFile(
    "reports/verification.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  if (result.error || result.status !== 0) {
    console.error(result.error ?? result.stdout + result.stderr);
    process.exit(1);
  }
}
const tests = JSON.parse(await readFile("reports/vitest-results.json", "utf8"));
report.tests = {
  passed: tests.numPassedTests,
  failed: tests.numFailedTests,
  pending: tests.numPendingTests,
  total: tests.numTotalTests,
};
const plan = JSON.parse(
  await readFile("design/compatibility-plan.json", "utf8"),
);
report.compatibility = {
  strict: plan.cases.filter(
    (c) => c.compatibility === "strict" && c.status !== "not-in-slice",
  ).length,
  intentionalDeviation: plan.cases.filter(
    (c) =>
      c.compatibility === "intentional-deviation" &&
      c.status !== "not-in-slice",
  ).length,
  notInSlice: plan.cases.filter((c) => c.status === "not-in-slice").length,
  needsExpectation: plan.cases.filter((c) => c.status === "needs-expectation")
    .length,
};
const v3 = JSON.parse(await readFile("design/compatibility-v3.json", "utf8"));
report.compatibilityV3 = {
  decisionSet: v3.decisionSet,
  pipelineCases: v3.pipelineCases.length,
  contentDeltas: v3.pipelineCases.filter((c) => c.changes.length > 0).length,
  newCases: v3.newCases.length,
  migratedAssertions: v3.migratedAssertions.length,
};
report.completed = true;
report.finishedAt = new Date().toISOString();
await writeFile(
  "reports/verification.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    tests: report.tests,
    compatibility: report.compatibility,
    compatibilityV3: report.compatibilityV3,
  }),
);
