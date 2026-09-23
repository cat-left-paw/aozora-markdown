# Fixture Policy — StrictとIntentional deviation

この文書はtest判定方針である。TypeScript runnerは`tests/reference/`、現在のv3差分は[互換性差分](./compatibility-v3.md)を参照。原本の307 unit、20 pipeline、JIS全組、encoding、warning、I/O oracleをそのまま保存し、別の新期待値層を重ねる。

## 1. 保存するもの

- `fixtures/*.json`（旧8ファイル）、`reference_oracle.py`、`reference_io_probes.py`はPython観測資料。FIX NOWへ合わせて再生成結果を書き換えない。
- `python-oracle-lock.json`は旧JSONのhash。`reference_oracle.py --check`は旧Python挙動の再現確認であり、v2の合格判定ではない。
- `compatibility-plan.json`は全旧unit/pipeline/encoding/warning/I/Oケースのpolicy、正確な既存case参照、既定のstrict / 対象外 / 要新期待値を記録する。JISは全indexにstrictを要求する一括entry。
- `improvement-fixtures.json`は設計時点で明示できる新expected例。これはTSを実行して採取したgoldenではなく、決定ログから書いた要求値。

## 2. metadata schema

```json
{
  "caseKey": "unit:emphasis-both-unsafe-count",
  "compatibility": "intentional-deviation",
  "decisionSet": "aozora-ts-v2",
  "decisions": ["R12"],
  "reasons": ["DUPLICATE_DIAGNOSTIC_COUNT_FIXED"],
  "status": "expected-defined",
  "reference": {"suite": "unit-fixtures.json", "id": "emphasis-both-unsafe-count"},
  "changedPaths": ["/return/4", "/stats/unconverted"],
  "expected": "別sidecarに具体的な全文JSON値を置く",
  "regression": "新期待値2に一致し、旧値3ではFAIL"
}
```

`compatibility`はstrict/intentional-deviation。`status`はreference-ready / expected-defined / needs-expectation / not-in-slice。型/構造は提案だが、ID・理由・具体期待値・許可fieldの追跡は必須。newContractAssertionだけを満たして既存fieldの比較を省くことは禁止。

FIX NOWは**decisionの新仕様に合う限定変更だけ**を認める。function名全体・regexに一致した全ケース・output全文を無条件ignoreするallowlistを作らない。reasonに該当しない別field変更があればFAIL。

## 3. 判定algorithm

1. reference hash/decisionSetの一致を確認する。
2. 実行scopeとAPI projectionを確定する。pure core比較にOS絶対pathやwrite成功を混ぜない。ただしscope外と明示せずfieldを捨ててはならない。
3. strictは実値と原本projectionを完全比較。whitespace/newline/Unicode normalizationは禁止。
4. intentionalは新expectedの有無、decision/reasonの有効性、契約への対応を確認する。needs-expectationはFAIL/未完了でありskip-passではない。
5. 新expectedと実値を完全比較する。さらに新expectedと原本との差分pathがchangedPathsと一致することを確認。余計な変更も、改善すべきfieldが旧値のままでもFAIL。
6. 各FIXの正常controlをstrict比較して回帰を検出する。複合影響は必要な複数reasonを列挙する。
7. 未登録差分が出たら自動的にapprovedへ昇格しない。既存決定の明確な帰結ならその契約と新expectedを独立に具体化してsidecarへ追加する。新しい製品判断なら矛盾/新提案として報告し、該当caseを未完了にする。

## 4. API projectionの固定

unitはPythonの`return` tuple/listをTSのnamed fieldsへexplicitに対応させる。例: emphasis = `[text,bold,italic,both,unconverted]`。`output/stats`の重複fieldも対応を検証する。原本unitの`warnings: []`はemitなしの意味であり、新しいstructured diagnosticsとは別field。v2のdiagnosticsは`newContract`へ完全なcodes/ranges等のsnapshotを追加し、旧warnings=[]を「診断不要」と解釈しない。

R15の旧marker付き単体出力は新text＋regionsへ投影する。一律PUA除去で比較を緩めない。**原本converterが今回実際に生成したwrapper**だけをfixtureから明示的に新text/regionへ対応させる。入力由来wrapperケースは完全不変が期待値となる。旧strip helperはproduct APIからretireし、finalizeのidentity testとして追跡する。

pipelineは以下を分ける。

- core projection: 最終text、各stage統計（未呼出しは0）、document残存occurrences/count、命名metadata、processing events、diagnostics。
- adapter/policy projection: target path、read encoding、write attempts/commit、JobStats、host log。

旧Worker fixtureに直接保存されていない新field（例: typed naming metadata、失敗fileのcore警告、new diagnostic range）は、原本＋新契約から追加expectedを作る。旧logやtextから本物でない列を捏造しない。write-error時のraw `writes`は試行でありcommitではない。skip fixtureのcore textは変換段階の結果を原本で追加観測できるが、writeがないだけでtext=emptyにしない。

旧`extract_frontmatter_metadata`はlegacy helper testとしてstrictを維持。product readerには同じ入力を別testとして追加し、quote意味値・raw_header・empty authors等を新仕様で検証する。旧parserを残すことを新writerの不正YAML維持に利用しない。

## 5. 新規regression testの最低セット

各FIXの8欄に列挙したtestに加え、次を新testとして登録する。ID prefixはdecision番号で固定する。

| ID prefix | 最低限のassertion |
| --- | --- |
| R01- | UTF8優先、CP932正常、明示codec、BOM競合/破損、lossy非成功 |
| R03- | 既存/入力/batch予約とのcollisionなし、suffix安定、target ext不変 |
| R04- | fake exclusive create競合、alias、root検証失敗、capability不足はwrite0件 |
| R05- | duplicate entryのbytesを別々に保持、directory構造、organize衝突 |
| R06- | absolute/drive/UNC/..混在/制御/symlink拒否、危険archive部分書込なし |
| R08- | writer→別YAML parseで同値、既存FM不変、legacyとproduct読取差、alias/dup-key拒否 |
| R09- | 全header行の所有先があり欠落なし、title author禁止、empty authors正常 |
| R10- | mismatch保持、正常ruby/bouten/生成emphasis見出しは同じ |
| R11- | 既存ruby内/交差は非変換、閉じた別rubyの後は正常変換 |
| R12- | U3→2、同じ文言の異なる出現は別count、成功消費後staleなし |
| R13- | 全converterでcode内外同居、tilde/backtick/異長/空/不閉じ、TXT非適用 |
| R14- | suffix/未閉じ保持、closed正常削除、footer偽日付/blockquote/code/跨ぎ拒否 |
| R15- | literal PUA不変、fake suppression不可、生成preserveだけ除外、削除/移動後のrange |
| R16- | commit前0、failure後0、success後加算、retry/重複event不変 |
| R18- | reserved/space-only/control/byte長/Unicode alias、suffix後再検証 |

この新test一覧を「testが存在する」と報告しない。初回Astra Bが実装する受入れ条件である。

## 6. 完了判定と未確定expected

今回の設計では、既知の差を全caseへ紐付け、代表的なexact expectedをsidecarへ保存する。複数改善が交差するpipeline、YAML quoting profileの全面展開、全protected-rangeの新offsetなどは`needs-expectation`として残す。これは仕様未承認ではなく、**具体test snapshotの作成作業が次の実装sliceにある**ことを示す。

実装完了までに初回scope内のneeds-expectationは0へしなければならない。既存実装結果をそのままexpectedへ採用する更新は禁止。原本の挙動、決定ログの変更規則、手計算/独立parser/境界検証の根拠を添える。理由を追加しただけで緑にする仕組みにはしない。

DEFERのZIP runtime/host保存を未実装のままpass件数へ足さない。初回pure policyは実装するため、R03〜06/R16/R18のfake/pure testを「hostだから対象外」とskipすることも禁止する。

## 7. 実装sliceの具体化

2026-09-22: `needs-expectation` 60件を仕様と原本から独立に具体化し、0へした。新しい307件分のdiagnostic/source UTF16 range/preserve occurrence期待値は`tests/fixtures/unit-contracts.json`、20件の完全なcore/policy期待値とraw Worker全fieldのscope表は`tests/fixtures/pipeline-v2.json`にある。補完scriptはTSをimport・実行しない。`changedPaths`の検証を保持し、pipelineのschema変更には追加の`referenceProjection`と`changedCorePaths`比較を課す。
