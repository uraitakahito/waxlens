/**
 * corpus カタログ生成ドライバ (build-corpus と対称)。
 *
 * `CORPUS_DIR` が指す repo の `manifest.json` を読み、renderCatalog で
 * Markdown 表に変換し、docs site の corpus ページ (en / ja) の
 * corpus-catalog マーカー間に注入する。表の中身は言語非依存で、
 * 見出しだけが言語ごとに変わる。生成ロジックそのものは catalog.ts (純粋) + catalog.test.ts
 * (常時走る) が担保し、このファイルは I/O と CORPUS_DIR 解決だけを持つ。
 *
 * manifest.json は LFS 対象外 (`.gitattributes` は *.wacz のみ) なので、
 * doc 生成は実 WACZ も `git lfs pull` も要らない — corpus repo が
 * 置いてあれば十分。CORPUS_DIR 未設定時は **skip** するので通常の
 * `pnpm check` には影響しない (build-corpus / corpus-driven と同じ規約)。
 *
 *   # 生成 (docs を書き換える)
 *   CORPUS_DIR=<corpus の絶対パス> pnpm --filter @waxlens/core corpus:docs
 *   # 鮮度検査 (差分があれば fail。CI 用)
 *   CORPUS_DIR=<corpus の絶対パス> pnpm --filter @waxlens/core corpus:docs:check
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { injectCatalog, renderCatalog, type CatalogLang, type Manifest } from "./catalog.js";

const corpusDir = process.env["CORPUS_DIR"];
// WAXLENS_DOCS_CHECK=1 のときは書き換えず、committed な docs と突き合わせる。
const checkMode = process.env["WAXLENS_DOCS_CHECK"] === "1";

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/core/test/corpus → repo root (4 つ上) → docs site の corpus ページ。
const ROOT = resolve(HERE, "..", "..", "..", "..");
const DOCS = resolve(ROOT, "docs-site", "src", "content", "docs");
const TARGETS: { lang: CatalogLang; path: string; label: string }[] = [
  { lang: "en", path: resolve(DOCS, "corpus.md"), label: "corpus.md" },
  { lang: "ja", path: resolve(DOCS, "ja", "corpus.md"), label: "ja/corpus.md" },
];

describe.skipIf(corpusDir === undefined || corpusDir === "")("build-docs", () => {
  it.each(TARGETS)("renders the $label catalog from manifest.json", async ({ lang, path, label }) => {
    const manifestPath = resolve(corpusDir ?? "", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
    const current = await readFile(path, "utf8");
    const next = injectCatalog(current, renderCatalog(manifest, lang));

    if (checkMode) {
      expect(
        current,
        `${label} が manifest と不一致。\`pnpm --filter @waxlens/core corpus:docs\` を実行して commit してください`,
      ).toBe(next);
    } else if (current !== next) {
      await writeFile(path, next, "utf8");
    }
  });
});
