---
title: Docker Compose スタック
description: bundled SeaweedFS を使って s3:// の WACZ を検証する。
---

compose file は 2 つある。どちらにも
[BrowserHive](https://uraitakahito.github.io/browserhive/ja/) や browser —
つまり archive を生成する側 — は含まれない。stack が単体で完結していることが、waxlens が
「誰が書いた WACZ か」に依存しないための土台になっている。

`./setup.sh` が両方の file が読む `.env` を書き出す。中身は bind mount した
`/app` を host から書けるようにするための `USER_ID` / `GROUP_ID` と、`TZ`。

## Dev stack — S3 の付いた shell

`compose.dev.yaml` は repository を `/app` に bind mount した開発用 container を
build し、あわせて S3 API を話す
[SeaweedFS](https://github.com/seaweedfs/seaweedfs) と、`waxlens` bucket を作る
one-shot job を起動する。

```sh
./setup.sh
docker compose -f compose.dev.yaml up -d --build
docker compose -f compose.dev.yaml exec waxlens bash
```

以下は container 内で:

```sh
pnpm install && pnpm --filter @waxlens/core build
aws --endpoint-url http://seaweedfs:8333 s3 cp samples/wikipedia.wacz s3://waxlens/wikipedia.wacz
./packages/core/dist/cli.js --profile browserhive s3://waxlens/wikipedia.wacz
```

container の `node_modules` は bind mount の一部ではなく named volume として、
pnpm workspace が持つ 3 箇所すべてを shadow している。container 内で install した
Linux 用 binary が host の tree に出ることも、host の macOS 用 binary が container に
見えることもない。

upload した archive は `http://localhost:8888/buckets/waxlens/` で確認できる。

## Prod stack — 1 回検証して終了

`compose.prod.yaml` は production image を build して 1 回だけ走らせる。`waxlens`
service は `profiles: [run]` の後ろにいるので、`up` では store しか起動しない。

```sh
docker compose -f compose.prod.yaml up -d

# ここでは SeaweedFS が host に port を publish しないので、
# 同じ network 上の sidecar AWS CLI container から upload する。
docker run --rm --network waxlens-network \
  -v $(pwd)/samples:/samples:ro \
  -e AWS_ACCESS_KEY_ID=waxlens -e AWS_SECRET_ACCESS_KEY=waxlens \
  -e AWS_REGION=us-east-1 -e AWS_ENDPOINT_URL_S3=http://seaweedfs:8333 \
  amazon/aws-cli s3 cp /samples/wikipedia.wacz s3://waxlens/wikipedia.wacz

docker compose -f compose.prod.yaml --profile run run --rm waxlens \
  --profile browserhive s3://waxlens/wikipedia.wacz

docker compose -f compose.prod.yaml down
```

この run command に出てくる 2 つの `--profile` は別物で、前者は Compose の service
profile、後者は waxlens 自身の厳しさの設定。image の entrypoint が CLI なので、
service 名より後ろはそのまま CLI に渡る。

## credential がどう waxlens に届くか

どちらの stack も同じ 4 つの変数を設定している。`AWS_ENDPOINT_URL_S3` は AWS SDK の
default chain が読むので、bundled store に向けるための専用の code path は要らない。
`AWS_REGION` は SDK が要求するが SeaweedFS 側は値を無視する。
`WAXLENS_S3_FORCE_PATH_STYLE=true` を opt-in しているのは、virtual-hosted-style の
addressing に必要な bucket subdomain の wildcard DNS を SeaweedFS が持たないため。

この構成は bundled SeaweedFS 専用で、AWS / R2 / その他の S3 互換 service への
切り替えは現状想定していない。
