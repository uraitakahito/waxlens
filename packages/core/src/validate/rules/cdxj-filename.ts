/**
 * Rule: cdxj/filename-archive-relative
 *
 * 各 CDXJ entry は `filename` field を持ち、これは (offset, length)
 * ペアが seek 先とする WARC ファイル名を指す。値は WACZ の `archive/`
 * ディレクトリからの **相対** な WARC ファイル名でなければならない
 * — 例えば `data.warc.gz`、`archive/data.warc.gz` ではない。wabac.js
 * はファイル解決時に `archive/` を自分で先頭に付けるため、フルパスを
 * 書くと `archive/archive/data.warc.gz` を探しに行って全 URL が 404
 * になる。
 *
 * Spec / 慣習: WACZ spec は相対パスを明示的には pin していないが、
 *       pywb / wacz-creator / browserhive のいずれも実際にはこの
 *       形で出力していて、wabac.js は `archive/` prefix を自前で
 *       入れている。
 * Replay engine: wabac.js の WACZ file resolver (`wacz/multiwacz.ts`
 *       の loadFileFromNamedWACZ 参照) は、zip から fetch する前に
 *       CDXJ の filename に `archive/` を付ける。
 * Reference producer: browserhive/src/storage/wacz/packager.ts:36-44
 *       で定数名が `WARC_FILENAME_FOR_CDX` で、コメントに同じ落とし
 *       穴が説明されている。
 *
 * 何を報告するか:
 *   - `filename` が `archive/` で始まる CDXJ entry → error
 *   - `filename` が無い CDXJ entry → error (replay が seek できない)
 *   - CDXJ parse error → error (line 番号付き)
 */
import { ok } from "../../result.js";
import { parseCdxj } from "../../wacz/cdxj-parser.js";
import type { Issue, ValidationRule } from "../types.js";

const CDXJ_ENTRY = "indexes/index.cdxj";

export const cdxjFilenameRule: ValidationRule = {
  name: "cdxj/filename-archive-relative",
  description: `${CDXJ_ENTRY} entries must use archive-relative filenames (not "archive/...")`,
  severity: "error",
  applicability: {
    severityByProfile: { lenient: "warning" },
  },

  run: async (wacz) => {
    const issues: Issue[] = [];
    const buf = await wacz.readEntry(CDXJ_ENTRY);
    if (!buf) {
      // WACZ が wabac.js 認識可能な index を 1 つでも持つかは
      // `cdxj/index-recognised-by-wabac` の責務。ここでは silent に
      // する。同じ "index 欠落" 状況に対して 2 つ別々の不満が出ない
      // ようにするため。新 rule が全 profile で正式な error を出す。
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
