# 用語 (Terminology)

WACZ 1.1.1 の [Terminology](https://specs.webrecorder.net/wacz/1.1.1/#terminology)
([日本語訳](https://uraitakahito.github.io/specs/wacz/1.1.1/#terminology)) で
**定義された語は、日本語の文章中でも英単語のまま** docs / ソースコメントに書く。
訳語(ページ / ウェブアーカイブ …)を使うか英語を使うかという**表記ゆれ自体を無くす**のが狙い。

## 固定する英単語

| 概念 | 文中でも使う(正) | 避ける(訳語・表記ゆれ) | 対象外(同形だが別概念) |
|------|------------------|--------------------------|--------------------------|
| ZIP コンテナ | `ZIP file`(format は `ZIP`) | 小文字 `zip` / `ZIP ファイル` / `ZIP アーカイブ` | `gzip` / 拡張子 `.zip` `.wacz` |
| WACZ / WARC | `WACZ` / `WARC` | —(既に英) | — |
| ウェブアーカイブ | `Web Archive` | `ウェブアーカイブ` / 裸の「アーカイブ」 | WACZ 内の `archive/` ディレクトリ |
| ページ | `Page` | `ページ` / `ウェブページ` | `spec ページ` / 「事例ページ」など一般の web ページ |
| メディアタイプ | `Media Type` | `メディアタイプ` / `MIME` | HTTP ヘッダ名 `Content-Type` |
| コレクション | `Collection` | `コレクション` | — |
| パッケージ | `Package` | `パッケージ` | npm の `package` |
| その他 | `Context` / `Wayback Machine` / `IIPC` | 各訳語 | — |

## 適用ルール

1. **その語が Terminology の「概念」を指すときだけ**英語化する。
   一般語(`spec ページ`)・別概念(`npm パッケージ`)・`gzip` は触らない。
2. **コード識別子(変数 / 関数 / 型 / rule 名)は対象外**。本ルールは prose(docs と
   コメント)だけに適用する。
3. WACZ = "Web Archive Collection Zipped"。WARC データとメタデータを `ZIP file` に
   まとめた `Web Archive` の `Package`。

## 退行防止

訳語・表記ゆれの混入はレビューで弾く。とくに明確な訳語(`ウェブアーカイブ` /
`メディアタイプ` / `ZIP ファイル` など)に注意する。`Page` / `Package` は概念依存
(`spec ページ` / `npm パッケージ` は正)なので、文脈を見て判断する。
