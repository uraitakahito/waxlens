---
title: Apple Container stack
description: Validate s3:// sources against the bundled SeaweedFS.
---

The repository ships one stack file, `docker-compose.yml`, driven by
[container-compose](https://github.com/Mcrich23/Container-Compose) on
[Apple Container](https://github.com/apple/container). It holds a single
service: a [SeaweedFS](https://github.com/seaweedfs/seaweedfs) that speaks the
S3 API. Nothing in it produces archives — no
[BrowserHive](https://uraitakahito.github.io/browserhive/), no browser — which
is what keeps waxlens loosely coupled to whatever wrote the WACZ.

waxlens itself is not a service in that file. Apple Container's compose has
exactly four subcommands (`up`, `down`, `build`, `version`), so a one-shot
service could not be driven from it. waxlens runs either on your host or as a
`container run` invocation; both are below.

## One-time setup

```sh
brew install mcrich23/formulae/container-compose
sudo container system dns create waxlens
```

The domain name must match the `name:` in `docker-compose.yml`. That is what
registers the container as `seaweedfs.waxlens` with the platform DNS and makes
it resolvable **from the host as well as from other containers** — the reason
there is no development container here.

## Start the store

```sh
container-compose up -d -b
```

The `waxlens` bucket is created by a retry loop inside the container's own
entrypoint. There is no init container to sequence, because `depends_on` is
start order only here and `healthcheck:` is not read at all. Wait for the
master before using the bucket:

```sh
until curl -sf http://localhost:9333/cluster/status >/dev/null; do sleep 1; done
```

## Upload an archive

A sidecar AWS CLI container keeps this working without installing anything on
the host:

```sh
container run --rm \
  -v "$(pwd)/samples:/samples" \
  -e AWS_ACCESS_KEY_ID=waxlens -e AWS_SECRET_ACCESS_KEY=waxlens \
  -e AWS_REGION=us-east-1 -e AWS_ENDPOINT_URL_S3=http://seaweedfs.waxlens:8333 \
  docker.io/amazon/aws-cli s3 cp /samples/wikipedia.wacz s3://waxlens/wikipedia.wacz
```

Uploaded archives are browsable at `http://localhost:8888/buckets/waxlens/`.

## Validate — on the host

This is the development path. Point the AWS SDK's default chain at the store
and run the CLI you already built:

```sh
unset AWS_PROFILE          # see below — a set profile wins over these
export AWS_ENDPOINT_URL_S3=http://seaweedfs.waxlens:8333
export AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=waxlens AWS_SECRET_ACCESS_KEY=waxlens
export WAXLENS_S3_FORCE_PATH_STYLE=true

./packages/core/dist/cli.js s3://waxlens/wikipedia.wacz
```

`http://localhost:8333` works just as well as the container name, since the
ports are published on the loopback address.

:::caution[`AWS_PROFILE` outranks these variables]
If your shell already exports `AWS_PROFILE` — anyone with a real AWS setup
does — the SDK uses **that profile** and ignores the access key pair above.
With an SSO profile the failure is confusing rather than obvious:

```
waxlens-validate: cannot open "s3://waxlens/wikipedia.wacz":
  Token is expired. To refresh this SSO session run 'aws sso login' ...
```

Nothing is wrong with the stack; the request never went to it. Unset the
variable for the shell, or prefix the command with `env -u AWS_PROFILE`.
:::

The bundled `samples/wikipedia.wacz` passes under the default `spec` profile.
It does **not** pass `--profile browserhive`: it was produced by webrecorder
and has a gzipped CDXJ index, which that profile rejects. That is the profile
doing its job — see [Profiles](/waxlens/profiles/).

## Validate — in the image

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

The image's entrypoint is the CLI, so everything after the image name is passed
straight to it, and the exit code is waxlens' own.

`NODE_OPTIONS=--dns-result-order=ipv4first` is needed only inside a container:
the platform DNS publishes AAAA records but there is no v6 route between the
VMs, so Node resolving v6 first would reach nothing. On the host it is
unnecessary.

## Tear down

```sh
container-compose down
```

The named volume survives, so uploaded archives are still there next time. To
start from empty, remove `seaweedfs-data` as well.

## How the credentials reach waxlens

`AWS_ENDPOINT_URL_S3` is read by the AWS SDK's default chain, so pointing
waxlens at the bundled store needs no code path of its own. `AWS_REGION` is
required by the SDK and ignored by SeaweedFS. `WAXLENS_S3_FORCE_PATH_STYLE=true`
is opt-in because SeaweedFS has no wildcard DNS for bucket subdomains, which is
what virtual-hosted-style addressing needs.

The configuration is written for the bundled SeaweedFS. Pointing it at AWS, R2
or another S3-compatible service is not currently a supported setup.
