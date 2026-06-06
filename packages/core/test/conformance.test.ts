/**
 * conformance(RFC 2119 規範レベル)の常設ガード。
 *
 * `ValidationRule.conformance` は必須なので型でも担保されるが、ここでは
 *   1. 全 rule が有効なレベル(MUST/SHOULD/MAY 系)を宣言していること
 *   2. `conformanceForRule` が rule 名から解決でき、未知名は undefined
 * を実値で固定する。CORPUS_DIR も実 WACZ も不要で常時走る。
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, conformanceForRule } from "../src/validate/rules/index.js";
import type { Conformance } from "../src/validate/domain.js";

const LEVELS: ReadonlySet<Conformance> = new Set<Conformance>([
  "MUST",
  "MUST NOT",
  "SHOULD",
  "SHOULD NOT",
  "MAY",
]);

describe("conformance", () => {
  it("全 rule が有効な conformance を宣言する", () => {
    for (const rule of DEFAULT_RULES) {
      expect(LEVELS.has(rule.conformance), `${rule.name} の conformance が不正`).toBe(true);
    }
  });

  it("conformanceForRule が rule 名から解決する", () => {
    expect(conformanceForRule("wacz/required-files")).toBe("MUST");
    expect(conformanceForRule("warc/storage-store")).toBe("SHOULD");
    expect(conformanceForRule("fuzzy/valid-json")).toBe("MAY");
  });

  it("未知の rule 名は undefined(badge を出さない)", () => {
    expect(conformanceForRule("does/not-exist")).toBeUndefined();
  });
});
