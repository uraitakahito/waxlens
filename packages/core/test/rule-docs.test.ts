// @module-tag docs
/**
 * rule が持つ出典リンクの健全性チェック。
 *
 * 「全 rule が出典を持つ」は `ValidationRule.docs` を必須にしたので**型の仕事**に
 * なった。ここが見るのは型で表せないもの:
 *   - URL が https(リンクとして妥当)
 *   - 同じアンカーを指すリンクは同じ URL の組を持つ
 *   - 複数 spec を跨ぐ rule は複数リンクを持つ
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_RULES, docsForRule } from "../src/validate/rules/index.js";

const allLinks = DEFAULT_RULES.flatMap((rule) => rule.docs.map((doc) => ({ rule: rule.name, doc })));

describe("rule docs", () => {
  it("全 URL は https", () => {
    for (const { rule, doc } of allLinks) {
      for (const [locale, url] of Object.entries(doc.url)) {
        expect(url, `${rule} / ${locale}`).toMatch(/^https:\/\//);
      }
    }
  });

  it("同じアンカーには同じ URL の組が使われている", () => {
    // 出典を rule 側に直書きする形なので、同じ節を指す rule が複数ある
    // (`#indexes` は 5 rule、`#datapackage-json` は 4 rule)。1 つだけ版を
    // 上げると静かに食い違うので、アンカーで束ねて突き合わせる。
    const byAnchor = new Map<string, { rule: string; url: string }[]>();
    for (const { rule, doc } of allLinks) {
      const anchor = doc.url.en.split("#")[1];
      if (anchor === undefined) continue; // アンカー無しの URL は対象外
      const seen = byAnchor.get(anchor) ?? [];
      seen.push({ rule, url: JSON.stringify(doc.url) });
      byAnchor.set(anchor, seen);
    }
    for (const [anchor, entries] of byAnchor) {
      const distinct = new Set(entries.map((e) => e.url));
      expect(
        [...distinct],
        `#${anchor} を指す ${String(entries.length)} 件で URL が食い違う: ` +
          entries.map((e) => e.rule).join(", "),
      ).toHaveLength(1);
    }
  });

  it("WACZ を指すリンクは和訳の URL も持つ", () => {
    // 和訳があるのは WACZ だけ(17 本)で、WARC 3 / data-package 3 /
    // data-resource 2 は本家しか無い。アンカーは本家と同じなので ja を足す
    // のは URL の前半を差し替えるだけ — 逆に言えば書き忘れても何も壊れず、
    // 日本語の読者だけが黙って英語の spec に飛ばされる。
    for (const { rule, doc } of allLinks) {
      if (!doc.url.en.includes("/wacz/")) continue;
      expect(doc.url.ja, `${rule}: ${doc.label}`).toBeDefined();
    }
  });

  it("frictionless-structure は 2 spec を持つ", () => {
    expect(docsForRule("datapackage/frictionless-structure")).toHaveLength(2);
  });
});
