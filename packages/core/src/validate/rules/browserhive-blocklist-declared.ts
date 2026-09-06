/**
 * Rule: browserhive/blocklist-declared(browserhive profile 限定 · >=7.0.0)
 *
 * `settings.blockUrlPatterns` が、パターンの一覧として読める形をしているか。
 *
 * **不在も空も別々に意味を持つ**ところが、この member の要。profile 1.2.0 は
 * 「一致が 1 件も無くても書く」と要求し、空の配列を「効いていたパターンが無い」
 * という積極的な主張として定めた。書かなければ、読み手は「何も要求しなかった
 * ページ」と「要求されたものを記録しないことにした取り込み」を区別できない。
 * 証憑として読むとき、この 2 つは同じパッケージについての別の主張になる。
 *
 * したがってこの rule は:
 *
 *   - 空の配列を **通す**(それが「濾していない」の綴り)
 *   - member ごと無いものを **落とす**(何も述べていない)
 *   - 要素が文字列でないものを落とす —— 一致した metadata レコードの
 *     `pattern` はここに並ぶ原文と突き合わせる前提なので、綴りが読めないと
 *     突き合わせようがない
 *
 * 在ることそのものは `settings-shape` も見ている。あちらは 1.2.0 の必須 member が
 * 揃っているかを一括で問い、こちらはこの member 固有の意味 —— 空と不在の違い、
 * 要素の綴り —— だけを持つ。
 *
 * Spec: https://uraitakahito.github.io/browserhive-specs/wacz-profile/1.2.0/#blocked
 */
import { ok } from "../../result.js";
import { isRecord, readCapture } from "../browserhive-storage.js";
import type { Issue, ValidationRule } from "../domain.js";

const RULE = "browserhive/blocklist-declared";

export const browserhiveBlocklistDeclaredRule: ValidationRule = {
  name: "browserhive/blocklist-declared",
  descriptionKey: "browserhive/blocklist-declared.desc",
  conformance: "MUST",
  docs: [
    {
      label: "BrowserHive WACZ Profile §Blocked requests",
      url: {
        en: "https://uraitakahito.github.io/browserhive-specs/wacz-profile/1.2.0/#blocked",
        ja: "https://uraitakahito.github.io/browserhive-specs/wacz-profile/1.2.0/ja/#blocked",
      },
    },
  ],
  applicability: {
    excludeProfiles: ["spec", "lenient"],
    profileVersions: { browserhive: ">=7.0.0" },
  },
  run: async (wacz) => {
    const capture = await readCapture(wacz);
    if (capture === undefined) return ok([]);

    const settings = capture["settings"];
    if (!isRecord(settings)) return ok([]); // 形の不在は settings-shape の担当。

    const patterns = settings["blockUrlPatterns"];
    if (patterns === undefined) {
      return ok([
        {
          rule: RULE,
          severity: "error",
          messageKey: `${RULE}.absent`,
          params: {},
        } satisfies Issue,
      ]);
    }
    if (!Array.isArray(patterns)) {
      return ok([
        {
          rule: RULE,
          severity: "error",
          messageKey: `${RULE}.not-array`,
          params: { found: typeof patterns },
        } satisfies Issue,
      ]);
    }

    // 空は通す。それが「濾していない」という主張の綴り。
    const bad = patterns.filter((p) => typeof p !== "string").length;
    if (bad > 0) {
      return ok([
        {
          rule: RULE,
          severity: "error",
          messageKey: `${RULE}.non-string-entry`,
          params: { count: String(bad) },
        } satisfies Issue,
      ]);
    }
    return ok([]);
  },
};
