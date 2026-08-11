// @module-tag corpus
// @module-tag docs
/**
 * corpus カタログ生成ドライバ (build-corpus と対称)。
 *
 * `CORPUS_DIR` が指す repo の `manifest.json` を読み、renderCatalog で
 * Markdown 表に変換し、**同じ repo の** docs site の catalogue ページ (en / ja)
 * の corpus-catalog マーカー間に注入する。表の中身は言語非依存で、
 * 見出しだけが言語ごとに変わる。生成ロジックそのものは catalog.ts (純粋) + catalog.test.ts
 * (常時走る) が担保し、このファイルは I/O と CORPUS_DIR 解決だけを持つ。
 *
 * manifest.json は LFS 対象外 (`.gitattributes` は *.wacz のみ) なので、
 * doc 生成は実 WACZ も `git lfs pull` も要らない — corpus repo が
 * 置いてあれば十分。書き込み先も corpus repo なので、生成物 (fixtures /
 * manifest / catalogue) がすべて同じ場所に揃う。CORPUS_DIR 未設定時は **skip** するので通常の
 * `pnpm check` には影響しない (build-corpus / corpus-driven と同じ規約)。
 *
 *   # 生成 (docs を書き換える)
 *   CORPUS_DIR=<corpus の絶対パス> pnpm --filter @waxlens/core corpus:docs
 *   # 鮮度検査 (差分があれば fail。CI 用)
 *   CORPUS_DIR=<corpus の絶対パス> pnpm --filter @waxlens/core corpus:docs:check
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { injectCatalog, renderCatalog, type CatalogLang, type Manifest } from "./catalog.js";
import { corpusRoot } from "./corpus-dir.js";
import { assertPinnedCorpus } from "./corpus-version.js";

const corpusRootDir = corpusRoot();
// WAXLENS_DOCS_CHECK=1 のときは書き換えず、committed な docs と突き合わせる。
const checkMode = process.env["WAXLENS_DOCS_CHECK"] === "1";

// 版の固定を要求するのは**検査モードだけ**。書き込みモード (`corpus:docs`) は
// 次のリリースを作るために固定先と違う版へ書くのが仕事なので、ここで止めたら
// 新しい catalogue を生成できない。build-corpus を素通しにするのと同じ理由。
if (checkMode && corpusRootDir !== undefined) assertPinnedCorpus(corpusRootDir);

// 出力先は **corpus repo の** docs site。標本の一覧が標本と別 repo にある状態を
// 解消するため、カタログは fixtures/ と manifest.json と同じ経路 (CORPUS_DIR) で
// corpus 側へ書く。依存の向きは waxlens → corpus のまま変わらない。
const docsDir = (root: string): string => resolve(root, "docs-site", "src", "content", "docs");
const targets = (root: string): { lang: CatalogLang; path: string; label: string }[] => [
  { lang: "en", path: resolve(docsDir(root), "catalogue.md"), label: "catalogue.md" },
  { lang: "ja", path: resolve(docsDir(root), "ja", "catalogue.md"), label: "ja/catalogue.md" },
];

describe.skipIf(corpusRootDir === undefined)("build-docs", () => {
  it.each(targets(corpusRootDir ?? ""))(
    "renders the $label catalog from manifest.json",
    async ({ lang, path, label }) => {
      const manifestPath = resolve(corpusRootDir ?? "", "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
      const current = await readFile(path, "utf8");
      const next = injectCatalog(current, renderCatalog(manifest, lang));

      if (checkMode) {
        expect(
          current,
          `${label} が manifest と不一致。corpus repo で \`pnpm --filter @waxlens/core corpus:docs\` を実行して commit してください`,
        ).toBe(next);
      } else if (current !== next) {
        await writeFile(path, next, "utf8");
      }
    },
  );
});
