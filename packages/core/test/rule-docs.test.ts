/**
 * RULE_DOCS の健全性チェック。
 *
 * - 全 DEFAULT_RULES が出典リンクを 1 つ以上持つ(漏れ検出)
 * - 全 URL が https(リンクとして妥当)
 * - 複数 spec を跨ぐ rule(frictionless-structure)は 2 リンクを持つ(案3 の趣旨の pin)
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RULES } from "../src/validate/rules/index.js";
import { RULE_DOCS, docsForRule } from "../src/validate/rule-docs.js";

describe("rule-docs", () => {
  it("全 DEFAULT_RULES が RULE_DOCS に登録済み", () => {
    for (const rule of DEFAULT_RULES) {
      expect(docsForRule(rule.name)?.length ?? 0, rule.name).toBeGreaterThan(0);
    }
  });

  it("全 URL は https", () => {
    for (const links of Object.values(RULE_DOCS)) {
      for (const d of links) expect(d.url).toMatch(/^https:\/\//);
    }
  });

  it("frictionless-structure は 2 spec を持つ", () => {
    expect(docsForRule("datapackage/frictionless-structure")).toHaveLength(2);
  });
});
