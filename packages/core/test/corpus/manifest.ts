/**
 * waxlens-corpus `manifest.json` の形。
 *
 * 生成側 (build-corpus) と消費側 (corpus-driven / build-docs) が共有する
 * 契約なので、どちらにも寄せずここに 1 本だけ置く。
 *
 * これ以前は同じ形が 3 ファイルに重複宣言されており、実際にドリフトして
 * いた — corpus-driven だけ `description` を持たず (manifest 側は全 fixture
 * が持っているのに読まれていなかった)、`defaultProfile` の型も catalog と
 * 食い違っていた。
 *
 * 型だけの module なので `import type` で参照すればコンパイル時に消える。
 * catalog.ts の「副作用なし・文字列 in / 文字列 out」という性質はこれで
 * 保たれる。
 */
import type { RuleProfile } from "../../src/validate/domain.js";

/** manifest の 1 profile ぶんの結果 (build-corpus が実 runValidation から書く形)。 */
export interface ProfileResult {
  valid: boolean;
  issues: { rule: string; severity: string }[];
}

/** manifest の fixture 1 件。profile 横断で同一なら `expect`、異なれば `byProfile`。 */
export interface FixtureEntry {
  file: string;
  /**
   * spec.ts が書く 1 行説明。**optional にしない** — 全 fixture が持って
   * おり、必須にしておけば説明なしの fixture を spec.ts に足した時点で型
   * エラーになる。省略可にすると、いずれ半分が説明なしになる。
   */
  description: string;
  /**
   * その標本の `datapackage.json` が宣言する `$schema` の実測値。descriptor
   * が無い / `$schema` を持たない / 文字列でない場合は `null`。
   *
   * **optional にしない** — 省略可にすると「宣言が無い」と「まだ記録して
   * いない (古い manifest)」が同じ形になり区別できなくなる。ほぼ全件が
   * `null` なので、この区別が付かないと再生成しても差分がほとんど出ない。
   */
  $schema: string | null;
  expect?: ProfileResult;
  byProfile?: Record<string, ProfileResult>;
}

export interface Manifest {
  /**
   * catalog.ts では `string` だったが、corpus-driven は validate() へその
   * まま渡すので `RuleProfile` が正しい。狭い方に寄せる。
   */
  defaultProfile: RuleProfile;
  fixtures: FixtureEntry[];
}
