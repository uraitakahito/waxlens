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
      // 各項目に `ja` 訳を持たせる。Starlight はページを翻訳するが
      // ナビゲーションは翻訳しないので、これが無いと日本語ドキュメントは
      // 翻訳済みのページが英語の目次にぶら下がった状態になる。
      sidebar: [
        { label: "Quickstart", translations: { ja: "クイックスタート" }, slug: "quickstart" },
        {
          label: "Reference",
          translations: { ja: "リファレンス" },
          items: [
            { label: "Rules", translations: { ja: "Rules" }, slug: "rules" },
            { label: "Profiles", translations: { ja: "プロファイル" }, slug: "profiles" },
            { label: "JSON report", translations: { ja: "JSON レポート" }, slug: "json-report" },
          ],
        },
        {
          label: "Guides",
          translations: { ja: "ガイド" },
          items: [
            { label: "Architecture", translations: { ja: "アーキテクチャ" }, slug: "architecture" },
            {
              label: "Apple Container stack",
              translations: { ja: "Apple Container スタック" },
              slug: "container",
            },
            // corpus のドキュメントは corpus repo 側に移した。標本の一覧が標本と
            // 別 repo にある状態を解消するため。カタログの生成先も CORPUS_DIR 配下。
            {
              label: "Corpus ↗",
              translations: { ja: "Corpus ↗" },
              link: "https://uraitakahito.github.io/waxlens-corpus/",
            },
            { label: "Terminology", translations: { ja: "用語" }, slug: "terminology" },
          ],
        },
        {
          // waxlens そのものを開発する人向け。使う側の Guides とは読者が違う。
          label: "For developers",
          translations: { ja: "開発者向け" },
          items: [
            {
              label: "Running the tests",
              translations: { ja: "テストの実行" },
              slug: "running-tests",
            },
          ],
        },
        // 絶対 URL は意図的。root-relative にすると Starlight が日本語ページ上で
        // /ja/ を注入し 404 になる。
        // 仕様書そのものの名前なので訳さない。
        { label: "WACZ 1.1.1 ↗", translations: { ja: "WACZ 1.1.1 ↗" }, link: SPEC_EN },
        {
          label: "WACZ 1.1.1 (日本語訳) ↗",
          translations: { ja: "WACZ 1.1.1 (日本語訳) ↗" },
          link: SPEC_JA,
        },
      ],
    }),
  ],
  markdown: {
    remarkPlugins: [remarkCodeRegion],
    rehypePlugins: [rehypeRebaseLinks],
  },
});
