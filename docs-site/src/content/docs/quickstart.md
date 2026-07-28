---
title: Quickstart
description: Install waxlens and validate your first WACZ.
---

## Install

waxlens is a pnpm workspace of four packages. Build them, then register the
binaries globally:

```sh
pnpm install --frozen-lockfile
pnpm build

pnpm --dir packages/core   add -g .   # waxlens-validate
pnpm --dir packages/tui    add -g .   # waxlens
pnpm --dir packages/daemon add -g .   # waxlens-daemon (only for a long-running daemon)
```

After that the names work from anywhere, inside the repository or out.

The third line is optional. `waxlens` starts a daemon by itself, so you only
need `waxlens-daemon` on `PATH` to run one that outlives a single session — a
dependency's binary is not linked globally, so installing the TUI alone does not
give you that name.

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
WebSocket, so nothing above involves a port.

To attach to a daemon that outlives the session instead, start one on a port you
choose:

```sh
waxlens-daemon --port 7333 &
```

It prints the URL it is listening on:

```
waxlens-daemon ws://127.0.0.1:7333
```

Pass that URL through:

```sh
waxlens --server ws://127.0.0.1:7333 samples/wikipedia.wacz
```

:::note[Where the port comes from]
Without `--port` the daemon uses `0`, meaning **the OS picks a free port** and
the number differs on every start. Fix it with `--port` or
`WAXLENS_DAEMON_PORT`, or copy the URL the daemon prints. There is no default
port to guess.
:::

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
