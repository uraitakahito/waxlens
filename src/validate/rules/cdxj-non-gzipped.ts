/**
 * Rule: cdxj/index-not-gzipped
 *
 * Producer-strict variant of the wabac-recognition contract: when the
 * producer is expected to emit a plain `indexes/index.cdxj`, this rule
 * surfaces any `.cdxj.gz` / `.cdx.gz` variant (or a `.cdxj` file whose
 * content begins with the gzip magic) as an error.
 *
 * The generic "wabac.js can't load this index" check lives in
 * `cdxj/index-recognised-by-wabac` (Phase D); this rule remains because
 * a producer that emits gzipped CDXJ without a paired `.idx` is broken
 * in the same way regardless — and a producer documented to emit the
 * plain form is doubly broken if it emits the gzipped form instead.
 *
 * Replay engine: wabac.js `multiwacz.ts:loadIndex` accepts `.cdx` /
 *       `.cdxj` directly and `.idx` (with paired `.cdx.gz` via the
 *       `!meta { format: "cdxj-gzip-1.0", filename }` header).
 *       `.cdx.gz` / `.cdxj.gz` ALONE is never accepted.
 * Reference producer: browserhive/src/storage/wacz/packager.ts:46-56
 *       commits to plain `indexes/index.cdxj` and documents the
 *       silent-skip trap that motivates this rule.
 *
 * Detection strategy:
 *   1. If `indexes/index.cdxj.gz` (or any `.cdxj.gz` / `.cdx.gz` variant)
 *      is present, that's the bug — report with the offending entry name.
 *   2. If `indexes/index.cdxj` is present but starts with the gzip magic
 *      bytes (`1f 8b`), the file was double-handled (named correctly but
 *      gzipped content). Also a producer bug.
 */
import { ok } from "../../result.js";
import type { Issue, ValidationRule } from "../types.js";

const EXPECTED_CDXJ = "indexes/index.cdxj";

const FORBIDDEN_GZ_SUFFIXES = [".cdxj.gz", ".cdx.gz"] as const;
const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

export const cdxjNonGzippedRule: ValidationRule = {
  name: "cdxj/index-not-gzipped",
  description: `${EXPECTED_CDXJ} must not be gzipped (wabac.js silently ignores .cdxj.gz)`,
  severity: "error",

  run: async (wacz) => {
    const issues: Issue[] = [];

    for (const name of wacz.entryNames()) {
      if (FORBIDDEN_GZ_SUFFIXES.some((suffix) => name.endsWith(suffix))) {
        issues.push({
          rule: "cdxj/index-not-gzipped",
          severity: "error",
          message: `Entry "${name}" is a gzipped CDXJ — wabac.js does not recognise .cdxj.gz / .cdx.gz`,
          location: { entry: name },
        });
      }
    }

    const cdxjBuf = await wacz.readEntry(EXPECTED_CDXJ);
    if (cdxjBuf && cdxjBuf.length >= 2) {
      if (cdxjBuf[0] === GZIP_MAGIC_0 && cdxjBuf[1] === GZIP_MAGIC_1) {
        issues.push({
          rule: "cdxj/index-not-gzipped",
          severity: "error",
          message: `${EXPECTED_CDXJ} starts with the gzip magic bytes — the file is named correctly but the content is compressed`,
          location: { entry: EXPECTED_CDXJ },
        });
      }
    }

    return ok(issues);
  },
};
