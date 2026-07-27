import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import mermaid from "astro-mermaid";
import remarkCodeRegion from "./src/plugins/remark-code-region";

const BASE = "/waxlens";

// WACZ 1.1.1 の日本語訳(別リポジトリで公開済み)。用語ページから参照する。
const SPEC_JA = "https://uraitakahito.github.io/specs/wacz/1.1.1/";
const SPEC_EN = "https://specs.webrecorder.net/wacz/1.1.1/";

// Rehype プラグイン: markdown 本文内の絶対ローカルリンク (/page/) に base を付与し、
// /ja/ 配下のページからのリンクには /ja ロケールも注入する。Starlight のサイドバーや
// ナビは slug 経由で base/locale-aware だが、MD/MDX 本文に書かれた [text](/page/) は
// 素通しになるため rehype 段で補正する。アセット(最終セグメントに拡張子を持つ href)は
// base のみ付与する。既に base-aware なリンクは二重付与しない。
function rehypeRebaseLinks() {
  return function (tree: any, file: any): void {
    const path: string = file?.path ?? file?.history?.[0] ?? "";
    const inJa = /[\\/]docs[\\/]ja[\\/]/.test(path);
    const walk = (node: any): void => {
      if (
        node.type === "element" &&
        node.tagName === "a" &&
        typeof node.properties?.href === "string"
      ) {
        const href: string = node.properties.href;
        if (
          href.startsWith("/") &&
          !href.startsWith("//") &&
          !href.startsWith(BASE + "/") &&
          href !== BASE
        ) {
          const lastSeg = href.split(/[?#]/)[0].split("/").pop() ?? "";
          const isAsset = lastSeg.includes(".");
          const locale =
            inJa && !isAsset && !href.startsWith("/ja/") && href !== "/ja" ? "/ja" : "";
          node.properties.href = BASE + locale + href;
        }
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
  };
}

// waxlens ドキュメントサイト。英語(root)と日本語(/ja/)を対で持つ。
// rule 表など「コードが唯一の情報源」であるものは src/lib/extract.ts が注入し、
// 対訳の欠落は scripts/check-doc-refs.mjs が検出する。
export default defineConfig({
  site: "https://uraitakahito.github.io",
  base: BASE,
  integrations: [
    mermaid({ theme: "neutral" }),
    starlight({
      title: "waxlens Docs",
      customCss: ["./src/styles/tables.css"],
      defaultLocale: "root",
      locales: {
        root: { label: "English", lang: "en" },
        ja: { label: "日本語", lang: "ja" },
      },
      sidebar: [
        { label: "Quickstart", slug: "quickstart" },
        {
          label: "Reference",
          items: [
            { label: "Rules", slug: "rules" },
            { label: "Profiles", slug: "profiles" },
            { label: "JSON report", slug: "json-report" },
          ],
        },
        {
          label: "Guides",
          items: [
            { label: "Architecture", slug: "architecture" },
            { label: "Apple Container stack", slug: "container" },
            { label: "Corpus", slug: "corpus" },
            { label: "Terminology", slug: "terminology" },
          ],
        },
        // 絶対 URL は意図的。root-relative にすると Starlight が日本語ページ上で
        // /ja/ を注入し 404 になる。
        { label: "WACZ 1.1.1 ↗", link: SPEC_EN },
        { label: "WACZ 1.1.1 (日本語訳) ↗", link: SPEC_JA },
      ],
    }),
  ],
  markdown: {
    remarkPlugins: [remarkCodeRegion],
    rehypePlugins: [rehypeRebaseLinks],
  },
});
