/**
 * Rule: cdxj/pages-mainpage
 *
 * `datapackage.json#mainPageURL` は replay の正式なエントリポイント。
 * これが ReplayWeb.page で実際に動くためには 2 つが満たされる必要がある:
 *
 *   1. `pages/pages.jsonl` に `url` が一致する entry がある
 *   2. `indexes/index.cdxj` に少なくとも 1 件、その URL を cover する
 *      レコードがある (無いと replay engine は何も出せない)
 *
 * どちらかの gap でも、WACZ の "構造" を壊さずに replay landing page を
 * silent に壊す — 他の構造 check だけでは全 pass してしまうため、
 * waxlens が個別に捕まえるべき latent な corruption。
 *
 * Severity は `warning`: その WACZ は他 URL に対する部分的な replay
 * (index に登録されている URL への deep-link) には使える可能性が
 * あるので、mainPage 参照の欠落だけで validation を fail させないように
 * している。
 */
import { ok } from "../../result.js";
import { parseCdxj } from "../../wacz/cdxj-parser.js";
import { parseDatapackage } from "../../wacz/datapackage.js";
import { parsePagesJsonl } from "../../wacz/pages.js";
import type { Issue, ValidationRule } from "../types.js";

const DATAPACKAGE_ENTRY = "datapackage.json";
const PAGES_ENTRY = "pages/pages.jsonl";
const CDXJ_ENTRY = "indexes/index.cdxj";

export const cdxjPagesMainpageRule: ValidationRule = {
  name: "cdxj/pages-mainpage",
  description: `datapackage.mainPageURL must appear in both ${PAGES_ENTRY} and ${CDXJ_ENTRY}`,
  severity: "warning",
  applicability: {
    severityByProfile: { lenient: "info" },
  },

  run: async (wacz) => {
    const issues: Issue[] = [];

    const dpBuf = await wacz.readEntry(DATAPACKAGE_ENTRY);
    if (!dpBuf) return ok(issues); // profile rule が不在を報告する。
    const pkg = parseDatapackage(dpBuf.toString("utf-8"));
    if (!pkg) return ok(issues);

    const mainPageURL = pkg.mainPageURL;
    if (typeof mainPageURL !== "string" || mainPageURL.length === 0) {
      // mainPageURL の不在自体は別の producer バグだが、WACZ spec は
      // 厳密には必須としていない (Webrecorder の spec は "optional but
      // recommended" と書いている)。ここでは coverage gap だけを表面化
      // して、不在そのものは追わない。
      return ok(issues);
    }

    // Pages 側 ----------------------------------------------------------
    const pagesBuf = await wacz.readEntry(PAGES_ENTRY);
    if (pagesBuf) {
      const pages = parsePagesJsonl(pagesBuf.toString("utf-8"));
      const found = pages.entries.some((entry) => entry.url === mainPageURL);
      if (!found) {
        issues.push({
          rule: "cdxj/pages-mainpage",
          severity: "warning",
          message: `${DATAPACKAGE_ENTRY} mainPageURL "${mainPageURL}" is not listed in ${PAGES_ENTRY}`,
          location: { entry: PAGES_ENTRY },
          details: {
            mainPageURL,
            pagesUrls: pages.entries.map((e) => e.url),
          },
        });
      }
    }
    // (`pages.jsonl` 不在 → resource-hashes / file-presence 系の rule
    // が表面化する。重複ノイズを避けるためここは silent にしておく。)

    // CDXJ 側 -----------------------------------------------------------
    const cdxjBuf = await wacz.readEntry(CDXJ_ENTRY);
    if (cdxjBuf) {
      const { entries } = parseCdxj(cdxjBuf.toString("utf-8"));
      const found = entries.some((e) => e.fields["url"] === mainPageURL);
      if (!found) {
        issues.push({
          rule: "cdxj/pages-mainpage",
          severity: "warning",
          message: `${DATAPACKAGE_ENTRY} mainPageURL "${mainPageURL}" has no record in ${CDXJ_ENTRY}`,
          location: { entry: CDXJ_ENTRY },
          details: {
            mainPageURL,
            cdxjUrlSample: entries.slice(0, 10).map((e) => e.fields["url"]),
          },
        });
      }
    }

    return ok(issues);
  },
};
