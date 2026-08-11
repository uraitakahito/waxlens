// @module-tag corpus
/**
 * `CORPUS_DIR` が指す corpus が、この waxlens の固定先と同じ版かを確かめる。
 *
 * 固定先は repo ルートの `.corpus-version` (1 行、tag 名) で、CI の
 * `corpus.yml` も同じファイルを読んで clone する。CI は必ず一致するので、
 * ここが効くのは手元 — `../waxlens-corpus` が `main` のまま渡されると、
 * そのまま走って「なぜか期待値が合わない」という、原因から最も遠い症状に
 * なる。
 *
 * 判定できないとき (git repo でない = リリース資産の tarball を展開した等)
 * は黙って通す。**「判定できない」と「判定して違う」は別**で、前者で止めると
 * tarball を配った意味が無くなる。
 *
 * 呼ぶのは corpus を**読む**側 (corpus-driven / build-docs) だけ。
 * build-corpus は次のリリースを作るために固定先と違う版で走るのが仕事なので、
 * ここで止めたら新しい corpus を一生作れない。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** repo ルート — このファイルは <root>/packages/core/test/corpus/ にある。 */
const repoRoot = resolve(import.meta.dirname, "..", "..", "..", "..");

/** `.corpus-version` が指す tag。読めなければ throw (固定が壊れている)。 */
export const pinnedCorpusRef = (): string =>
  readFileSync(resolve(repoRoot, ".corpus-version"), "utf8").trim();

const git = (root: string, ...args: string[]): string | undefined => {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
};

/**
 * `root` が git work tree かどうか。**tag の上に居るかとは別の問い**。
 *
 * この 2 つを混ぜると、いちばん起きやすい失敗 (手元の checkout が tag から
 * 進んでいる) が「判定できない」に化けて素通りする。実際に最初そう書いて、
 * tag より前の commit を渡したのに 29 件が通ってしまった。
 */
export const isGitRepo = (root: string): boolean => git(root, "rev-parse", "--git-dir") !== undefined;

/**
 * `root` が指している版の人間向け表記。tag の上ならその tag 名、そうでなければ
 * 短い SHA。git repo でなければ `undefined`。
 */
export const corpusRefAt = (root: string): string | undefined =>
  git(root, "describe", "--tags", "--exact-match", "HEAD") ?? git(root, "rev-parse", "--short", "HEAD");

/**
 * 固定先と違う版を渡されていたら throw する。
 *
 * skip ではなく throw なのは `corpus-dir.ts` と同じ理由 — `CORPUS_DIR` を
 * 明示的に渡した人は走らせたいのであって、静かに飛ばされたら渡した意味が
 * ない。`pnpm check` は `CORPUS_DIR` を設定しないので、routine な check が
 * これで落ちることはない。
 */
export const assertPinnedCorpus = (root: string): void => {
  // git repo でなければ判定材料が無い (tarball を展開した等)。ここは通す。
  if (!isGitRepo(root)) return;

  const pinned = pinnedCorpusRef();
  const actual = corpusRefAt(root) ?? "(不明)";
  if (actual === pinned) return;
  throw new Error(
    `CORPUS_DIR は ${actual} を指していますが、この waxlens は ${pinned} に固定されています。\n` +
      `  git -C ${root} fetch --tags && git -C ${root} checkout ${pinned}\n` +
      `固定先を上げたい場合は .corpus-version を変更してください ` +
      `(corpus 側のリリースが先に要ります)。`,
  );
};
