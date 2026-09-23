# aozora-ts-v3 互換差分台帳（Slice 6、Slice 7 追記）

Slice 6「出力拡張子と変換内容の分離」で意図して変えた期待値と、Slice 7「縦中横」で足した
schema・理由の記録です。機械可読な正本は [`compatibility-v3.json`](compatibility-v3.json) で、
この文書はその読み方を説明します。現在の互換期待値を記録する資料であり、受入れ履歴ではありません。

## 原則

- Python 原本（`aozora_zip_batch_gui.py`）、`design/fixtures/` の旧 oracle、受入済みの v2 golden
  （`tests/fixtures/*-v2.json`）は **一切上書きしません**。台帳は v2 golden の SHA-256 を
  `baseGoldens` に固定し、validator が毎回照合します。
- v3 の期待値は「v2 golden → schema 射影 → 台帳の差分 overlay」で作ります。TS の実行結果から
  golden を生成することはしません。差分の `new` 値は `scripts/specify_v3_delta.py` に手で書いた
  値で、各差分に `derivation`（導出の根拠）を付けています。
- 台帳にない差分は失敗です。`tests/reference/pipelineV3.test.ts` は結果オブジェクト全体を
  `toEqual` で比較します。

## schema 射影（SCHEMA_V3_API）

| 旧 | 新 |
| --- | --- |
| `ConversionOptions.sourceFormat` | 削除（非 undefined 値は `ConversionOptionsError`） |
| `ConversionOptions.renameToMd` | 削除し、`ImportOptions.outputExtension?: "md" \| "txt"`（既定 `md`）へ移動 |
| `ConversionResult.isMarkdownOutput` | 削除 |

旧 Python の option は次の規則で射影します。

- `outputExtension = 入力が .md、または rename_to_md なら "md"、それ以外は "txt"`。これは旧
  `isMarkdownOutput` と一致し、validator が全ケースで照合します。
- その他の Python option は 1:1 で `conversion` に写します。`rename_to_md` は adapter 側の設定です。

この規則により、旧ケースの出力パスと `_converted` suffix はすべて v2 と同じになります。

## 内容が変わる旧ケース（2/20）

| case | 理由 | 変化 |
| --- | --- | --- |
| `pipeline:txt-gating` | OUTPUT_EXTENSION_DECOUPLED | 旧 TXT gating で止まっていた太字と改ページも変換されるようになります（`A\n**青**\n:::page-break\n:::`）。emphasis.bold と pageBreak.pageBreaks が 0→1 になり、processingEvents は 4 件になり、changedCorePaths が増えます。 |
| `pipeline:skip-unknown-txt` | RESIDUAL_SCAN_FOR_TXT_OUTPUT | TXT 出力でも残存注記を走査するため、`※［＃未知］` 1件、`REMAINING_AOZORA_NOTES` 診断、JobStats の残存注記 1件（1ファイル）が加わります。 |

残り 18 件は `/core/isMarkdownOutput` が消える schema 差分だけです。旧 fixture に縦中横の注記はなく、
本文が変わる旧ケースは増えていません。

## Slice 7 の schema 追加（本文差分 0）

`schemaProjection.addedStats.fields.tcy` は、全ケースの期待 core stats に
`{ converted: 0, unconverted: 0 }` を足します。Python reference との比較の前にこの field は
外します。ケース overlay が `/core/stats/tcy` を変えない限り、validator はその零オブジェクトを
要求します。これは「新仕様だから全ケースを PASS」にはしません。旧 20 件の内容差分は上の 2 件のままです。

| code | 仕様 | 要旨 | 新規テスト |
| --- | --- | --- | --- |
| TCY_POSTFIXED_FORM | S7-01 | 後置 `［＃「対象」は縦中横］` と 1〜4 文字の半角本体だけ | `tests/s7/syntax.test.ts` |
| TCY_GENERATED_BASE | S7-02 | この呼出しが生成した完全な TCY 領域だけ、後続の装飾・見出しが基底照合する | `tests/s7/composition.test.ts` |
| TCY_OPTION_AND_STATS | S7-03 | `convertTcy` 既定 true、stage `tcy`、診断 reason | `tests/s7/options.test.ts` |
| TCY_STATS_SCHEMA | S7-04 | 既存結果へ `stats.tcy` を零で追加 | `tests/reference/pipelineV3.test.ts` |
| TCY_ALL_OFF | S7-03 | 全 OFF の内容 field に `convertTcy` を含める | `tests/s7/options.test.ts` |

移行 assertion `s7-content-field-count` は、内容 field 12→13、`DEFAULT_OPTIONS` 22→23、
画面の option control 19→20、全 OFF の親一覧を記録します。Slice 6 の `ALL_OFF_IDENTITY` の
「12 field」という文は、当時の記録として残しています。

## 新規ケース（同じ変換内容・異なる拡張子）

| case | 元 | 拡張子 | 期待 path | 理由 |
| --- | --- | --- | --- | --- |
| `s6:default-header-as-txt` | default-header | txt | `work_converted.txt`（入力名 `work.txt` を予約） | NAMING_BY_OUTPUT_EXTENSION |
| `s6:txt-gating-as-md` | txt-gating | md | `work.md` | NAMING_BY_OUTPUT_EXTENSION |
| `s6:md-even-rename-off-as-txt` | md-even-rename-off | txt | `work.txt` | NAMING_BY_OUTPUT_EXTENSION |
| `s6:txt-frontmatter` | default-header（旧 rename_to_md=False） | txt | `work_converted.txt` | FRONTMATTER_FOR_TXT_OUTPUT |

`s6:txt-frontmatter` の旧出力は `題\n著者\n\n青空［＃「青空」は太字］\n` でした（Python の
rename_to_md=False の TXT は外字・奥付・注記ブロック除去だけ）。v3 では MD 出力と同じ frontmatter と太字が付きます。

## 理由コード

| code | 仕様 | 要旨 | 新規テスト |
| --- | --- | --- | --- |
| SCHEMA_V3_API | S6-01 | 旧 field の削除と移行エラー | `tests/s6/oldApiRejection.test.ts`, `tests/s6/types.check.ts` |
| OUTPUT_EXTENSION_DECOUPLED | S6-01/02 | 拡張子による gating の廃止 | `tests/s6/extensionInvariance.test.ts` |
| COMMON_PROTECTION_FOR_TEXT_INPUT | S6-02 | fence、inline code、frontmatter の保護を TXT 入力にも適用（R13 を置換） | `tests/s6/toggles.test.ts` |
| RESIDUAL_SCAN_FOR_TXT_OUTPUT | S6-02/04 | TXT 出力でも残存注記を走査 | `tests/s6/allOff.test.ts` |
| FRONTMATTER_FOR_TXT_OUTPUT | S6-02 | frontmatter は toggle だけで決まる | `tests/s6/extensionInvariance.test.ts` |
| NAMING_BY_OUTPUT_EXTENSION | S6-01 | 拡張子の影響は format、path、MIME だけ | `tests/s6/extensionInvariance.test.ts` |
| OPTIONAL_GAIJI_BOUTEN_HEADINGS | S6-03 | 外字、傍点、見出しの ON/OFF（既定 ON） | `tests/s6/toggles.test.ts` |
| HEADING_LEVEL_MAPPING | S6-03 | 大/中/小 → `#`×1〜6（既定 2/3/4）、全角空白インデントは維持 | `tests/s6/headingLevels.test.ts` |
| ALL_OFF_IDENTITY | S6-04 | 内容 12 field がすべて false なら入力と同一 | `tests/s6/allOff.test.ts` |

## 移行した既存 assertion

`migratedAssertions` は 12 件です。Slice 6 の 11 件に、Slice 7 の `s7-content-field-count` を足しています。主なものは次の 3 件です。

- **R13「TXT は Markdown ではない」**: TXT 入力の fence 内や frontmatter 値も保護されるようになりました。
- **F04 option matrix**: `renameToMd` の代わりに 3 toggle と `headingLevels` を検査します。
- **S2-01 rename/gating**: `outputExtension` で format を選び、TXT 入力の見出しも変換します。

## 変えないもの

- ZIP 安全性 fixture（`tests/fixtures/zip/manifest.json`、contract 名 `aozora-import-v1` は ZIP 安全性の記録名）。
- unit、differential、encoding、JIS の各 v2 期待値。低レベル変換関数の `context` 引数も維持します。

## 検証

```sh
python3 scripts/specify_v3_delta.py --check      # 台帳 JSON が手書き仕様と一致
python3 design/validate_compatibility_v3.py      # TS に依存しない独立検証
npx vitest run tests/reference                   # v2 監査の維持と v3 overlay との一致
```
