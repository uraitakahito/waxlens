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
