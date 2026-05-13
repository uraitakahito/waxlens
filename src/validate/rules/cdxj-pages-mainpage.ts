/**
 * Rule: cdxj/pages-mainpage
 *
 * `datapackage.json#mainPageURL` is the canonical entrypoint for replay.
 * For it to actually work in ReplayWeb.page, two things must be true:
 *
 *   1. `pages/pages.jsonl` must contain an entry whose `url` matches it.
 *   2. `indexes/index.cdxj` must contain at least one record covering
 *      that URL (otherwise the replay engine has nothing to serve).
 *
 * Either gap silently breaks the replay landing page without breaking
 * the WACZ "structure" — every M1 / earlier-M3 rule would still pass.
 * That's exactly the kind of latent corruption waxlens is here to catch.
 *
 * Severity is `warning`: the WACZ may still be useful for partial
 * replay (deep-linking to other URLs known to the index), so we don't
 * want a missing mainPage reference to fail the validation outright.
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

  run: async (wacz) => {
    const issues: Issue[] = [];

    const dpBuf = await wacz.readEntry(DATAPACKAGE_ENTRY);
    if (!dpBuf) return ok(issues); // profile rule reports absence.
    const pkg = parseDatapackage(dpBuf.toString("utf-8"));
    if (!pkg) return ok(issues);

    const mainPageURL = pkg.mainPageURL;
    if (typeof mainPageURL !== "string" || mainPageURL.length === 0) {
      // Missing mainPageURL is its own producer bug, but the WACZ spec
      // doesn't strictly require it (Webrecorder's spec calls it
      // "optional but recommended"). We surface only the coverage gap,
      // not the absence itself.
      return ok(issues);
    }

    // Pages side --------------------------------------------------------
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
    // (`pages.jsonl` absent → resource-hashes / file-presence rules
    // surface it; we stay silent to avoid duplicate noise.)

    // CDXJ side ---------------------------------------------------------
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
