/**
 * Rule: fuzzy/valid-json
 *
 * `fuzzy.json` は WACZ spec 上 optional。存在する場合は valid な
 * JSON で、top-level が `rules` array を持つ object である必要が
 * ある — replay ツールはこの形に依存して lookup 時に cache-buster
 * の strip rule を適用する。それ以外は silent に無視される。これが
 * ここで "info" severity を採用する理由: replay-breaking なバグでは
 * なく、producer の癖として flag する価値があるという位置づけ。
 *
 * Spec: WACZ 1.1 §fuzzy.json (optional、`{ "rules": [...] }` の形)。
 * Reference producer: browserhive は無条件で空の `{ "rules": [] }`
 *       を emit する。pywb / wacz-creator は fuzzy match rule が
 *       設定されているときに emit する。
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
      // 不在は許容される — WACZ spec で fuzzy.json は optional。
      // browserhive のような producer は常に空 stub を入れるが、
      // 入れない producer もあるので、毎回 info レベルの "missing"
      // を出すのはノイズが多いため silent に skip する。
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
