/**
 * Rule: datapackage/profile-required
 *
 * `datapackage.json` MUST set `profile: "data-package"`. Without it,
 * ReplayWeb.page / wabac.js silently classifies the WACZ as invalid and
 * the CDX lookup never runs — producing the cryptic "Archived Page Not
 * Found" error even when everything else is correct.
 *
 * Source: browserhive/src/storage/wacz/datapackage.ts:42-49 (the literal
 * `"data-package"` requirement is highlighted there with the same
 * silent-fail warning).
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
      // `JSON.stringify` rather than `String(...)` — the profile field is
      // typed as `unknown`, so a non-string value would otherwise stringify
      // to "[object Object]" and lose the actual content from the message.
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
