---
title: JSON レポート
description: --json 出力の形式と、その安定性の約束。
---

`waxlens-validate --json` は JSON オブジェクトを 1 つ出力します。CI スクリプトや
waxlens の下流にとってのインターフェースなので、形式は偶然ではなく意図的に
決めてあります。

```sh
waxlens-validate --json samples/wikipedia.wacz | jq '{valid, summary}'
```

## トップレベル

```ts file="packages/core/src/validate/domain.ts#report"
```

`valid` は `summary.failed === 0` を cache したもので、consumer が再計算しなくて
済みます。`issues` は rule の登録順で、構造的な check が先に来るため、
最も可能性の高い producer バグが上の方に上がります。

## Summary

```ts file="packages/core/src/validate/domain.ts#report-summary"
```

`durationMs` は validation の実行時間で、プロセス起動時間は含みません。

## Issue

各 issue はそれを上げた rule を名乗るので、prose を解析しなくても rule 単位で
絞り込み・差分が取れます。

- `rule` — 安定した `<area>/<short-name>` 識別子。[Rules](/waxlens/ja/rules/) の
  表と同じ文字列です。localise せず、version 間で書式を変えません。
- `severity` — profile による組み替え後の値。つまり「その実行が実際にどう判断したか」です。
- `messageKey` + `params` — メッセージは**事前にレンダリングされた prose では
  ありません**。core は i18n キーとランタイム値だけを持ち、renderer が locale
  カタログで解決します。TUI と将来の browser frontend が同じ report を別の言語で
  提示できるのはこのためです。
- `location` — rule が言える場合の、archive 内の位置。
- `details` — rule 固有の付加情報（hash の差分、hex dump など）。意図的に型を
  持たせておらず、renderer が rule ごとに整形します。
- `docs` — 出典となる仕様の該当箇所へのリンク。指摘から根拠の本文までたどれます。
- `conformance` — **仕様**がどれだけ強く要求しているか（`MUST` / `MUST NOT` /
  `SHOULD` / `SHOULD NOT` / `MAY`）。rule が書くのではなく rule 名から解決するので、
  rule 定義が唯一の情報源のままになります。

### `severity` と `conformance` は別の問いに答えます

`severity` は違反に対して waxlens がどうするか、`conformance` は仕様が何を
要求しているかです。この 2 つは**直交**しており、しかも実際によくずれるので、
**片方で絞ってももう片方の代わりにはなりません**。

corpus の 29 標本での実測:

| conformance | error | warning | info |
| --- | ---: | ---: | ---: |
| `MUST` | 19 | **10** | 0 |
| `SHOULD` | **1** | 8 | 0 |
| `MAY` / `MUST NOT` | 0 | 4 | 1 |

11 件が対角から外れています。`datapackage/resources-complete` は `MUST` ですが
`warning` です —— ZIP に未宣言のファイルがあっても replay は止まりません。
`datapackage/digest` は逆向きで、仕様は `SHOULD` に留めていますが、hash が
合わないのはアーカイブが変更された可能性があるため waxlens は `error` にします。

なお **`valid` は `severity` だけから導かれます** —— `error` の数しか見ません。
**`MUST` に違反していても `valid` になりえます**。仕様準拠の観点が要るなら、
issue から自分で読み取ってください。

```sh
# waxlens が「壊れている」と判断したもの
waxlens archive.wacz | jq '[.issues[] | select(.severity == "error")]'

# 仕様が要求しているもの
waxlens archive.wacz | jq '[.issues[] | select(.conformance == "MUST" or .conformance == "MUST NOT")]'

# 両者が食い違っている箇所 —— たいていここがいちばん情報量があります
waxlens archive.wacz | jq '[.issues[]
  | select((.conformance == "MUST" and .severity != "error")
        or (.conformance != "MUST" and .severity == "error"))]'
```

これを行う CLI フラグはまだありません。report は 2 軸とも持っており、絞り込みは
呼び出し側に委ねています。

## 安定性の約束

`waxlensVersion` は `package.json#version` を映したもので、consumer が schema の
drift を推測ではなく検出できるようにするために存在します。

同一 major version の中では:

- 既存フィールドの意味と型は変わりません。
- `rule` 識別子は安定です — key にすべきはここです。
- optional なフィールドが増えることはあります。consumer は知らないフィールドを
  拒否せず無視してください。

`stats` が best-effort かつ optional なのは設計です。統計を取れないほど壊れた
WARC があったとしても、**それを報告する report 自体を止めてはいけない**からです。

## exit code

exit code は `@waxlens/protocol` の `exitCodeFor` が report から導出します。
CLI と TUI が共有しているので両者がずれることはありません。よくある用途なら
自分のスクリプトで `valid` を見ても等価です。failure の種類を区別したいときに
共有ヘルパを使ってください。
