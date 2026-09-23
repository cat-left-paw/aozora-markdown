# 互換性・生成データ・検証資料

このディレクトリには、Aozora Markdownの変換仕様を保守するための参照資料と機械可読な期待値を置いています。現在の利用方法と公開APIは[README](../README.md)・[API](../API.md)を参照してください。

- [Python原本の観測](./python-reference-analysis.md)と[原本](../aozora_zip_batch_gui.py): 移植元の挙動を記録した参照資料。既知の欠陥まで現在の製品仕様とみなすものではありません。
- [改良判断](./improvement-decisions.md)と[fixture方針](./fixture-policy.md): 維持した挙動と意図的に変更した挙動の境界。
- [互換性差分](./compatibility-v3.md)・[機械可読な差分](./compatibility-v3.json): v2期待値から現行v3契約への変更。
- [旧ケース分類](./compatibility-plan.json)・[変更期待値](./improvement-fixtures.json)・[原本hash](./python-oracle-lock.json)・[fixtures](./fixtures/manifest.json): 回帰検査とデータの来歴。
- [参照実行](./reference_oracle.py)・[I/O検査](./reference_io_probes.py)・[設計データ検査](./validate_design.py)・[v3差分検査](./validate_compatibility_v3.py): `npm run verify` から実行する独立検査。

`design/review-*.mjs` のうち残しているものは、`npm run verify` が呼ぶ実行可能な回帰probeです。過去の実装報告・レビュー記録・AI向け依頼書は公開snapshotに含めません。

Python原本と旧oracleは変更せず、v3の新しい期待値を別層で重ねています。JIS全17,672組はstrictに比較します。原本のSHA-256は `4c45c5e777718e88815117e49db85ccb13e1dd4e35eba858e3eae958bd2f2cc0` です。

```sh
python3 design/validate_design.py
python3 design/reference_oracle.py --check
python3 design/reference_io_probes.py --check
npm run compat:v3
```
