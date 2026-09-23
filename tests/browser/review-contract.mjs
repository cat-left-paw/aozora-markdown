import {
  convertText,
  createFrontmatter,
  readFrontmatter,
} from "../../dist/index.js";

export function runReviewRegressions() {
  const ids = [];
  const check = (id, actual, expected) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected))
      throw new Error(id + "\n" + JSON.stringify({ actual, expected }));
    ids.push(id);
  };
  const bare = {
    addFrontmatter: false,
    removeAozoraFooter: false,
    removeAnnotationBlocks: false,
  };
  const input =
    "---\ntitle: |\n  前\n  ---\n  ※［＃U+0041］\nauthor: 人\n---\n本文";
  const converted = convertText(input, bare);
  const metadata = readFrontmatter(input).metadata;
  check(
    "F01-existing-scalar-delimiter",
    [
      converted.text,
      metadata?.title,
      metadata?.author,
      converted.stats.gaiji.converted,
    ],
    [input, "前\n---\n※［＃U+0041］\n", "人", 0],
  );
  const generated = readFrontmatter(
    createFrontmatter({ title: "題", raw_header: "---", author: "人" }),
  );
  check(
    "F01-writer-scalar-delimiter",
    [
      generated.ok,
      generated.metadata?.title,
      generated.metadata?.raw_header,
      generated.metadata?.author,
    ],
    [true, "題", "---", "人"],
  );
  const pipeline = convertText("題\n---\n著者\n\n本文");
  check(
    "F01-default-pipeline-must-return",
    readFrontmatter(pipeline.text).metadata?.raw_header,
    "---",
  );
  const nested = convertText(
    "［＃傍線］青［＃「青」は太字］［＃傍線終わり］［＃「青」は大見出し］",
    bare,
  );
  check(
    "F02-nested-generated-markup",
    [nested.text, nested.stats.headings.converted, nested.remainingNotes],
    ["## ||**青**||", 1, []],
  );
  for (const [i, raw_header] of [" \n", "\n ", " \n \n"].entries()) {
    const read = readFrontmatter(
      createFrontmatter({ title: "題", raw_header }),
    );
    check(
      `F03-whitespace-literal-${i}`,
      [read.ok, read.metadata?.title, read.metadata?.raw_header],
      [true, "題", raw_header],
    );
  }
  // aozora-ts-v3 browser-F04-undefined-option: explicit undefined of a removed
  // field is still accepted; the result no longer has isMarkdownOutput.
  for (const key of [
    "renameToMd",
    "convertMarkdownEmphasis",
    "convertHeadings",
  ]) {
    const result = convertText("青［＃「青」は太字］", {
      ...bare,
      [key]: undefined,
    });
    check(
      `F04-undefined-option-${key}`,
      [result.text, "isMarkdownOutput" in result],
      ["**青**", false],
    );
  }
  for (const [i, raw_header] of [" 題\n ", " 題\n \n", "\n 題\n "].entries()) {
    const text = createFrontmatter({ title: "題", raw_header });
    const read = readFrontmatter(text);
    const converted = convertText(text + "\n※［＃U+0041］", bare);
    check(
      `F05-mixed-text-trailing-space-${i}`,
      [
        read.ok,
        read.metadata?.title,
        read.metadata?.raw_header,
        converted.text,
        converted.stats.gaiji.converted,
      ],
      [true, "題", raw_header, text + "\nA", 1],
    );
  }
  return ids;
}
