---
title: 用語 (Terminology)
description: WACZ の用語を、日本語の文章中でも英語のまま揃える方針。
---

WACZ 1.1.1 の
[Terminology](https://specs.webrecorder.net/wacz/1.1.1/#terminology)
([日本語訳](https://uraitakahito.github.io/specs/wacz/1.1.1/#terminology)) で
**定義された語は、日本語の文章中でも英単語のまま**書きます。docs にもソース
コメントにも同じ方針を適用します。

狙いは訳語の統一ではなく、**表記ゆれという選択肢自体を無くす**ことです。
「ウェブアーカイブ」と書くか `Web Archive` と書くかを毎回判断していると、
同じ文書の中で両方が現れます。

:::note[英語版との違い]
このページには英語版に対応する節がありません。英語話者にとって「spec の語を
英語で書く」は自明だからです。英語版は代わりに**用語の定義集**になっています。
対訳ではありますが**逐語訳ではありません**。
:::

## 固定する英単語

| 概念 | 文中でも使う(正) | 避ける(訳語・表記ゆれ) | 対象外(同形だが別概念) |
| ---- | ---------------- | ---------------------- | ---------------------- |
| ZIP コンテナ | `ZIP file`(format は `ZIP`) | 小文字 `zip` / `ZIP ファイル` / `ZIP アーカイブ` | `gzip` / 拡張子 `.zip` `.wacz` |
| WACZ / WARC | `WACZ` / `WARC` | —(既に英) | — |
| ウェブアーカイブ | `Web Archive` | `ウェブアーカイブ` / 裸の「アーカイブ」 | WACZ 内の `archive/` ディレクトリ |
| ページ | `Page` | `ページ` / `ウェブページ` | `spec ページ` など一般の web ページ |
| メディアタイプ | `Media Type` | `メディアタイプ` / `MIME` | HTTP ヘッダ名 `Content-Type` |
| コレクション | `Collection` | `コレクション` | — |
| パッケージ | `Package` | `パッケージ` | npm の `package` |
| その他 | `Context` / `Wayback Machine` / `IIPC` | 各訳語 | — |

## 適用ルール

1. **その語が Terminology の「概念」を指すときだけ**英語化します。一般語
   (`spec ページ`)・別概念(`npm パッケージ`)・`gzip` は触りません。
2. **コード識別子(変数 / 関数 / 型 / rule 名)は対象外**です。この方針は prose
   (docs とコメント)だけに適用します。
3. WACZ = "Web Archive Collection Zipped"。WARC データとメタデータを `ZIP file` に
   まとめた `Web Archive` の `Package` です。

## 退行防止

訳語・表記ゆれの混入はレビューで弾きます。とくに明確な訳語(`ウェブアーカイブ` /
`メディアタイプ` / `ZIP ファイル` など)に注意してください。`Page` / `Package` は
概念依存(`spec ページ` / `npm パッケージ` は正)なので、文脈を見て判断します。
