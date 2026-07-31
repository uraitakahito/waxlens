/**
 * `CORPUS_DIR` を読む唯一の入口。build-corpus / corpus-driven / build-docs は
 * 同じ規約で動くので、規約そのものはここに 1 つだけ置く。
 *
 * 規約は 2 つ:
 *
 *   未設定 → `undefined`。呼び出し側は skip する。corpus は別 repo の Git LFS
 *   なので、置いていない開発者の `pnpm check` を落とさないための設計。
 *
 *   設定されているが相対パス → **throw**。これらは `pnpm --filter
 *   @waxlens/core` 経由で走り、その cwd は packages/core になる。相対パスは
 *   入力したシェルではなくそこを基準に解決されるので、`../waxlens-corpus` は
 *   `packages/waxlens-corpus` を指す。存在しないので manifest が見つからず、
 *   スイートは skip する — 渡したのにスキップされる、という原因から最も遠い
 *   症状になる。黙って skip するより、渡し方を名指しして落ちるほうが早い。
 *
 * build-corpus はさらに切実で、あれは fixtures を丸ごと削除してから書き直す。
 * 行き先を取り違えたまま黙って進む余地は残さない。
 */
import { isAbsolute, resolve } from "node:path";

export const corpusRoot = (): string | undefined => {
  const raw = process.env["CORPUS_DIR"]?.trim();
  if (raw === undefined || raw === "") return undefined;

  if (!isAbsolute(raw)) {
    throw new Error(
      `CORPUS_DIR must be an absolute path, got ${JSON.stringify(raw)}.\n` +
        `These scripts run with cwd=packages/core (pnpm --filter), so a relative ` +
        `path resolves there rather than in your shell.\n` +
        `Let the shell expand it first:\n` +
        `  CORPUS_DIR="$(cd ${raw} && pwd)" pnpm --filter @waxlens/core <script>`,
    );
  }

  // 絶対でも `..` や末尾の / は含みうるので正規化しておく。
  return resolve(raw);
};
