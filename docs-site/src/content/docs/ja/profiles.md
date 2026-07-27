---
title: プロファイル
description: --profile が変えるものと、決して変えないもの。
---

`--profile <name>` は、producer 固有 / 様式的な findings をどれだけ厳しく扱うかを
選びます。既定は `spec` です。

profile が組み替えるのは **severity だけです。spec が要求する check を抑止する
ことはありません** — `MUST` 違反はどの profile でも報告されます(`lenient` では
`info` として出るだけです)。

## 3 つの profile

### `spec`(既定)

WACZ spec + wabac.js loader 互換。この profile で exit 0 になる archive は、
[ReplayWeb.page](https://replayweb.page/) で正しく replay できることが
期待されます(wabac.js 自体のバグを除く)。

「この archive は正しいか?」を問うときはこれを使います。

### `browserhive`

`spec` の上に [BrowserHive](https://uraitakahito.github.io/browserhive/ja/) の
より厳しい producer 慣習を重ねます。たとえば
`indexes/index.cdxj` は plain で置く、という慣習があるため、`.idx` とペアでも
`.cdxj.gz` は許しません。

BrowserHive 生成の archive だと分かっていて、その house rule も守らせたいときに
使います。他の producer の出力に当てると、その archive が従うと約束していない
慣習まで指摘することになります。

### `lenient`

producer 固有 / 様式的な findings をすべて `info` に降格させ、replay を壊す
hard error だけを残します。

legacy な archive をトリアージするとき、つまり「正しいか?」ではなく
「救えるか?」を問うときに使います。

## どの rule が実際に変わるのか

[Rules](/waxlens/ja/rules/) の表に **profile 上書き**列があり、どの rule が
何に組み替えられるかが正確に出ています。空欄の rule は 3 つの profile すべてで
同じ挙動です。

この列は各 rule の `applicability` 宣言から生成しているので、**要約ではなく
一次情報**です。

## exit code

profile が exit code に影響するのは severity 経由だけです。何を failure と
数えるかは変わりませんが、`info` に降格した rule は failure に寄与しなくなります。
report から exit code への変換は `@waxlens/protocol` の `exitCodeFor` にあり、
CLI と TUI が共有しているので両者がずれることはありません。
