/**
 * Rule: browserhive/tls-san(browserhive profile 限定 · >=3.7.0)
 *
 * `tls.hosts[].san` は producer の自己申告だが、その**根拠である証明書が同じ
 * パッケージに入っている**。突き合わせれば、記録が正しいかを producer と独立に
 * 言える —— 別実装で検証することの意味が、いちばん濃く出る場所。
 *
 * 確かめるのは 2 つ:
 *
 *   1. 記録された `san` が、リーフ証明書の subjectAltName と一致する
 *   2. その `san` が、記録されている host 名を実際に覆っている
 *
 * 版の条件があるのは `san` が browserhive 3.7.0 で入ったため。それ未満では欠けて
 * いて当然なので、走らせると「無い」を毎回報告することになる。走らせなかったことは
 * `Report.skipped` に残るので、読者は「問題なし」と「見ていない」を区別できる。
 *
 * Spec: https://uraitakahito.github.io/browserhive-specs/wacz-profile/1.1.0/#tls
 */
import { ok } from "../../result.js";
import { dnsNamesOf, parseChain, readTls } from "../browserhive-tls.js";
import type { Issue, ValidationRule } from "../domain.js";

/** 同じ名前の集合か(順序は問わない)。 */
const sameNames = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join(" ") === [...b].sort().join(" ");

export const browserhiveTlsSanRule: ValidationRule = {
  name: "browserhive/tls-san",
  descriptionKey: "browserhive/tls-san.desc",
  conformance: "MUST",
  docs: [
    {
      label: "BrowserHive WACZ Profile §tls",
      url: {
        en: "https://uraitakahito.github.io/browserhive-specs/wacz-profile/1.1.0/#tls",
        ja: "https://uraitakahito.github.io/browserhive-specs/wacz-profile/1.1.0/ja/#tls",
      },
    },
  ],
  applicability: {
    excludeProfiles: ["spec", "lenient"],
    profileVersions: { browserhive: ">=3.7.0" },
  },

  run: async (wacz) => {
    const tls = await readTls(wacz);
    if (tls === null) return ok([]);

    const issues: Issue[] = [];

    for (const [host, observed] of Object.entries(tls.hosts)) {
      if (observed === null) continue;

      const recorded = observed.san;
      if (!Array.isArray(recorded) || recorded.some((n) => typeof n !== "string")) {
        issues.push({
          rule: "browserhive/tls-san",
          severity: "error",
          messageKey: "browserhive/tls-san.missing",
          params: { host },
        });
        continue;
      }
      const names = recorded as string[];

      // 記録された san が host を覆っているか。証明書が無くても言える検査なので、
      // chainRef の有無より先に見る。
      const covers = names.some((name) =>
        name.startsWith("*.")
          ? host.endsWith(name.slice(1)) &&
            !host.slice(0, host.length - name.slice(1).length).includes(".")
          : name === host,
      );
      if (!covers) {
        issues.push({
          rule: "browserhive/tls-san",
          severity: "error",
          messageKey: "browserhive/tls-san.host-not-covered",
          params: { host, san: names.join(", ") },
        });
      }

      // ここから先は証明書が要る。取れていなければ突き合わせようがない。
      const ref = observed.chainRef;
      if (typeof ref !== "string") continue;
      const chain = tls.chains[ref];
      if (chain === undefined) continue; // 宙ぶらりんは tls-chain の管轄。
      const certs = parseChain(chain);
      if (certs === null) continue; // 解析不能も tls-chain が言う。

      const leaf = certs[0];
      if (leaf === undefined) continue;
      const fromCert = dnsNamesOf(leaf);
      if (!sameNames(names, fromCert)) {
        issues.push({
          rule: "browserhive/tls-san",
          severity: "error",
          messageKey: "browserhive/tls-san.drift",
          params: { host, recorded: names.length, certificate: fromCert.length },
          details: { expected: fromCert, actual: names },
        });
      }
    }

    return ok(issues);
  },
};
