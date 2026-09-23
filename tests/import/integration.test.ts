import { it } from "vitest";
import { readFileSync } from "node:fs";
import { prepareImport } from "../../src/import/index.js";
import {
  integrationInputs,
  integrationOptions,
  validateIntegration,
} from "../browser/import-contract.mjs";
it("S2 integration independent text/naming/stats/diagnostics expected values", async () => {
  const zipBytes = Object.fromEntries(
    ["normal.zip", "integration.zip"].map((name) => [
      name,
      new Uint8Array(readFileSync("tests/fixtures/zip/" + name)),
    ]),
  );
  validateIntegration(
    await prepareImport(integrationInputs(zipBytes), integrationOptions),
  );
});
