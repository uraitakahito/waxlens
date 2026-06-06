/**
 * Rule: wacz/reserved-dirs-clean
 *
 * WACZ「Other files and directories」: カスタムのファイル/ディレクトリを
 * 既存の予約ディレクトリ `archive` / `indexes` / `pages` に追加しては
 * ならない(MUST NOT)。任意の追加ファイルは root 等に置き、resources に
 * 列挙する。
 *
 * 各予約ディレクトリで許可される中身:
 *   - `archive/`  WARC(`*.warc` / `*.warc.gz`)= {@link WARC_RE}
 *   - `indexes/`  index(`*.cdx`/`*.cdxj`/`*.idx`, gzip 可)= {@link INDEX_RE}
 *   - `pages/`    `*.jsonl`(spec は pages/ に他の JSONL を許す)
 * これら以外の異物を warning で報告する(lenient では info)。
 *
 * Spec: https://specs.webrecorder.net/wacz/1.1.1/#directories-and-files
 */
import { ok } from "../../result.js";
import { INDEX_RE, WARC_RE } from "../wacz-spec.js";
import type { Issue, ValidationRule } from "../domain.js";

const PAGES_JSONL_RE = /^pages\/.+\.jsonl$/;

const RESERVED: readonly { dir: string; allow: RegExp }[] = [
  { dir: "archive/", allow: WARC_RE },
  { dir: "indexes/", allow: INDEX_RE },
  { dir: "pages/", allow: PAGES_JSONL_RE },
];

export const waczReservedDirsCleanRule: ValidationRule = {
  name: "wacz/reserved-dirs-clean",
  descriptionKey: "wacz/reserved-dirs-clean.desc",
  severity: "warning",
  conformance: "MUST NOT",
  applicability: {
    severityByProfile: {
      lenient: "info",
    },
  },

  // entryNames() は同期で済むため async は付けない(require-await 回避)。
  run: (wacz) => {
    const issues: Issue[] = [];

    for (const name of wacz.entryNames()) {
      // zip のディレクトリエントリ(末尾 /)は対象外。
      if (name.endsWith("/")) continue;
      for (const { dir, allow } of RESERVED) {
        if (name.startsWith(dir) && !allow.test(name)) {
          issues.push({
            rule: "wacz/reserved-dirs-clean",
            severity: "warning",
            messageKey: "wacz/reserved-dirs-clean.unexpected",
            params: { entry: name, dir },
            location: { entry: name },
          });
        }
      }
    }

    return Promise.resolve(ok(issues));
  },
};
