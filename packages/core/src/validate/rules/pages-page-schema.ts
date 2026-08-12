/**
 * Rule: pages/page-schema
 *
 * WACZ §5.2.3: pages/pages.jsonl は [[JSON-Lines]] で、各 'Page' 行は
 * 少なくとも `url`(Page の URL)と `ts`(タイムスタンプ)を持た
 * なければならない(MUST)。
 *
 * pages.jsonl の 1 行目は `{ "format": "json-pages-1.0", ... }` の
 * ヘッダ行なので、Page 行(2 行目以降)だけを検査する。各行が
 *   - valid JSON のオブジェクトであること
 *   - `url` と `ts` を持つこと
 * を確認し、違反を行番号つきで報告する。
 *
 * severity は warning: Page 一覧(ReplayWeb.page の Page 選択)は
 * 壊れるが、URL 単位の replay は CDXJ 経由で動くため。lenient では info。
 *
 * Spec: https://specs.webrecorder.net/wacz/1.1.1/#pages
 */
import { ok } from "../../result.js";
import type { Issue, ValidationRule } from "../domain.js";

const PAGES_ENTRY = "pages/pages.jsonl";

export const pagesPageSchemaRule: ValidationRule = {
  name: "pages/page-schema",
  descriptionKey: "pages/page-schema.desc",
  conformance: "MUST",
  applicability: {
    severityByProfile: {
      lenient: {
        "pages/page-schema.not-json": "info",
        "pages/page-schema.missing-prop": "info",
      },
    },
  },

  run: async (wacz) => {
    const issues: Issue[] = [];
    const buf = await wacz.readEntry(PAGES_ENTRY);
    if (!buf) return ok(issues); // 不在は wacz/required-files が報告する。

    const lines = buf.toString("utf-8").split("\n");
    for (const [index, line] of lines.entries()) {
      if (line.trim().length === 0) continue;
      // 1 行目はヘッダ(`{ "format": "json-pages-1.0", ... }`)なので page 検査を飛ばす。
      if (index === 0) continue;

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        issues.push({
          rule: "pages/page-schema",
          severity: "warning",
          messageKey: "pages/page-schema.not-json",
          params: { section: "5.2.3", line: index + 1 },
          location: { entry: PAGES_ENTRY, line: index + 1 },
        });
        continue;
      }

      const page = parsed as Record<string, unknown>;
      const missing: string[] = [];
      if (typeof page["url"] !== "string" || page["url"].length === 0) missing.push("url");
      if (typeof page["ts"] !== "string" || page["ts"].length === 0) missing.push("ts");
      if (missing.length > 0) {
        issues.push({
          rule: "pages/page-schema",
          severity: "warning",
          messageKey: "pages/page-schema.missing-prop",
          params: { section: "5.2.3", line: index + 1, props: missing.join(", ") },
          location: { entry: PAGES_ENTRY, line: index + 1 },
        });
      }
    }

    return ok(issues);
  },
};
