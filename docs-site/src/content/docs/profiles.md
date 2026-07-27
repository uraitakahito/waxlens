---
title: Profiles
description: What --profile changes, and what it never changes.
---

`--profile <name>` picks how strictly producer-specific and stylistic findings
are graded. The default is `spec`.

A profile **re-grades severities. It never suppresses a check the spec
requires** — a `MUST` violation is still reported under every profile, even if
`lenient` prints it as `info`.

## The three profiles

### `spec` (default)

WACZ spec plus wabac.js loader compatibility. An archive that exits 0 here is
expected to replay correctly in [ReplayWeb.page](https://replayweb.page/), bugs
in wabac.js itself aside.

This is the profile to use when the question is "is this archive correct?"

### `browserhive`

`spec` plus the stricter producer conventions of
[BrowserHive](https://uraitakahito.github.io/browserhive/) — for example that
`indexes/index.cdxj` is stored plain, so a `.cdxj.gz` is rejected even when
paired with a `.idx`.

Use it when the archive is known to come from BrowserHive and you want its house
rules enforced too. On any other producer's output it will report conventions
that archive never agreed to follow.

### `lenient`

Demotes every producer-specific and stylistic finding to `info`, leaving only
the hard errors that break replay.

Use it to triage legacy archives, where the question is not "is this correct?"
but "is this salvageable?"

## Which rules a profile actually changes

The [Rules](/waxlens/rules/) table has a **Profile overrides** column showing
exactly which rules are re-graded and to what. Rules with an empty cell behave
identically under all three profiles.

That column is generated from each rule's `applicability` declaration, so it is
the authoritative answer — not a summary of one.

## Exit codes

The profile affects the exit code only through severity: what counts as a
failure is unchanged, but a rule demoted to `info` no longer contributes one.
The mapping from report to exit code lives in `@waxlens/protocol`
(`exitCodeFor`), shared by the CLI and the TUI so both agree.
