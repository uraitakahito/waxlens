/**
 * Rule: cdxj/index-not-gzipped
 *
 * `indexes/index.cdxj` MUST be a plain (uncompressed) text file inside the
 * WACZ zip. wabac.js's `loadIndex` only recognises entries whose names end
 * with `.cdx`, `.cdxj`, or `.idx` — files named `.cdx.gz` / `.cdxj.gz` are
 * silently skipped, which makes every URL lookup return "Archived Page
 * Not Found" even when the WACZ otherwise looks fine.
 *
 * Source: browserhive/src/storage/wacz/packager.ts:46-56 (the producer
 * comment cites the wabac.js multiwacz.ts `endsWith` branch).
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
