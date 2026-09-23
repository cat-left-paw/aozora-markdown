// Independent boundary probe: a malformed outer opener must not hide a valid
// inner TCY span from later annotation stages. Exit 0 means that span stays intact.
import { convertText } from "../dist/index.js";
import { prepareImport } from "../dist/import/index.js";

const options = {
  addFrontmatter: false,
  removeAnnotationBlocks: false,
  removeAozoraFooter: false,
};
const cases = [
  {
    id: "nested-opener-bold",
    input: "｟X｟12｠［＃「｠」は太字］",
    expected: "｟X｟12｠［＃「｠」は太字］",
    code: "EMPHASIS_NOT_CONVERTED",
  },
  {
    id: "nested-opener-underline",
    input: "｟X｟12｠［＃「｠」に傍線］",
    expected: "｟X｟12｠［＃「｠」に傍線］",
    code: "UNDERLINE_NOT_CONVERTED",
  },
  {
    id: "nested-opener-bouten",
    input: "｟X｟12｠［＃「｠」に傍点］",
    expected: "｟X｟12｠［＃「｠」に傍点］",
    code: "BOUTEN_NOT_CONVERTED",
  },
  {
    id: "valid-input-tcy-control",
    input: "｟12｠［＃「｠」は太字］",
    expected: "｟12｠［＃「｠」は太字］",
    code: "EMPHASIS_NOT_CONVERTED",
  },
  {
    id: "ordinary-bouten-control",
    input: "青［＃「青」に傍点］",
    expected: "｜青《﹅》",
  },
];

const failures = [];
for (const item of cases) {
  const result = convertText(item.input, options);
  const codes = result.diagnostics.map((d) => d.code);
  if (result.text !== item.expected || (item.code && !codes.includes(item.code))) {
    failures.push({ id: item.id, expected: item.expected, actual: result.text, codes });
  }
}

for (const outputExtension of ["md", "txt"]) {
  const result = await prepareImport(
    [{
      id: outputExtension,
      name: "nested.md",
      kind: "md",
      bytes: new TextEncoder().encode("題\n著者\n\n" + cases[2].input),
    }],
    { outputExtension },
  );
  const output = result.status === "completed"
    ? new TextDecoder().decode(result.artifacts[0].bytes)
    : result.status;
  if (!output.includes(cases[2].expected)) {
    failures.push({ id: `adapter-${outputExtension}`, expected: cases[2].expected, actual: output });
  }
}

console.log(JSON.stringify({ status: failures.length ? "FAIL" : "PASS", failures }, null, 2));
if (failures.length) process.exitCode = 1;
