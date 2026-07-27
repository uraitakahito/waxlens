---
title: Quickstart
description: Install waxlens and validate your first WACZ.
---

## Install

waxlens is a pnpm workspace of four packages. Build them, then register the two
binaries globally:

```sh
pnpm install --frozen-lockfile
pnpm build

pnpm --dir packages/core add -g .   # waxlens-validate
pnpm --dir packages/tui  add -g .   # waxlens
```

After that both names work from anywhere, inside the repository or out.

## Validate one archive

```sh
waxlens-validate samples/wikipedia.wacz
```

That is the non-interactive path: it prints a report and exits with a code you
can branch on in CI. For an interactive read of the same report, use the TUI:

```sh
waxlens samples/wikipedia.wacz
```

`waxlens` starts `waxlens-daemon` as a child process and talks to it over
WebSocket. To attach to a daemon that is already running:

```sh
waxlens --server ws://127.0.0.1:PORT samples/wikipedia.wacz
```

## Choose how strict to be

The default profile is `spec`. An archive that exits 0 under it is expected to
replay correctly in [ReplayWeb.page](https://replayweb.page/).

```sh
waxlens-validate --profile browserhive samples/wikipedia.wacz   # stricter
waxlens-validate --profile lenient     samples/wikipedia.wacz   # triage mode
```

Profiles only re-grade producer-specific and stylistic rules; they never
suppress a check the spec requires. See [Profiles](/waxlens/profiles/).

## Machine-readable output

```sh
waxlens-validate --json samples/wikipedia.wacz | jq '{valid, summary}'
```

The shape is stable and documented in [JSON report](/waxlens/json-report/).

## Next

- What every rule checks → [Rules](/waxlens/rules/)
- Archives that deliberately fail → [Corpus](/waxlens/corpus/)
