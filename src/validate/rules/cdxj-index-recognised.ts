/**
 * Rule: cdxj/index-recognised-by-wabac
 *
 * The WACZ MUST carry at least one index file that wabac.js's
 * `multiwacz.ts:loadIndex` will recognise. That loader hard-codes
 * three suffixes:
 *
 *   - `.cdx`  / `.cdxj`   — loaded directly via `loadCDX`
 *   - `.idx`              — loaded via `loadIDX`, which expects a
 *                           `!meta { format: "cdxj-gzip-1.0",
 *                           filename: <file> }` first line and pairs
 *                           with a compressed CDXJ file referenced by
 *                           that `filename`
 *
 * Anything else (a bare `.cdx.gz` / `.cdxj.gz` with no `.idx` pair) is
 * silently skipped by wabac.js, so replay never gets indexed — every
 * URL lookup returns "Archived Page Not Found".
 *
 * Replay engine: wabac.js
 *   https://github.com/webrecorder/wabac.js/blob/main/src/wacz/multiwacz.ts
 *   `loadIndex` line ~465: `if (filename.endsWith(".cdx") ||
 *   filename.endsWith(".cdxj"))` and ~471: `else if (filename.endsWith(".idx"))`.
 *
 * What we report:
 *   - No recognised index file in the WACZ → error.
 *   - `.idx` present but `!meta.filename` doesn't exist in the zip →
 *     warning (the `.idx` will load but its lookups will miss).
 *
 * Severity is `error` for the missing-index branch in every profile —
 * an unreadable index is a replay-breaking bug regardless of
 * producer.
 */
import { ok } from "../../result.js";
import type { Issue, ValidationRule } from "../types.js";

const INDEXES_PREFIX = "indexes/";
const ACCEPTED_SUFFIXES = [".cdx", ".cdxj", ".idx"] as const;

/**
 * Read the first line of an `.idx` file and pull out the
 * `filename` field from the `!meta { format, filename }` header
 * that pywb / wacz-creator emit. Returns null when the header is
 * absent or malformed — the caller treats that as "no pair claimed".
 */
const parseIdxPairFilename = (text: string): string | null => {
  const firstLine = text.split("\n", 1)[0] ?? "";
  if (!firstLine.startsWith("!meta")) return null;
  const braceIdx = firstLine.indexOf("{");
  if (braceIdx < 0) return null;
  let meta: unknown;
  try {
    meta = JSON.parse(firstLine.slice(braceIdx));
  } catch {
    return null;
  }
  if (typeof meta !== "object" || meta === null) return null;
  const filename = (meta as Record<string, unknown>)["filename"];
  return typeof filename === "string" && filename.length > 0 ? filename : null;
};

export const cdxjIndexRecognisedRule: ValidationRule = {
  name: "cdxj/index-recognised-by-wabac",
  description: `WACZ must contain a wabac-recognised index (${ACCEPTED_SUFFIXES.join(" / ")})`,
  severity: "error",

  run: async (wacz) => {
    const issues: Issue[] = [];

    const indexEntries = wacz
      .entryNames()
      .filter((name) => name.startsWith(INDEXES_PREFIX))
      .filter((name) => ACCEPTED_SUFFIXES.some((s) => name.endsWith(s)));

    if (indexEntries.length === 0) {
      issues.push({
        rule: "cdxj/index-recognised-by-wabac",
        severity: "error",
        message:
          "No wabac-recognised index file found under indexes/ — wabac.js needs at least one .cdx / .cdxj / .idx entry to serve any URL",
        location: { entry: INDEXES_PREFIX },
        details: {
          acceptedSuffixes: ACCEPTED_SUFFIXES,
          allIndexEntries: wacz.entryNames().filter((name) => name.startsWith(INDEXES_PREFIX)),
        },
      });
      return ok(issues);
    }

    // For every `.idx` entry, verify its `!meta.filename` pair exists
    // in the zip. A broken pair lets wabac.js see the `.idx` and walk
    // it, but every lookup misses because the compressed CDXJ isn't
    // there.
    for (const name of indexEntries) {
      if (!name.endsWith(".idx")) continue;
      const buf = await wacz.readEntry(name);
      if (!buf) continue;
      const pair = parseIdxPairFilename(buf.toString("utf-8"));
      if (pair === null) continue; // no header claim; lookups won't work but a separate
      //                              "no claim" diagnostic is more confusing than useful
      //                              this early in the project.
      // `.idx` files reference their CDXJ pair by name only; the zip
      // stores them in the same directory (typically `indexes/`).
      // Look it up both directly and under `indexes/`.
      const candidates = [pair, `${INDEXES_PREFIX}${pair}`];
      const found = candidates.some((p) => wacz.hasEntry(p));
      if (!found) {
        issues.push({
          rule: "cdxj/index-recognised-by-wabac",
          severity: "warning",
          message: `${name} references "${pair}" but no such entry exists in the WACZ`,
          location: { entry: name },
          details: { idxFile: name, claimedPair: pair, candidatesChecked: candidates },
        });
      }
    }

    return ok(issues);
  },
};
