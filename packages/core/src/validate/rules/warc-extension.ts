/**
 * Rule: warc/extension-gzip-match
 *
 * archive/ の各 WARC は、中身の gzip 状態と拡張子が一致していなければ
 * ならない。WACZ §5.2.1:
 *   - GZIP encode された WARC は `.warc.gz` 拡張子を使う(MUST)
 *   - そうでない WARC は `.warc` 拡張子を使うべき(SHOULD)
 *
 * 中身が gzip かどうかは先頭 2 byte の magic(`1f 8b`)で判定する
 * (`cdxj/index-not-gzipped` の WARC 版)。拡張子と中身がズレていると、
 * 拡張子で圧縮状態を判断するツールが誤動作しうる。
 *
 * Spec: https://specs.webrecorder.net/wacz/1.1.1/#archive
 *
 * severity は warning(replay そのものは CDXJ の filename 経由で解決され
 * 壊れない命名規約)。conformance は混在(gz→MUST / 非gz→SHOULD)だが
 * 代表値として MUST を採る。
 */
import { ok } from "../../result.js";
import { WARC_RE } from "../wacz-spec.js";
import type { Issue, ValidationRule } from "../domain.js";

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

export const warcExtensionRule: ValidationRule = {
  name: "warc/extension-gzip-match",
  descriptionKey: "warc/extension-gzip-match.desc",
  severity: "warning",
  conformance: "MUST",
  applicability: {
    severityByProfile: {
      lenient: "info",
    },
  },

  run: async (wacz) => {
    const issues: Issue[] = [];

    for (const name of wacz.entryNames()) {
      if (!WARC_RE.test(name)) continue;
      const buf = await wacz.readEntry(name);
      if (!buf || buf.length < 2) continue;
      const isGzip = buf[0] === GZIP_MAGIC_0 && buf[1] === GZIP_MAGIC_1;
      const hasGzExt = name.endsWith(".warc.gz");

      if (isGzip && !hasGzExt) {
        issues.push({
          rule: "warc/extension-gzip-match",
          severity: "warning",
          messageKey: "warc/extension-gzip-match.gz-needs-gz-ext",
          params: { section: "5.2.1", entry: name },
          location: { entry: name },
        });
      } else if (!isGzip && hasGzExt) {
        issues.push({
          rule: "warc/extension-gzip-match",
          severity: "warning",
          messageKey: "warc/extension-gzip-match.plain-has-gz-ext",
          params: { section: "5.2.1", entry: name },
          location: { entry: name },
        });
      }
    }

    return ok(issues);
  },
};
