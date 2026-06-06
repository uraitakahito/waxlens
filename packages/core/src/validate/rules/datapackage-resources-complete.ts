/**
 * Rule: datapackage/resources-complete
 *
 * WACZ「Other files and directories」: 追加ファイルは Frictionless 準拠の
 * ため `datapackage.json` の resources セクションに列挙されなければならない
 * (MUST)。`datapackage/resource-hashes` が「宣言 → 実体」(宣言したリソースが
 * 実在し hash 一致)を見るのに対し、この rule は逆方向「実体 → 宣言」
 * (zip 内の実ファイルがすべて宣言されているか)を見る。未宣言の孤児を warning。
 *
 * マニフェスト自身(`datapackage.json` / `datapackage-digest.json`)は
 * resources に自己列挙しないため対象外。zip のディレクトリエントリも除外。
 *
 * Spec: https://specs.webrecorder.net/wacz/1.1.1/#directories-and-files
 */
import { ok } from "../../result.js";
import { parseDatapackage } from "../../wacz/datapackage.js";
import type { Issue, ValidationRule } from "../domain.js";

const DATAPACKAGE_ENTRY = "datapackage.json";
/** resources に列挙されないマニフェスト系ファイル。 */
const MANIFEST_FILES: ReadonlySet<string> = new Set([
  "datapackage.json",
  "datapackage-digest.json",
]);

export const datapackageResourcesCompleteRule: ValidationRule = {
  name: "datapackage/resources-complete",
  descriptionKey: "datapackage/resources-complete.desc",
  severity: "warning",
  conformance: "MUST",
  applicability: {
    severityByProfile: {
      lenient: "info",
    },
  },

  run: async (wacz) => {
    const issues: Issue[] = [];
    const buf = await wacz.readEntry(DATAPACKAGE_ENTRY);
    if (!buf) return ok(issues); // 不在は required-files / profile が報告する。
    const pkg = parseDatapackage(buf.toString("utf-8"));
    if (!pkg || !Array.isArray(pkg.resources)) return ok(issues); // resource-hashes が報告する。

    const declared = new Set<string>();
    for (const res of pkg.resources) {
      if (typeof res.path === "string") declared.add(res.path);
    }

    for (const name of wacz.entryNames()) {
      if (name.endsWith("/")) continue; // ディレクトリエントリ
      if (MANIFEST_FILES.has(name)) continue; // マニフェスト自身
      if (!declared.has(name)) {
        issues.push({
          rule: "datapackage/resources-complete",
          severity: "warning",
          messageKey: "datapackage/resources-complete.orphan",
          params: { entry: name },
          location: { entry: name },
        });
      }
    }

    return ok(issues);
  },
};
