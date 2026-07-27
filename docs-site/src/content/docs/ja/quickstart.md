---
title: クイックスタート
description: waxlens を入れて最初の WACZ を検証するまで。
---

## インストール

waxlens は 4 つの package からなる pnpm workspace です。ビルドしてから 2 つの
bin を system-wide に登録します。

```sh
pnpm install --frozen-lockfile
pnpm build

pnpm --dir packages/core add -g .   # waxlens-validate
pnpm --dir packages/tui  add -g .   # waxlens
```

登録後は monorepo の外でも waxlens 直下でも、bin 名だけで呼べます。

## archive を 1 本検証する

```sh
waxlens-validate samples/wikipedia.wacz
```

これが非対話の経路です。report を出力し、CI で分岐できる exit code を返します。
同じ report を対話的に読むなら TUI を使います。

```sh
waxlens samples/wikipedia.wacz
```

`waxlens` は既定で `waxlens-daemon` を子プロセスとして起動し、WebSocket で
接続します。常駐している daemon に繋ぐ場合は次のとおりです。

```sh
waxlens --server ws://127.0.0.1:PORT samples/wikipedia.wacz
```

## 厳しさを選ぶ

既定の profile は `spec` です。この profile で exit 0 になる archive は
[ReplayWeb.page](https://replayweb.page/) で正しく replay できることが
期待されます。

```sh
waxlens-validate --profile browserhive samples/wikipedia.wacz   # より厳しく
waxlens-validate --profile lenient     samples/wikipedia.wacz   # トリアージ用
```

profile が組み替えるのは producer 固有 / 様式的な rule の severity だけで、
**spec が要求する check を抑止することはありません**。
[プロファイル](/waxlens/ja/profiles/)を参照。

## 機械可読な出力

```sh
waxlens-validate --json samples/wikipedia.wacz | jq '{valid, summary}'
```

形式は安定しており、[JSON レポート](/waxlens/ja/json-report/)に文書化しています。

## 次に読むもの

- 各 rule が何を見るか → [Rules](/waxlens/ja/rules/)
- 意図的に失敗する archive → [Corpus](/waxlens/ja/corpus/)
