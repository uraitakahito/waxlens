---
title: Docker Compose stack
description: Validate s3:// sources with the bundled SeaweedFS.
---

Two compose files ship with the repository. Neither one contains BrowserHive, a
browser, or anything else that produces archives — the stack is self-contained,
which is what keeps waxlens loosely coupled to whatever wrote the WACZ.

`./setup.sh` writes the `.env` both files read: `USER_ID` / `GROUP_ID` so the
bind-mounted `/app` stays writable from the host, and `TZ`.

## Dev stack — a shell with S3 attached

`compose.dev.yaml` builds a development container with the repository
bind-mounted at `/app`, alongside a
[SeaweedFS](https://github.com/seaweedfs/seaweedfs) service that speaks the S3
API and a one-shot job that creates the `waxlens` bucket.

```sh
./setup.sh
docker compose -f compose.dev.yaml up -d --build
docker compose -f compose.dev.yaml exec waxlens bash
```

Then, inside the container:

```sh
pnpm install && pnpm --filter @waxlens/core build
aws --endpoint-url http://seaweedfs:8333 s3 cp samples/wikipedia.wacz s3://waxlens/wikipedia.wacz
./packages/core/dist/cli.js --profile browserhive s3://waxlens/wikipedia.wacz
```

The container's `node_modules` are named volumes rather than part of the bind
mount, at the three places a pnpm workspace keeps them. The Linux binaries
installed inside therefore never reach the host's tree, and the host's macOS
binaries never reach the container.

Uploaded archives are browsable at `http://localhost:8888/buckets/waxlens/`.

## Prod stack — one validation, then exit

`compose.prod.yaml` builds the production image and runs it once. The `waxlens`
service sits behind `profiles: [run]`, so `up` starts only the store:

```sh
docker compose -f compose.prod.yaml up -d

# SeaweedFS publishes no host ports here, so upload from a sidecar
# AWS CLI container on the same network.
docker run --rm --network waxlens-network \
  -v $(pwd)/samples:/samples:ro \
  -e AWS_ACCESS_KEY_ID=waxlens -e AWS_SECRET_ACCESS_KEY=waxlens \
  -e AWS_REGION=us-east-1 -e AWS_ENDPOINT_URL_S3=http://seaweedfs:8333 \
  amazon/aws-cli s3 cp /samples/wikipedia.wacz s3://waxlens/wikipedia.wacz

docker compose -f compose.prod.yaml --profile run run --rm waxlens \
  --profile browserhive s3://waxlens/wikipedia.wacz

docker compose -f compose.prod.yaml down
```

The two `--profile` flags in that run command are unrelated: the first is
Compose's service profile, the second is waxlens' own strictness setting. The
image's entrypoint is the CLI, so everything after the service name is passed
straight to it.

## How the credentials reach waxlens

Both stacks set the same four variables. `AWS_ENDPOINT_URL_S3` is read by the
AWS SDK's default chain, so pointing waxlens at the bundled store takes no code
path of its own. `AWS_REGION` is required by the SDK and ignored by SeaweedFS.
`WAXLENS_S3_FORCE_PATH_STYLE=true` is opt-in because SeaweedFS has no wildcard
DNS for bucket subdomains, which is what virtual-hosted-style addressing needs.

The configuration is written for the bundled SeaweedFS. Pointing it at AWS, R2
or another S3-compatible service is not currently a supported setup.
