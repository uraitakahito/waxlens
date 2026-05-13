# Rules reference

Every rule in `src/validate/rules/` has a stable `<area>/<short-name>`
identifier that ends up in `Issue.rule` and (eventually) the `--rule`
filter. The table below is the canonical list, ordered by registry
position (which is the order the renderers walk issues in).

Severity columns below show how each rule fires under each profile.
The default profile is **`spec`** (WACZ spec + wabac.js
compatibility). See [Profiles](#profiles) below for the full meaning
of each column.

| #   | Name                                | spec    | browserhive | lenient | What it catches                                                                    |
| --- | ----------------------------------- | ------- | ----------- | ------- | ---------------------------------------------------------------------------------- |
| 1   | `datapackage/profile-required`      | error   | error       | error   | `datapackage.json` missing or wrong `profile: "data-package"`                      |
| 2   | `datapackage/wacz-version-required` | error   | error       | warning | `wacz_version` missing or empty; warns on values outside the known-good set        |
| 3   | `datapackage/resource-hashes`       | error   | error       | error   | resources' sha256 hash or byte length doesn't match the archive                    |
| 4   | `cdxj/index-recognised-by-wabac`    | error   | error       | error   | no `.cdx` / `.cdxj` / `.idx` under `indexes/` (wabac.js can't load anything)       |
| 5   | `cdxj/index-not-gzipped`            | warning | error       | info    | gzipped CDXJ without a paired `.idx` (producer-strict for browserhive)             |
| 6   | `cdxj/filename-archive-relative`    | error   | error       | warning | CDXJ `filename` field starts with `archive/`                                       |
| 7   | `warc/storage-store`                | warning | warning     | info    | `archive/data.warc.gz` is zip-stored with DEFLATE instead of STORE                 |
| 8   | `warc/members-independent`          | error   | error       | error   | WARC.gz can't be decoded as a concatenation of independent gzip members            |
| 9   | `cdxj/warc-offsets`                 | error   | error       | warning | CDXJ offset/length doesn't land on a member boundary                               |
| 10  | `cdxj/pages-mainpage`               | warning | warning     | info    | `datapackage.mainPageURL` is not listed in `pages.jsonl` and/or has no CDXJ record |
| 11  | `warc/payload-digest`               | warning | warning     | warning | `WARC-Payload-Digest` doesn't match a fresh sha256 of the payload bytes            |
| 12  | `fuzzy/valid-json`                  | info    | info        | info    | `fuzzy.json` is malformed (not JSON / not an object / missing `rules` array)       |

## Severity legend

- `error` — flips `valid` to `false`, contributes to `summary.failed`,
  drives exit code `1`.
- `warning` — known producer bug or replay-degrading mistake, but the
  WACZ is still likely usable. Does NOT flip exit code.
- `info` — informational; spec-permitted producer choices that callers
  may want to know about. Does NOT flip exit code.

## Profiles

Selected via `--profile <name>` (default `spec`). A profile reshapes
the severity of producer-specific or stylistic rules — it never
silences a check that's spec-mandated.

- **`spec`** (default) — WACZ spec + wabac.js loader compatibility.
  An archive that exits 0 under this profile should replay correctly
  in [ReplayWeb.page](https://replayweb.page/) (modulo bugs in
  wabac.js itself).
- **`browserhive`** — Adds BrowserHive's stricter producer
  conventions on top of `spec`. Use when you specifically expect a
  BrowserHive-produced archive (e.g. `indexes/index.cdxj` plain,
  not `.cdxj.gz` even when paired with `.idx`).
- **`lenient`** — Demotes every producer-specific or stylistic
  finding to `info`. Useful for triaging legacy archives where you
  only care about the hard "replay broken" errors.

The matrix above is the source of truth; per-rule rationale lives in
each rule's `applicability` declaration in `src/validate/rules/`.

## Rule details

Each rule's source file carries a doc comment with the why and inline
references. The summary below mirrors those, with a consistent
three-source format:

- **Spec**: the relevant WACZ / WARC / Frictionless-Data clause
- **Replay engine**: how [wabac.js](https://github.com/webrecorder/wabac.js)
  (the engine behind ReplayWeb.page) actually treats the field
- **Reference producer**: where a known producer commits to it in code
  (today: [BrowserHive](https://github.com/uraitakahito/browserhive),
  but the rule is the contract, not the producer)

### `datapackage/profile-required` — error

`datapackage.json` MUST set `profile: "data-package"`. Without it,
wabac.js / ReplayWeb.page classifies the WACZ as invalid and the CDX
lookup never runs, producing the cryptic "Archived Page Not Found"
error even when everything else is correct.

- **Spec**: WACZ 1.1 §datapackage.json (Frictionless Data Package marker)
- **Reference producer**: [browserhive `wacz/datapackage.ts:42-49`](https://github.com/uraitakahito/browserhive/blob/main/src/storage/wacz/datapackage.ts)
  documents the silent-fail trap directly.

### `datapackage/wacz-version-required` — error

The `wacz_version` field MUST be a non-empty string. Recognised values
are `1.0.0`, `1.1.0`, `1.1.1`; anything else fires a `warning`-level
issue so an operator can decide whether to upgrade waxlens or accept
the unknown version.

- **Spec**: [WACZ format specs](https://specs.webrecorder.net/wacz/)

### `datapackage/resource-hashes` — error

Each entry in `datapackage.json#resources[]` declares the `sha256:<hex>`
hash and byte length of one of the other zip entries. The rule
recomputes both from the actual bytes and surfaces mismatches with the
expected/actual hashes in `details` (rendered as a diff in the TUI).

### `cdxj/index-recognised-by-wabac` — error (every profile)

The WACZ MUST carry at least one entry under `indexes/` that wabac.js
will actually load. The loader recognises three suffixes — `.cdx`,
`.cdxj`, or `.idx` (the last paired with a `.cdx.gz` named via the
`.idx`'s `!meta { format: "cdxj-gzip-1.0", filename }` header). A
bare `.cdx.gz` / `.cdxj.gz` with no `.idx` pair is silently skipped
by wabac.js, so replay never gets an index and every URL lookup
fails. This rule fires `error` in every profile because the issue
is replay-breaking regardless of producer.

When an `.idx` is present but the file it names isn't in the zip,
the rule fires a `warning` (the `.idx` will load but every lookup
misses).

- **Replay engine**: [wabac.js `multiwacz.ts:loadIndex`](https://github.com/webrecorder/wabac.js/blob/main/src/wacz/multiwacz.ts)
  — `endsWith(".cdx") || endsWith(".cdxj")` for direct loading, plus
  `endsWith(".idx")` for compressed indices.

### `cdxj/index-not-gzipped` — warning (spec) / error (browserhive) / info (lenient)

Producer-strict variant of the wabac-recognition contract: when the
producer is expected to emit a plain `indexes/index.cdxj`, this rule
surfaces any `.cdxj.gz` / `.cdx.gz` variant (or a `.cdxj` file whose
content begins with the gzip magic). It is `warning`-level in the
default profile because spec-conformant `.cdx.gz` paired with an
`.idx` is fine; the strict `browserhive` profile escalates it to
`error` because BrowserHive commits to the plain form.

- **Replay engine**: [wabac.js `multiwacz.ts:loadIndex`](https://github.com/webrecorder/wabac.js/blob/main/src/wacz/multiwacz.ts)
  — only `.cdx`, `.cdxj`, `.idx` are recognised directly.
- **Reference producer**: [browserhive `wacz/packager.ts:46-56`](https://github.com/uraitakahito/browserhive/blob/main/src/storage/wacz/packager.ts)
  commits to plain `indexes/index.cdxj`.

### `cdxj/filename-archive-relative` — error

Each CDXJ row's `filename` field is the WARC filename RELATIVE to the
WACZ's `archive/` directory (e.g. `data.warc.gz`, not
`archive/data.warc.gz`). wabac.js prepends `archive/` itself; writing
the full path makes it look up `archive/archive/data.warc.gz` and 404
every URL.

- **Reference producer**: [browserhive `wacz/packager.ts:36-44`](https://github.com/uraitakahito/browserhive/blob/main/src/storage/wacz/packager.ts)
  names the constant `WARC_FILENAME_FOR_CDX` with a comment explaining
  the gotcha.

### `warc/storage-store` — warning

`archive/data.warc.gz` SHOULD be stored with method STORE (no zip-level
compression). The inner WARC is already gzipped; deflating the gzip
wrapper inflates the file size for no decompression benefit, and
breaks raw-byte offset indexers that seek into the zip directly via
the CDXJ offsets. Tools that read the whole entry into memory still
work; this is a `warning` rather than `error` because we can't tell
which class of downstream consumer the WACZ is going to.

### `warc/members-independent` — error

A `.warc.gz` produced per the WARC spec is a concatenation of
independent gzip members — one per record — so that an offset/length
pair from the CDXJ index can be used to seek to a single record without
decoding the rest. The rule iterates the file with strict-mode
decoding; any failure surfaces with the offending offset and the
underlying zlib error message in `details`.

### `cdxj/warc-offsets` — error

Every CDXJ row's `offset` / `length` MUST land on an independent gzip
member's start and cover exactly that member's compressed length. The
rule cross-references CDXJ entries against the WARC's actual member
boundaries; mismatches expose both the requested range and the actual
record header at the candidate offsets (TUI's WARC-header view), so
the operator can tell whether the CDXJ row is pointing at the wrong
record or whether the WARC itself got rewritten.

### `cdxj/pages-mainpage` — warning

`datapackage.mainPageURL` should appear in BOTH `pages/pages.jsonl`
AND `indexes/index.cdxj`. Either gap silently breaks the replay
landing page without breaking the rest of the WACZ structure. Severity
is `warning` because the rest of the archive may still be deep-link
replayable.

### `warc/payload-digest` — warning

`WARC-Payload-Digest` MUST match a fresh sha256 over the record's
payload. "Payload" is type-dependent per WARC 1.1 §6.2:

- `warcinfo`, `metadata`, `resource` — body verbatim
- `response`, `request` — HTTP entity body (bytes after the inner
  `\r\n\r\n` separator)
- `revisit` — intentionally NOT checked (revisit records re-state
  another record's digest)

Producers that emit non-sha256 algorithms (e.g. `sha1:`) are accepted
with an info-level note rather than a warning, since the spec allows
arbitrary `algorithm:value` and waxlens isn't a spec-coverage suite.
Mismatch `details` carry a 256-byte hex preview of the payload, so the
operator can eyeball whether the bytes look right for the resource
the record claims to be carrying.

### `fuzzy/valid-json` — info

`fuzzy.json` is optional per the WACZ spec but unconditionally emitted
by browserhive. When present it MUST be valid JSON whose top level is
an object with a `rules` array. Anything else is silently ignored by
replay engines — informational rather than a replay-breaking bug.

## Adding a new rule

1. Create `src/validate/rules/<area>-<short-name>.ts`. Export a
   `ValidationRule` object whose `name` matches the file (kebab-case).
2. Include a doc comment with the WACZ-spec / wabac.js / browserhive
   reference that motivates the rule, and the severity rationale.
3. Add the rule to `ALL_RULES` in `src/validate/rules/index.ts`.
4. Add a fixture variant to `test/fixtures/generator.ts` and a test
   in `test/validate.test.ts` that exercises both the happy path and
   the corruption.
5. (Optional) Attach a TUI-friendly `details` shape so the expanded
   view tells the operator what specifically went wrong. The available
   specialised views are: `{ expected, actual }` → diff,
   `{ warcHeader: string[] }` → header preview,
   `{ hexPreview: string[] }` → hex dump,
   `{ candidates: [...] }` → nearby-members list. Anything else falls
   back to JSON-pretty.
