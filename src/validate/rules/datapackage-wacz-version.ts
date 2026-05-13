/**
 * Rule: datapackage/wacz-version-required
 *
 * `datapackage.json` MUST carry a non-empty `wacz_version` string. The
 * value is also constrained — we accept the published WACZ spec revs
 * (1.0.0 / 1.1.0 / 1.1.1). Anything else triggers a `warning` (still a
 * recognised field, but unverified replay behaviour); a missing field
 * is an `error`.
 *
 * Spec: WACZ 1.1 §datapackage.json (`wacz_version` is the spec-rev tag
 *       producers use to declare which feature set they emit).
 * Reference producer: browserhive emits "1.1.1".
 */
import { ok } from "../../result.js";
import { parseDatapackage } from "../../wacz/datapackage.js";
import type { Issue, ValidationRule } from "../types.js";

const DATAPACKAGE_ENTRY = "datapackage.json";

/**
 * Known-good WACZ versions. Extend the list when browserhive or another
 * supported producer ships a new spec rev. The trailing `as const` lets
 * the array type narrow to the literal union.
 */
const KNOWN_VERSIONS = ["1.0.0", "1.1.0", "1.1.1"] as const;

export const datapackageWaczVersionRule: ValidationRule = {
  name: "datapackage/wacz-version-required",
  description: `${DATAPACKAGE_ENTRY} must declare a non-empty wacz_version`,
  severity: "error",

  run: async (wacz) => {
    const issues: Issue[] = [];
    const buf = await wacz.readEntry(DATAPACKAGE_ENTRY);
    if (!buf) {
      // The profile rule already reports a missing datapackage.json as an
      // error; we silently skip here so the same condition does not raise
      // two near-duplicate issues.
      return ok(issues);
    }

    const pkg = parseDatapackage(buf.toString("utf-8"));
    if (!pkg) return ok(issues); // Same de-duplication argument as above.

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
