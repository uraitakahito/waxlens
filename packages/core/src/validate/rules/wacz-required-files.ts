/**
 * Rule: wacz/required-files
 *
 * WACZ 1.1.1 §5.2 (Directories and Files) が MUST とするファイル/
 * ディレクトリの **存在** を直接 assert する。datapackage.json の
 * `resources[]` 宣言には依存しない — 宣言が無い / 壊れている WACZ でも
 * 構造的な欠落を検出できる。これにより「不在かつ未宣言」の MUST 欠落
 * (従来は resource-hashes でも拾えなかったギャップ)を埋める。
 *
 * チェック対象 (いずれも MUST):
 *   - §5.2.4  datapackage.json        (root に存在)
 *   - §5.2.3  pages/pages.jsonl        (存在)
 *   - §5.2.1  archive/ に WARC を 1 つ以上 (*.warc / *.warc.gz)
 *   - §5.2.2  indexes/ に index を 1 つ以上 (*.cdx / *.cdxj / *.idx, gzip 可)
 *
 * §5.2.5 datapackage-digest.json は SHOULD なので対象外。
 *
 * datapackage.json の存在チェックはここが担う。`datapackage/profile-required`
 * は datapackage が在るときの profile *値* に専念する (二重報告を避けるため
 * 不在を報告しない)。indexes の「存在」はここ、「wabac が実際にロードできるか」
 * は `cdxj/index-recognised-by-wabac` が見る (観点が異なるため併存)。
 *
 * Spec: https://specs.webrecorder.net/wacz/1.1.1/#directories-and-files
 */
import { ok } from "../../result.js";
import type { Issue, ValidationRule } from "../domain.js";
import { hasIndex, hasWarc } from "../wacz-spec.js";

export const waczRequiredFilesRule: ValidationRule = {
  name: "wacz/required-files",
  description: "WACZ §5.2 が MUST とするファイル/ディレクトリが存在しなければならない",
  // 構造的な MUST 欠落は replay-breaking なので全 profile で error
  // (resource-hashes / index-recognised と同じ扱い)。
  severity: "error",

  // entryNames/hasEntry は同期(central directory 由来)。run は Promise を
  // 返す契約だが await すべき I/O は無いので Promise.resolve で包む。
  run: (wacz) => {
    const issues: Issue[] = [];
    const names = wacz.entryNames();

    const need = (present: boolean, entry: string, message: string): void => {
      if (!present) {
        issues.push({
          rule: "wacz/required-files",
          severity: "error",
          message,
          location: { entry },
        });
      }
    };

    need(
      wacz.hasEntry("datapackage.json"),
      "datapackage.json",
      "datapackage.json is missing (WACZ §5.2.4: MUST exist at the root)",
    );
    need(
      wacz.hasEntry("pages/pages.jsonl"),
      "pages/pages.jsonl",
      "pages/pages.jsonl is missing (WACZ §5.2.3: MUST be present)",
    );
    need(
      hasWarc(names),
      "archive/",
      "archive/ has no WARC file (WACZ §5.2.1: MUST contain at least one .warc/.warc.gz)",
    );
    need(
      hasIndex(names),
      "indexes/",
      "indexes/ has no index file (WACZ §5.2.2: MUST contain at least one .cdx/.cdxj/.idx)",
    );

    return Promise.resolve(ok(issues));
  },
};
