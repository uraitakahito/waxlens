---
title: JSON report
description: The shape of --json output, and what is promised about it.
---

`waxlens-validate --json` prints one JSON object. It is the interface for CI
scripts and for anything downstream of waxlens, so its shape is deliberate
rather than incidental.

```sh
waxlens-validate --json samples/wikipedia.wacz | jq '{valid, summary}'
```

## Top level

```ts file="packages/core/src/validate/domain.ts#report"
```

`valid` is a cached `summary.failed === 0` — consumers do not have to recompute
it. `issues` are in rule registration order, which means the structural checks
come first and the most likely producer bug tends to be near the top.

## Summary

```ts file="packages/core/src/validate/domain.ts#report-summary"
```

`durationMs` measures the validation run, not process startup.

## Issues

Each issue names the rule that raised it, so a report can be filtered or diffed
by rule without parsing prose:

- `rule` — the stable `<area>/<short-name>` identifier, the same string used in
  the [Rules](/waxlens/rules/) table. Never localised, never reformatted between
  versions.
- `severity` — after profile re-grading, so this is what the run actually
  decided rather than the rule's default.
- `messageKey` + `params` — the message is **not** pre-rendered prose. core
  keeps an i18n key and the runtime values; the renderer resolves them against a
  locale catalogue. That is what lets the TUI and a future browser frontend
  present the same report in different languages.
- `location` — where in the archive, when the rule can say.

## What is promised

`waxlensVersion` mirrors `package.json#version` and exists so a consumer can
detect schema drift rather than guess at it.

Within a major version:

- Existing fields keep their meaning and type.
- `rule` identifiers are stable — they are the thing to key on.
- New optional fields may appear. Consumers should ignore what they do not know
  rather than reject the document.

`stats` is best-effort and optional by design: a WARC broken enough to defeat
statistics must not block the report that says so.

## Exit codes

The exit code is derived from the report by `exitCodeFor` in
`@waxlens/protocol`, shared by the CLI and the TUI so the two cannot disagree.
Deciding from `valid` in your own script is equivalent for the common case; use
the shared helper when the distinction between failure kinds matters.
