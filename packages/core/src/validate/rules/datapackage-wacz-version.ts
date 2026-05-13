/**
 * Rule: datapackage/wacz-version-required
 *
 * `datapackage.json` は空でない `wacz_version` 文字列を必ず持つ必要が
 * ある。値も制約しており、公表されている WACZ spec rev (1.0.0 /
 * 1.1.0 / 1.1.1) を受け入れる。それ以外は `warning` を発火する
 * (field は認識されているが replay 挙動は未検証); 欠落の場合は
 * `error`。
 *
 * Spec: WACZ 1.1 §datapackage.json (`wacz_version` は producer が
 *       どの feature set を emit したかを宣言する spec-rev タグ)。
 * Reference producer: browserhive は "1.1.1" を出力する。
 */
import { ok } from "../../result.js";
import { parseDatapackage } from "../../wacz/datapackage.js";
import type { Issue, ValidationRule } from "../types.js";

const DATAPACKAGE_ENTRY = "datapackage.json";

/**
 * Known-good な WACZ バージョン。browserhive や他のサポート対象
 * producer が新しい spec rev を出したら拡張する。末尾の `as const`
 * によって、配列の型が literal union に narrow される。
 */
const KNOWN_VERSIONS = ["1.0.0", "1.1.0", "1.1.1"] as const;

export const datapackageWaczVersionRule: ValidationRule = {
  name: "datapackage/wacz-version-required",
  description: `${DATAPACKAGE_ENTRY} must declare a non-empty wacz_version`,
  severity: "error",
  applicability: {
    severityByProfile: { lenient: "warning" },
  },

  run: async (wacz) => {
    const issues: Issue[] = [];
    const buf = await wacz.readEntry(DATAPACKAGE_ENTRY);
    if (!buf) {
      // datapackage.json 欠落は profile rule が既に error として
      // 報告している。同じ状況に対して 2 つの near-duplicate issue を
      // 出さないよう、ここでは silent に skip する。
      return ok(issues);
    }

    const pkg = parseDatapackage(buf.toString("utf-8"));
    if (!pkg) return ok(issues); // 上と同じ重複防止の理由。

    const version = pkg.wacz_version;

    if (version === undefined) {
      issues.push({
        rule: "datapackage/wacz-version-required",
        severity: "error",
        message: `${DATAPACKAGE_ENTRY} is missing the "wacz_version" field`,
        location: { entry: DATAPACKAGE_ENTRY },
        details: { knownVersions: KNOWN_VERSIONS },
      });
      return ok(issues);
    }

    if (typeof version !== "string" || version.length === 0) {
      issues.push({
        rule: "datapackage/wacz-version-required",
        severity: "error",
        message: `${DATAPACKAGE_ENTRY} "wacz_version" must be a non-empty string`,
        location: { entry: DATAPACKAGE_ENTRY },
        details: { actual: version, knownVersions: KNOWN_VERSIONS },
      });
      return ok(issues);
    }

    if (!(KNOWN_VERSIONS as readonly string[]).includes(version)) {
      issues.push({
        rule: "datapackage/wacz-version-required",
        severity: "warning",
        message: `${DATAPACKAGE_ENTRY} "wacz_version" = "${version}" is outside the known-good set`,
        location: { entry: DATAPACKAGE_ENTRY },
        details: { actual: version, knownVersions: KNOWN_VERSIONS },
      });
    }

    return ok(issues);
  },
};
