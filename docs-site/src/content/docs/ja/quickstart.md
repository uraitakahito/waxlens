---
title: クイックスタート
description: waxlens を入れて最初の WACZ を検証するまで。
---

## インストール

waxlens は 7 つの package からなる pnpm workspace です。ビルドしてから
bin を system-wide に登録します。

```sh
pnpm install --frozen-lockfile
pnpm build

pnpm --dir packages/validate-cli add -g .   # waxlens-validate
pnpm --dir packages/tui          add -g .   # waxlens
pnpm --dir packages/daemon       add -g .   # waxlens-daemon (常駐 daemon を使うときだけ)
```

登録後は monorepo の外でも waxlens 直下でも、bin 名だけで呼べます。

3 行目は任意です。`waxlens` は daemon を自分で起動するので、`waxlens-daemon` を
PATH に置く必要があるのは、セッションをまたいで生きる daemon を動かすときだけです
— 依存 package の bin は global に link されないため、tui だけを入れてもこの名前は
使えません。

## archive を 1 本検証する

```sh
waxlens-validate samples/wikipedia.wacz
```

これが非対話の経路です。report を出力し、CI で分岐できる exit code を返します。

ローカルのファイルだけでなく、S3 互換ストア上の archive も同じコマンドで
検証できます。同梱の SeaweedFS に置いた WACZ なら、AWS SDK の default chain を
そちらへ向けるだけです。

```sh
export AWS_ENDPOINT_URL_S3=http://seaweedfs.waxlens:8333
export AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=waxlens AWS_SECRET_ACCESS_KEY=waxlens

waxlens-validate --s3-force-path-style s3://waxlens/wikipedia.wacz
```

`--s3-force-path-style` は SeaweedFS や MinIO のような path-style でしか
応答しないストアに要ります（`WAXLENS_S3_FORCE_PATH_STYLE=true` でも同じ）。
report の `source` が `{ "kind": "s3", "uri": "s3://…" }` になるほかは、
ローカルファイルのときと変わりません。

:::caution[`AWS_PROFILE` は上の変数より強い]
shell で `AWS_PROFILE` を export していると SDK は**そちらを使い**、上の
access key を無視します。`unset AWS_PROFILE` するか、コマンドの前に
`env -u AWS_PROFILE` を付けてください。
:::

ストアの起動と archive の upload は[コンテナ](/waxlens/ja/container/)にあります。

同じ report を対話的に読むなら TUI を使います。

```sh
waxlens samples/wikipedia.wacz
```

`waxlens` は既定で `waxlens-daemon` を子プロセスとして起動し、WebSocket で
接続します。ここまでの手順では port を意識する必要はありません。

セッションをまたいで生きる daemon に繋ぐ場合は、まず port を決めて起動します。

```sh
waxlens-daemon --port 7333 &
```

listen している URL が出力されます。

```
waxlens-daemon ws://127.0.0.1:7333
```

その URL をそのまま渡します。

```sh
waxlens --server ws://127.0.0.1:7333 samples/wikipedia.wacz
```

:::note[port はどこから来るか]
`--port` を省略すると `0`、つまり **OS が空いている port を選び**、起動のたびに
番号が変わります。固定したいときは `--port` か `WAXLENS_DAEMON_PORT` を使い、
そうでないときは daemon が出力した URL をコピーしてください。推測できる既定 port
は存在しません。
:::

## profile を選ぶ

既定の profile は `spec` です。この profile で exit 0 になる archive は
[ReplayWeb.page](https://replayweb.page/) で正しく replay できることが
期待されます。

```sh
waxlens-validate --profile browserhive        samples/wikipedia.wacz   # より厳しく
waxlens-validate --profile browserhive@2.1.0  samples/wikipedia.wacz   # producer のバージョンまで指定
waxlens-validate --profile lenient     samples/wikipedia.wacz   # トリアージ用
```

profile が組み替えるのは producer 固有 / 様式的な rule の severity だけで、
**spec が要求する check を抑止することはありません**。
[プロファイル](/waxlens/ja/profiles/)を参照。

## 機械可読な出力

`waxlens-validate` は常に JSON を標準出力に書きます。切り替えるフラグはありません。

```sh
waxlens-validate samples/wikipedia.wacz | jq '.summary'
```

形式は安定しており、[JSON レポート](/waxlens/ja/json-report/)に文書化しています。

## 次に読むもの

- 各 rule が何を見るか → [Rules](/waxlens/ja/rules/)
- 意図的に失敗する archive → [Corpus](https://uraitakahito.github.io/waxlens-corpus/ja/)
