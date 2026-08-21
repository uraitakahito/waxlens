---
title: Break it on purpose
description: Take a WACZ captured by BrowserHive, break it deliberately, and watch a rule turn red
---

A validator's green means one of two things: it checked and found nothing, or it
never checked at all. **There is one way to tell them apart — break the archive
and watch a rule turn red.**

`waxlens-break`, from the `@waxlens/devtools` package (development only, never
published), saves you from writing that one step by hand every time.

## The flow

| Step | Tool | What it does |
| --- | --- | --- |
| 1 | BrowserHive | Capture a page; the WACZ lands in S3 |
| 2 | aws cli | Pull it down |
| 3 | `waxlens-validate` | **Take a baseline.** Nothing below means anything unless this is green |
| 4 | `waxlens-break` | Break it on purpose |
| 5 | `waxlens-validate` | Watch it turn red |

**Steps 3 and 5 are a pair.** Looking only at 5 and concluding "it is red, so the
check works" leaves you blind the day you pick up an archive that was already
broken.

## 1. Capture with BrowserHive

Pick a page that touches several hosts. With a single host you get one chain, and
neither sharing nor substitution is visible.

```sh
cd ~/projects/crawler/browserhive
pnpm run stack:up

grpcurl -plaintext -import-path src/rpc/proto -proto browserhive/v1/capture.proto \
  -d '{"url":"https://www.iana.org/","labels":["chain-demo"],
       "captureFormats":{"png":false,"webp":false,"html":false,
                         "links":false,"mhtml":false,"wacz":true}}' \
  browserhive.browserhive:50051 browserhive.v1.CaptureService/SubmitCapture
```

:::caution
The `san` check needs an archive captured by **BrowserHive 3.7.0 or later**.
Below that, `browserhive/tls-san` lands in `skipped` — which is the correct
behaviour. Chain verification itself does not depend on the version.
:::

## 2. Pull it down

```sh
AWS_ACCESS_KEY_ID=browserhive AWS_SECRET_ACCESS_KEY=browserhive \
  aws --endpoint-url http://seaweedfs.browserhive:8333 s3 cp \
  s3://browserhive/<taskId>_chain-demo.wacz ./demo.wacz
```

## 3. Take a baseline

```sh
pnpm install && pnpm -r build

node packages/validate-cli/dist/waxlens-validate.js \
  --profile browserhive ./demo.wacz \
  | jq -r '"summary: \(.summary)",
           (.issues[] | select(.rule|startswith("browserhive/tls"))
            | "  [\(.severity)] \(.message)")'
```

```
summary: {"passed":23,"failed":0,"warnings":2,"info":1,"durationMs":61}
  [info] 4 host の証明書チェーンを検証しました
```

Two things to look at.

- **`failed: 0`** — nothing is broken. This is what lets you attribute the red
  below to the mutation.
- **the `info` line** — the rule actually ran. Without it, nothing you break will
  turn red, because nothing is being checked.

## 4. Break it

```sh
node packages/devtools/dist/break-wacz.js --list
```

```
壊し方と、それが出させる報告:

  swap-intermediate    → browserhive/tls-chain.broken-link
  reverse-chain        → browserhive/tls-chain.leaf-not-first
  drop-chains          → browserhive/tls-chain.dangling-ref
  garbage-der          → browserhive/tls-chain.unparseable
  san-drift            → browserhive/tls-san.drift
```

```sh
node packages/devtools/dist/break-wacz.js \
  ./demo.wacz ./demo-broken.wacz -m swap-intermediate
```

**The certificates stay real.** Rather than substituting made-up DER, the tool
borrows an intermediate from another host's chain — leaving two genuine
certificates in an order that does not link.

:::note
`waxlens-break` changes **only the one thing it names**. It writes entries back
with their original compression, so no unrelated finding appears — one that does
is a finding a reader will chase.
:::

## 5. Watch it turn red

```sh
node packages/validate-cli/dist/waxlens-validate.js \
  --profile browserhive ./demo-broken.wacz \
  | jq -r '"summary: \(.summary)",
           (.issues[] | select(.severity=="error") | "  [\(.severity)] \(.message)")'
```

```
summary: {"passed":22,"failed":2,"warnings":2,"info":1,"durationMs":57}
  [error] cse.google.com: 0 番目の証明書が次と繋がっていません(発行者 WR2 / 次の subject WE2)
  [error] clients1.google.com: 0 番目の証明書が次と繋がっていません(発行者 WR2 / 次の subject WE2)
```

**Only now can you say the check works.** Step 3 green, step 5 red — the
difference is the whole of the evidence.

### One break, two hosts red

That is correct. Certificate chains are de-duplicated **by content**, so several
hosts can point at the same one.

```
www.iana.org           chainRef=9a57318f8c89976c
cse.google.com         chainRef=c52653c92800f6fd  ┐ same chain
www.google.com         chainRef=d4c643e77f3e2f17  │
clients1.google.com    chainRef=c52653c92800f6fd  ┘
```

Break it and every host pointing at it is affected.

## Reading it as a ladder in the TUI

```sh
node packages/tui/dist/cli.js --profile browserhive ./demo-broken.wacz
```

Press `enter` on the issue and the chain opens as a ladder per host: `─┐` links
to the next certificate with a verified signature, `─✗` does not.

For CI and scripts use `waxlens-validate`'s JSON — the TUI needs a terminal, but
**the same `details` is in the JSON**.
