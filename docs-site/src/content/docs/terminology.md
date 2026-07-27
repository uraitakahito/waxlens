---
title: Terminology
description: The WACZ vocabulary this project uses, and where it comes from.
---

waxlens uses the vocabulary defined by
[WACZ 1.1.1 §Terminology](https://specs.webrecorder.net/wacz/1.1.1/#terminology)
without paraphrasing it. This page collects the terms that appear throughout
these docs, so that a word means one thing here and the same thing in the spec.

| Term | What it means here |
| ---- | ------------------ |
| `ZIP file` | The container. The format is `ZIP`; the archive as a whole is a WACZ, not "a zip". |
| `WACZ` | *Web Archive Collection Zipped* — WARC data plus its metadata packaged as a `ZIP file`. |
| `WARC` | The record format inside `archive/`. |
| `Web Archive` | The captured material as a whole — not the `archive/` directory, which is one part of it. |
| `Page` | An entry in `pages/pages.jsonl`. Not any web page in general. |
| `Media Type` | The value classifying content. Distinct from the HTTP header name `Content-Type`. |
| `Collection` | The grouping a WACZ represents. |
| `Package` | The Frictionless Data Package that `datapackage.json` describes. Unrelated to an npm package. |
| `Context` | As used by the spec. |

## Scope

The vocabulary applies to **prose** — this site and source comments. Code
identifiers (variables, functions, types, rule names) follow the codebase's own
conventions and are out of scope.

Where a word is being used in its ordinary sense rather than as a spec concept,
it is just that word: a "spec page" is a page on a website, and an "npm package"
is not a Data Package.

## For Japanese readers

The Japanese version of this page carries an additional rule that has no
counterpart here: spec terms stay **in English inside Japanese prose**, rather
than being translated. The point is to remove the choice — and therefore the
inconsistency — between a translated term and the original.

A Japanese translation of the specification itself is published separately at
[uraitakahito.github.io/specs](https://uraitakahito.github.io/specs/wacz/1.1.1/#terminology).
