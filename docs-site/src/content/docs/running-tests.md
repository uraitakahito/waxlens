---
title: Running the tests
description: What `pnpm check` covers, the corpus tests it deliberately skips, and what CI runs
---

Everything routine is behind one command:

```sh
pnpm check
```

It runs `pnpm audit` and then, package by package, `typecheck → lint → build → test`.
Four packages, in dependency order, so a break surfaces in the package that
caused it rather than three packages downstream.

**Nothing here needs a network, a container, or a WACZ file on disk.** The one
suite that does is skipped unless you ask for it — see below.

## Commands

| Command | Scope |
| --- | --- |
| `pnpm check` | audit + all four packages. **What CI runs.** |
| `pnpm test` | tests only, all packages |
| `pnpm --filter @waxlens/core test` | one package |
| `pnpm --filter @waxlens/core test:watch` | one package, watching |
| `pnpm typecheck` / `pnpm lint` / `pnpm build` | one stage across all packages |

`--filter` takes the package name, not the directory: `@waxlens/core`,
`@waxlens/daemon`, `@waxlens/protocol`, `@waxlens/tui`.

`@waxlens/protocol` has no tests — it is the wire contract, and its `check` stops
after `build`. That is not an omission: there is nothing there to run.

## Why `build` comes before `test`

Each package's `check` is `typecheck && lint && build && test`, and the order is
deliberate. `@waxlens/daemon` and `@waxlens/tui` generate `build-info.ts` as part
of their build; running their tests against a stale or missing one tests the
wrong thing. Type errors and lint failures also cost seconds, while a build costs
longer — cheap gates first.

## The corpus tests

`@waxlens/core` carries a second kind of test: it validates **real WACZ archives**
from the [waxlens-corpus](/corpus/) repository rather than fixtures built inline.
Those need the archives, so they read `CORPUS_DIR` and **skip when it is unset**:

```
Test Files  20 passed | 2 skipped (22)
      Tests  113 passed | 4 skipped (117)
```

That is what a normal `pnpm check` looks like. The skip is why the routine
command stays hermetic.

To run them, clone the corpus beside this repository and point at it with an
**absolute** path:

```sh
CORPUS_DIR="$(cd ../waxlens-corpus && pwd)" pnpm --filter @waxlens/core test:corpus
```

The `$(cd … && pwd)` is not decoration. `pnpm --filter` runs the script with its
working directory set to `packages/core`, and a relative `CORPUS_DIR` is resolved
there, not in your shell — so `../waxlens-corpus` looks for
`packages/waxlens-corpus`, finds nothing, and the suite **skips while telling you
it found no manifest**. Resolving to an absolute path in the shell first sidesteps
the question.

| Script | What it does |
| --- | --- |
| `test:corpus` | validate every archive in the corpus, compare against `manifest.json` |
| `corpus:docs:check` | fail if `docs/examples.md` has drifted from the corpus |
| `corpus:build` | **regenerate** the archives and the manifest |

:::danger[`corpus:build` deletes before it writes]
It removes `$CORPUS_DIR/fixtures` **entirely** and rebuilds it. Anything in there
that the corpus repository does not track is gone, with no way back — this has
cost real work at least once.

Check `git status` in the corpus repository before running it, and never point
`CORPUS_DIR` at a directory holding archives you cannot regenerate.
:::

## What CI runs

Five workflows, and only the first is the one you reproduce locally with
`pnpm check`.

| Workflow | Runs |
| --- | --- |
| `check` | `pnpm check` — the whole routine suite |
| `corpus` | clones waxlens-corpus, then `corpus:docs:check` and `test:corpus` |
| `pack-smoke` | `npm pack` for `@waxlens/core` and `@waxlens/tui`, then installs each into a clean directory and runs its binary |
| `site` | builds the documentation and verifies its references |
| `docs` | publishes the site |

`pack-smoke` is the one that catches what the others cannot: a package that
builds and tests fine here but ships a broken tarball, because `files` missed
something or a binary lost its executable bit.
