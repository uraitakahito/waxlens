# Rules reference

Every rule in `src/validate/rules/` has a stable `<area>/<short-name>`
identifier that ends up in `Issue.rule` and (eventually) the `--rule`
filter. The table below is the canonical list, ordered by registry
position (which is the order the renderers walk issues in).

| #   | Name                                | Severity | What it catches                                                                    |
| --- | ----------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| 1   | `datapackage/profile-required`      | error    | `datapackage.json` missing or wrong `profile: "data-package"`                      |
| 2   | `datapackage/wacz-version-required` | error    | `wacz_version` missing or empty; warns on values outside the known-good set        |
| 3   | `datapackage/resource-hashes`       | error    | resources' sha256 hash or byte length doesn't match the archive                    |
| 4   | `cdxj/index-not-gzipped`            | error    | `index.cdxj.gz` / `index.cdx.gz` / gzip-magic at the start of `index.cdxj`         |
| 5   | `cdxj/filename-archive-relative`    | error    | CDXJ `filename` field starts with `archive/`                                       |
| 6   | `warc/storage-store`                | warning  | `archive/data.warc.gz` is zip-stored with DEFLATE instead of STORE                 |
| 7   | `warc/members-independent`          | error    | WARC.gz can't be decoded as a concatenation of independent gzip members            |
| 8   | `cdxj/warc-offsets`                 | error    | CDXJ offset/length doesn't land on a member boundary                               |
| 9   | `cdxj/pages-mainpage`               | warning  | `datapackage.mainPageURL` is not listed in `pages.jsonl` and/or has no CDXJ record |
| 10  | `warc/payload-digest`               | warning  | `WARC-Payload-Digest` doesn't match a fresh sha256 of the payload bytes            |
| 11  | `fuzzy/valid-json`                  | info     | `fuzzy.json` is malformed (not JSON / not an object / missing `rules` array)       |

## Severity legend

- `error` — flips `valid` to `false`, contributes to `summary.failed`,
  drives exit code `1`.
- `warning` — known producer bug or replay-degrading mistake, but the
  WACZ is still likely usable. Does NOT flip exit code.
- `info` — informational; spec-permitted producer choices that callers
  may want to know about. Does NOT flip exit code.

## Rule details

Each rule's source file carries a doc comment with the why and an
inline reference back to the upstream code that motivates it
(browserhive's `src/storage/wacz/` producer, the WACZ spec, or
wabac.js). The summary below mirrors those, lightly editorialised.

### `datapackage/profile-required` — error

`datapackage.json` MUST set `profile: "data-package"`. Without it,
ReplayWeb.page / wabac.js classifies the WACZ as invalid and the CDX
lookup never runs, producing the cryptic "Archived Page Not Found"
error even when everything else is correct. Source:
[browserhive `wacz/datapackage.ts:42-49`](https://github.com/uraitakahito/browserhive/blob/main/src/storage/wacz/datapackage.ts).

### `datapackage/wacz-version-required` — error

The `wacz_version` field MUST be a non-empty string. Recognised values
are `1.0.0`, `1.1.0`, `1.1.1`; anything else fires a `warning`-level
issue so an operator can decide whether to upgrade waxlens or accept
the unknown version. Source:
[WACZ specs](https://specs.webrecorder.net/wacz/).

### `datapackage/resource-hashes` — error

Each entry in `datapackage.json#resources[]` declares the `sha256:<hex>`
hash and byte length of one of the other zip entries. The rule
recomputes both from the actual bytes and surfaces mismatches with the
expected/actual hashes in `details` (rendered as a diff in the TUI).

### `cdxj/index-not-gzipped` — error

`indexes/index.cdxj` MUST be a plain (uncompressed) text file inside
the zip. wabac.js's `loadIndex` only recognises entry names ending in
`.cdx`, `.cdxj`, or `.idx` — `.cdx.gz` / `.cdxj.gz` are silently
skipped, which makes every URL lookup return "Archived Page Not Found"
even when the WACZ otherwise looks fine. Source:
[browserhive `wacz/packager.ts:46-56`](https://github.com/uraitakahito/browserhive/blob/main/src/storage/wacz/packager.ts).

### `cdxj/filename-archive-relative` — error

Each CDXJ row's `filename` field is the WARC filename RELATIVE to the
WACZ's `archive/` directory (e.g. `data.warc.gz`, not
`archive/data.warc.gz`). wabac.js prepends `archive/` itself; writing
the full path makes it look up `archive/archive/data.warc.gz` and 404
every URL. Source:
[browserhive `wacz/packager.ts:36-44`](https://github.com/uraitakahito/browserhive/blob/main/src/storage/wacz/packager.ts).

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
