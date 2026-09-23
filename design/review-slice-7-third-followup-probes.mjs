// Independent S7-F06 probe. Run after npm run build.
// Exit 0 means range bouten keeps a tate-chu-yoko span and records tcy-overlap.
import { convertText } from "../dist/index.js";
import { prepareImport } from "../dist/import/index.js";

const options = {
  addFrontmatter: false,
  removeAnnotationBlocks: false,
  removeAozoraFooter: false,
};
const kinds = [
  "傍点", "白ゴマ傍点", "丸傍点", "白丸傍点", "黒三角傍点",
  "白三角傍点", "二重丸傍点", "蛇の目傍点", "ばつ傍点",
];
const bodies = [
  ["existing", "｟12｠", "｟12｠"],
  ["generated", "12［＃「12」は縦中横］", "｟12｠"],
  ["nested", "｟X｟12｠", "｟X｟12｠"],
  ["wrapped", "12［＃「12」は縦中横］［＃「12」は太字］", "**｟12｠**"],
];
const failures = [];
let total = 0;
for (const kind of kinds) {
  for (const [id, body, expectedBody] of bodies) {
    total++;
    const input = `［＃${kind}］${body}［＃${kind}終わり］`;
    const expected = `［＃${kind}］${expectedBody}［＃${kind}終わり］`;
    const result = convertText(input, options);
    if (
      result.text !== expected ||
      result.stats.bouten.converted !== 0 ||
      result.stats.bouten.unconverted !== 1 ||
      !result.diagnostics.some((d) =>
        d.code === "BOUTEN_NOT_CONVERTED" && d.details?.reason === "tcy-overlap"
      )
    ) {
      failures.push({
        id: `${kind}-${id}`, input, expected, actual: result.text,
        stats: result.stats.bouten, diagnostics: result.diagnostics,
      });
    }
  }
  total++;
  const control = convertText(`［＃${kind}］青空［＃${kind}終わり］`, options);
  if (control.text !== "｜青《﹅》｜空《﹅》" || control.stats.bouten.converted !== 1)
    failures.push({ id: `${kind}-normal-control`, actual: control.text });
}
const source = "［＃傍点］12［＃「12」は縦中横］［＃傍点終わり］";
const expected = "［＃傍点］｟12｠［＃傍点終わり］";
for (const outputExtension of ["md", "txt"]) {
  total++;
  const result = await prepareImport(
    [{ id: outputExtension, name: "range.txt", kind: "txt", bytes: new TextEncoder().encode(source) }],
    { outputExtension, conversion: options },
  );
  const actual = result.status === "completed"
    ? new TextDecoder().decode(result.artifacts[0].bytes) : result.status;
  if (actual !== expected)
    failures.push({ id: `adapter-${outputExtension}`, expected, actual });
}
console.log(JSON.stringify({ total, passed: total - failures.length, failed: failures.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;
