/**
 * Rule: cdxj/filename-archive-relative
 *
 * Every CDXJ entry carries a `filename` field that names the WARC file
 * the (offset, length) pair seeks into. The value MUST be the WARC
 * filename relative to the WACZ's `archive/` directory — e.g.
 * `data.warc.gz`, not `archive/data.warc.gz`. wabac.js prepends
 * `archive/` itself when resolving the file, so writing the full path
 * makes it look up `archive/archive/data.warc.gz` and 404 every URL.
 *
 * Spec / convention: The WACZ spec doesn't pin the relative path
 *       explicitly, but pywb / wacz-creator / browserhive all emit it
 *       this way, and wabac.js bakes in the `archive/` prefix.
 * Replay engine: wabac.js's WACZ file resolver (see `wacz/multiwacz.ts`
 *       loadFileFromNamedWACZ) prepends `archive/` to the CDXJ
 *       filename before fetching from the zip.
 * Reference producer: browserhive/src/storage/wacz/packager.ts:36-44
 *       names the constant `WARC_FILENAME_FOR_CDX` and documents the
 *       exact gotcha.
 *
 * What we report:
 *   - any CDXJ entry whose `filename` starts with `archive/` → error
 *   - any CDXJ entry missing `filename` → error (replay can't seek)
 *   - any CDXJ parse error → error (line-located)
 */
import { ok } from "../../result.js";
import { parseCdxj } from "../../wacz/cdxj-parser.js";
import type { Issue, ValidationRule } from "../types.js";

const CDXJ_ENTRY = "indexes/index.cdxj";

export const cdxjFilenameRule: ValidationRule = {
  name: "cdxj/filename-archive-relative",
  description: `${CDXJ_ENTRY} entries must use archive-relative filenames (not "archive/...")`,
  severity: "error",

  run: async (wacz) => {
    const issues: Issue[] = [];
    const buf = await wacz.readEntry(CDXJ_ENTRY);
    if (!buf) {
      issues.push({
        rule: "cdxj/filename-archive-relative",
        severity: "error",
        message: `${CDXJ_ENTRY} is missing from the WACZ`,
        location: { entry: CDXJ_ENTRY },
      });
      return ok(issues);
    }

    const { entries, errors } = parseCdxj(buf.toString("utf-8"));

    for (const parseErr of errors) {
      issues.push({
        rule: "cdxj/filename-archive-relative",
        severity: "error",
        message: `${CDXJ_ENTRY} line ${String(parseErr.line)} could not be parsed (${parseErr.reason})`,
        location: { entry: CDXJ_ENTRY, line: parseErr.line },
        details: { rawLine: parseErr.rawLine },
      });
    }

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) continue;
      const filename = entry.fields["filename"];
      const lineNum = i + 1 + errors.filter((e) => e.line <= i + 1).length;

      if (typeof filename !== "string" || filename.length === 0) {
        issues.push({
          rule: "cdxj/filename-archive-relative",
          severity: "error",
          message: `${CDXJ_ENTRY} entry has no "filename" field`,
          location: { entry: CDXJ_ENTRY, line: lineNum },
          details: { surt: entry.surt, timestamp: entry.timestamp },
        });
        continue;
      }

      if (filename.startsWith("archive/")) {
        issues.push({
          rule: "cdxj/filename-archive-relative",
          severity: "error",
          message: `${CDXJ_ENTRY} entry "filename" starts with "archive/" — wabac.js prepends archive/ itself, double-prefix breaks replay`,
          location: { entry: CDXJ_ENTRY, line: lineNum },
          details: {
            surt: entry.surt,
            actual: filename,
            expected: filename.slice("archive/".length),
          },
        });
      }
    }

    return ok(issues);
  },
};
