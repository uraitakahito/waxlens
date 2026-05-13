/**
 * Rule: datapackage/profile-required
 *
 * `datapackage.json` は `profile: "data-package"` を必ず指定する必要
 * がある。この field は WACZ が埋め込む Frictionless Data Package
 * descriptor で定義されていて、これが無いと wabac.js / ReplayWeb.page
 * は WACZ を silent に invalid と判定し CDX lookup が走らない —
 * 他がすべて正しくても "Archived Page Not Found" という分かりにくい
 * エラーになる。
 *
 * Spec: WACZ 1.1 §datapackage.json (`profile` literal は Frictionless
 *       Data marker として必須と定められている)。
 * Reference producer: browserhive/src/storage/wacz/datapackage.ts:42-49
 *       に silent-fail trap がコメントで直接書かれている。
 */
import { ok } from "../../result.js";
import { parseDatapackage } from "../../wacz/datapackage.js";
import type { Issue, ValidationRule } from "../types.js";

const DATAPACKAGE_ENTRY = "datapackage.json";
const EXPECTED_PROFILE = "data-package";

export const datapackageProfileRule: ValidationRule = {
  name: "datapackage/profile-required",
  description: `${DATAPACKAGE_ENTRY} must set profile === "${EXPECTED_PROFILE}"`,
  severity: "error",

  run: async (wacz) => {
    const issues: Issue[] = [];
    const buf = await wacz.readEntry(DATAPACKAGE_ENTRY);
    if (!buf) {
      issues.push({
        rule: "datapackage/profile-required",
        severity: "error",
        message: `${DATAPACKAGE_ENTRY} is missing from the WACZ`,
        location: { entry: DATAPACKAGE_ENTRY },
      });
      return ok(issues);
    }

    const pkg = parseDatapackage(buf.toString("utf-8"));
    if (!pkg) {
      issues.push({
        rule: "datapackage/profile-required",
        severity: "error",
        message: `${DATAPACKAGE_ENTRY} is not valid JSON or not an object`,
        location: { entry: DATAPACKAGE_ENTRY },
      });
      return ok(issues);
    }

    if (pkg.profile === undefined) {
      issues.push({
        rule: "datapackage/profile-required",
        severity: "error",
        message: `${DATAPACKAGE_ENTRY} is missing the "profile" field`,
        location: { entry: DATAPACKAGE_ENTRY },
        details: { expected: EXPECTED_PROFILE },
      });
      return ok(issues);
    }

    if (pkg.profile !== EXPECTED_PROFILE) {
      // `String(...)` ではなく `JSON.stringify` を使う。profile field
      // の型が `unknown` のため、非文字列の値は `String(...)` だと
      // "[object Object]" になってメッセージから実際の中身が
      // 失われてしまう。
      issues.push({
        rule: "datapackage/profile-required",
        severity: "error",
        message: `${DATAPACKAGE_ENTRY} profile is ${JSON.stringify(pkg.profile)}, expected "${EXPECTED_PROFILE}"`,
        location: { entry: DATAPACKAGE_ENTRY },
        details: { expected: EXPECTED_PROFILE, actual: pkg.profile },
      });
    }

    return ok(issues);
  },
};
