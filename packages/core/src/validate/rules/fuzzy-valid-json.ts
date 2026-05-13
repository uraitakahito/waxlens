/**
 * Rule: fuzzy/valid-json
 *
 * `fuzzy.json` is optional per the WACZ spec. When present it MUST be
 * valid JSON whose top level is an object with a `rules` array —
 * replay tools rely on this shape to apply cache-buster strip rules at
 * lookup time. Anything else is silently ignored, which is the "info"
 * severity case here: not a replay-breaking bug, just a producer quirk
 * worth flagging.
 *
 * Spec: WACZ 1.1 §fuzzy.json (optional, `{ "rules": [...] }` shape).
 * Reference producer: browserhive emits an empty `{ "rules": [] }`
 *       unconditionally; pywb / wacz-creator emit when fuzzy match
 *       rules are configured.
 */
import { ok } from "../../result.js";
import type { Issue, ValidationRule } from "../types.js";

const FUZZY_ENTRY = "fuzzy.json";

export const fuzzyValidJsonRule: ValidationRule = {
  name: "fuzzy/valid-json",
  description: `${FUZZY_ENTRY} (when present) must parse as { rules: [...] }`,
  severity: "info",

  run: async (wacz) => {
    const issues: Issue[] = [];
    const buf = await wacz.readEntry(FUZZY_ENTRY);
    if (!buf) {
      // Absence is allowed — the WACZ spec lists fuzzy.json as optional.
      // Producers like browserhive always include an empty stub, but
      // others might not, so we silently skip rather than fire a noisy
      // info-level "missing" issue every time.
      return ok(issues);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(buf.toString("utf-8"));
    } catch (error) {
      issues.push({
        rule: "fuzzy/valid-json",
        severity: "info",
        message: `${FUZZY_ENTRY} is not valid JSON`,
        location: { entry: FUZZY_ENTRY },
        details: { reason: error instanceof Error ? error.message : String(error) },
      });
      return ok(issues);
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      issues.push({
        rule: "fuzzy/valid-json",
        severity: "info",
        message: `${FUZZY_ENTRY} top level must be an object`,
        location: { entry: FUZZY_ENTRY },
        details: { actualType: Array.isArray(parsed) ? "array" : typeof parsed },
      });
      return ok(issues);
    }

    const rules = (parsed as Record<string, unknown>)["rules"];
    if (!Array.isArray(rules)) {
      issues.push({
        rule: "fuzzy/valid-json",
        severity: "info",
        message: `${FUZZY_ENTRY} is missing the "rules" array`,
        location: { entry: FUZZY_ENTRY },
        details: { actualType: typeof rules },
      });
    }

    return ok(issues);
  },
};
