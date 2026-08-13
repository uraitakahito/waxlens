---
title: Apple Container スタック
description: bundled SeaweedFS を使って s3:// の WACZ を検証する。
---

stack file は `docker-compose.yml` 1 本で、[Apple Container](https://github.com/apple/container)
の上で [container-compose](https://github.com/Mcrich23/Container-Compose) が動かす。
中身は service 1 つ — S3 API を話す [SeaweedFS](https://github.com/seaweedfs/seaweedfs) だけ。
archive を生成する側、つまり
[BrowserHive](https://uraitakahito.github.io/browserhive/ja/) や browser は含まれない。
これが、waxlens が「誰が書いた WACZ か」に依存しないための土台になっている。

waxlens 自身はこの file の service ではない。Apple Container の compose は
subcommand が `up` / `down` / `build` / `version` の 4 つしかなく、one-shot の
service を駆動する手段が無いため。waxlens は host で動かすか、`container run`
で叩くかのどちらかで、両方とも以下に示す。

## 一度だけの準備

```sh
brew install mcrich23/formulae/container-compose
sudo container system dns create waxlens
```

domain 名は `docker-compose.yml` の `name:` と一致していなければならない。これに
よって container が `seaweedfs.waxlens` として platform DNS に登録され、
**他の container からだけでなく host からも解決できる**ようになる。開発用の
container を用意していないのはこれが理由。

## store を起動する

```sh
container-compose up -d -b
```

`waxlens` bucket は container 自身の entrypoint 内の retry ループが作る。順序を
待つ init container は無い — ここでは `depends_on` は起動順のみで、
`healthcheck:` はそもそも読まれないため。bucket を使う前に master を待つ:

```sh
until curl -sf http://localhost:9333/cluster/status >/dev/null; do sleep 1; done
```

## archive を upload する

sidecar の AWS CLI container を使えば、host に何も入れずに済む:

```sh
container run --rm \
  -v "$(pwd)/samples:/samples" \
  -e AWS_ACCESS_KEY_ID=waxlens -e AWS_SECRET_ACCESS_KEY=waxlens \
  -e AWS_REGION=us-east-1 -e AWS_ENDPOINT_URL_S3=http://seaweedfs.waxlens:8333 \
  docker.io/amazon/aws-cli s3 cp /samples/wikipedia.wacz s3://waxlens/wikipedia.wacz
```

upload した archive は `http://localhost:8888/buckets/waxlens/` で確認できる。

## 検証する — host で

こちらが開発時の経路。AWS SDK の default chain を store に向けて、ビルド済みの
CLI をそのまま動かす:

```sh
unset AWS_PROFILE          # 下記参照 — profile が設定されていると負ける
export AWS_ENDPOINT_URL_S3=http://seaweedfs.waxlens:8333
export AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=waxlens AWS_SECRET_ACCESS_KEY=waxlens
export WAXLENS_S3_FORCE_PATH_STYLE=true

./packages/validate-cli/dist/waxlens-validate.js s3://waxlens/wikipedia.wacz
```

port は loopback に publish してあるので、container 名の代わりに
`http://localhost:8333` を指しても同じように動く。

:::caution[`AWS_PROFILE` は上の変数より強い]
shell で既に `AWS_PROFILE` を export している場合 — 実際に AWS を使っている人は
そうなっている — SDK は**その profile を使い**、上の access key の組を無視する。
SSO profile だと、失敗の仕方が分かりにくい:

```
waxlens-validate: cannot open "s3://waxlens/wikipedia.wacz":
  Token is expired. To refresh this SSO session run 'aws sso login' ...
```

stack は壊れていない。request がそこまで届いていないだけ。shell で unset するか、
コマンドの前に `env -u AWS_PROFILE` を付ける。
:::

同梱の `samples/wikipedia.wacz` は既定の `spec` profile では pass する。
`--profile browserhive` では pass **しない** — webrecorder が生成した archive で
CDXJ index が gzip されており、この profile はそれを拒否するため。profile が仕事を
している状態で、詳細は[プロファイル](/waxlens/ja/profiles/)を参照。

## 検証する — image で

```sh
container build -t waxlens:latest .

container run --rm \
  -e AWS_ENDPOINT_URL_S3=http://seaweedfs.waxlens:8333 \
  -e AWS_REGION=us-east-1 \
  -e AWS_ACCESS_KEY_ID=waxlens -e AWS_SECRET_ACCESS_KEY=waxlens \
  -e WAXLENS_S3_FORCE_PATH_STYLE=true \
  -e NODE_OPTIONS=--dns-result-order=ipv4first \
  waxlens:latest s3://waxlens/wikipedia.wacz
```

image の entrypoint が CLI なので、image 名より後ろはそのまま CLI に渡り、
終了コードも waxlens 自身のものになる。

`NODE_OPTIONS=--dns-result-order=ipv4first` が要るのは container 内で動かすとき
だけ。platform DNS は AAAA も返すが VM 間に v6 経路が無いので、Node が v6 を先に
解決すると到達できない。host 実行では不要。

## 片付ける

```sh
container-compose down
```

named volume は残るので、upload した archive は次回もそのまま使える。空の状態から
始めたい場合は `seaweedfs-data` も消す。

## credential がどう waxlens に届くか

`AWS_ENDPOINT_URL_S3` は AWS SDK の default chain が読むので、bundled store に
向けるための専用の code path は要らない。`AWS_REGION` は SDK が要求するが
SeaweedFS 側は値を無視する。`WAXLENS_S3_FORCE_PATH_STYLE=true` を opt-in している
のは、virtual-hosted-style の addressing に必要な bucket subdomain の wildcard
DNS を SeaweedFS が持たないため。

この構成は bundled SeaweedFS 専用で、AWS / R2 / その他の S3 互換 service への
切り替えは現状想定していない。
