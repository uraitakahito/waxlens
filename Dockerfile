# Dockerfile — waxlens の唯一のイメージ (one-shot validation)
#
# multi-stage:
#   1. builder  — full source / pnpm install / pnpm build / `pnpm deploy --prod`
#                 で @waxlens/core を production deps だけにまとめる
#   2. runtime  — slim Node に builder の deploy 結果だけコピー
#
# 開発用の別イメージは無い。Apple Container のプラットフォーム DNS は
# `seaweedfs.waxlens` を *ホストからも* 解決させるので、開発時は host の
# pnpm で普通に動かせばよく、Linux shell を container に用意する理由が無い。
#
# Build / run:
#   container build -t waxlens:latest .
#   container run --rm \
#     -e AWS_ENDPOINT_URL_S3=http://seaweedfs.waxlens:8333 -e AWS_REGION=us-east-1 \
#     -e AWS_ACCESS_KEY_ID=waxlens -e AWS_SECRET_ACCESS_KEY=waxlens \
#     -e WAXLENS_S3_FORCE_PATH_STYLE=true \
#     -e NODE_OPTIONS=--dns-result-order=ipv4first \
#     waxlens:latest --profile browserhive s3://waxlens/foo.wacz
#
# container-compose のサブコマンドは up / down / build / version の 4 つだけで
# `run` が無いため、one-shot は compose service ではなく `container run` で叩く。
#
# TUI (`waxlens` bin) を使いたい場合は entrypoint を override する。
# このイメージには TUI bin は同梱しない (deploy 対象を @waxlens/core
# だけに絞っている)。

# ---------------------------------------------------------------------------
# Stage 1: builder
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS builder

RUN corepack enable && corepack prepare pnpm@11.1.2 --activate

WORKDIR /build

# lockfile-driven install のために manifest だけ先に COPY する。これで
# `pnpm install` レイヤが source change で invalidate されにくくなる。
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY packages/tui/package.json packages/tui/

RUN pnpm install --frozen-lockfile

# source を流し込んで core だけ build (tui の build / test は prod image
# に不要)。
COPY . .
RUN pnpm --filter @waxlens/core build

# runtime に持っていく姿 — `pnpm deploy --prod` は名前付きの dependency
# graph を 1 ディレクトリに集約する。`@waxlens/core` の prod deps のみ
# 含み、dev / workspace symlink は剥がされる。
#
# `--legacy`: pnpm v10+ では deploy のデフォルトが
# `inject-workspace-packages=true` を要求するようになった。@waxlens/core
# は他の workspace package に依存していないので、symlink vs injection の
# 差はここでは出ない — legacy mode で十分。
RUN pnpm --filter @waxlens/core deploy --prod --legacy /deploy/core

# ---------------------------------------------------------------------------
# Stage 2: runtime
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime

WORKDIR /app

# builder からは deploy 結果だけを持ってくる — pnpm の symlink farm も
# .pnpm キャッシュも含まない slim な node_modules になっている。
COPY --from=builder /deploy/core /app

USER node
ENV NODE_ENV=production

# `pnpm deploy` は deploy 対象自身の bin symlink (node_modules/.bin/...) を
# 作らない — `waxlens-validate` という名前は host 側 install でしか使わない
# 名前なので、container 内では node 経由で cli.js を直叩きする方が筋。
# 引数 (`<source>` + `--profile` 等) は呼び出し側で供給する:
#   container run --rm waxlens:latest --profile browserhive s3://bucket/key.wacz
ENTRYPOINT ["node", "/app/dist/cli.js"]
