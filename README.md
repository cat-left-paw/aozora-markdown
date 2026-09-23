# Aozora Markdown

青空文庫のTXT・Markdown・ZIPを、ブラウザ内でMarkdown形式の文書へ変換します。入力の文字コードを選べ、外字・見出し・傍点・縦中横などの処理を調整できます。結果はダウンロード前に横書き・縦書きで参考表示できます。

青空文庫の注記や組版は、標準的なMarkdownだけでは完全に再現できません。一部は近い表現やNyoze向け記法に変換します。対応しない注記が残る場合は、変換結果の警告・未変換注記を確認してください。

## ローカルでWeb版を使う

Web版のローカル起動にはNode.js 24が必要です。全検証には、PATHから呼べるCPython 3.12.8とGoogle Chromeも必要です。現在はGitHub Pagesへ公開していません。

```sh
npm ci
npm run dev:web
```

表示された `http://127.0.0.1:4173/` をChromeで開きます。`file://` での起動には対応しません。ファイルはブラウザ内で処理し、変換のために外部へ送信しません。

1. TXT・MD・ZIPを選び、文字コード、出力拡張子などを設定します。変換内容を変える設定は「詳細設定を開く」にあります。
2. 「変換を開始」を押し、結果・警告・未変換注記を確認します。
3. 各出力の「プレビュー」で内容を確認できます。縦書きは参考表示です。「出力テキスト」には実際の出力の先頭128 KiBまでを表示します。
4. 出力を選び、1件なら単体ファイルかZIP、複数件ならZIPを作成します。「ダウンロード」は別の操作です。

`.md` と `.txt` は本文の変換方法を変えず、ファイルの拡張子だけを選びます。`.txt` にもMarkdownやNyoze向けの記法が含まれ得ます。本文を変えずに出力したいときは内容変換の設定をOFFにしてください。出力文字コードはUTF-8、改行はLFです。

プレビューは編集機能ではなく、変換済みbytesの読み取り専用表示です。任意のHTMLは実行せず、リンクや画像を自動取得しません。縦書きの見た目はNyozeなどのエディタとの完全一致を保証しません。画面のダウンロード表示は要求を発行したことを示し、OSでの保存完了を保証しません。

## TypeScript API

```ts
import { convertText } from 'aozora-markdown';

const result = convertText('題\n著者\n\n青空［＃「青空」は太字］');
console.log(result.text);
```

公開entryは本文変換、文字コード、命名・ZIP計画、import、export、Browser Worker adapterです。APIと各上限は[API.md](./API.md)を参照してください。現在npmパッケージとしては公開していません。`package.json`の`private: true`は、意図しないnpm公開を防ぐための指定です。

## 開発と検証

```sh
npm ci
npm run verify
```

`verify` は単体テスト、型検査、build、実ChromeのBrowser検査、Python原本・fixtureとの照合、書式と依存監査を実行します。`reports/` はローカルで再生成され、Gitには含めません。生成コードとfixtureの出典は[data-provenance.json](./data-provenance.json)と[notices](./notices/README.md)に記載しています。互換期待値と再現方法は[design](./design/README.md)にあります。

Aozora Markdown本体は[MIT License](./LICENSE)です。第三者由来のデータと依存ライブラリには[各notice](./notices/README.md)も適用されます。
