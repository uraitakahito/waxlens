/**
 * waxlens の共有語彙 — profile / locale / CLI の exit code 契約。
 *
 * **この module は何も import しない。** それがこの package の存在理由で、
 * `@waxlens/protocol` (browser でも bundle される) が `@waxlens/core` を
 * runtime に引き込まずに済むようにしている。core を 1 回 import すると
 * validation engine 一式 (`@aws-sdk/client-s3` 4.4M を含む) が付いてきて、
 * 実測 67 ms かかる — 文字列 3 つのためにそれは払えない。
 *
 * 以前は core と protocol が同じ定義を手で複製していた。型 (`RuleProfile`)
 * は core から re-export しつつ値 (`ALL_PROFILES`) だけ複製する形だったので、
 * **片方に profile を足しても何もエラーにならず**、2 つの CLI が
 * 「存在する profile」について別の答えを持てた。持ち主を 1 つにして
 * その余地を無くしたのがここ。
 */

export { describeCause } from "./describe-cause.js";
export {
  ALL_PROFILES,
  DEFAULT_PROFILE,
  DEFAULT_SELECTOR,
  formatProfileSelector,
  parseProfileSelector,
} from "./profile.js";
export type { ProfileSelector, RuleProfile } from "./profile.js";
export { formatSemVer, parseSemVer, satisfies } from "./version.js";
export type { SemVer } from "./version.js";

export const SUPPORTED_LOCALES = ["en", "ja"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/**
 * CLI の outcome (exit code に map する前の「何が起きたか」)。
 *
 * report の型は呼び手が決める — `waxlens-validate` は engine の `Report` を
 * そのまま運び、`waxlens` (tui) は daemon が解決済みで返す `WireReport` を
 * 運ぶ。**違うのはそこだけ**なので、型引数 1 つで両方を賄う。
 *
 * 数値 exit code に変換するのは {@link exitCodeFor} の責務で、その関数だけが
 * mapping を知る。「何が起きたか」(`kind`) と「外向き contract」(exit code)
 * を分けることで、前者で render / stderr を dispatch し、後者は単一テーブル
 * に閉じ込められる。
 *
 * 副作用 (stderr / stdout / Ink render) はこの outcome を消費する側が持つ。
 * outcome を組み立てる側は I/O を起こさない。
 */
export type CliOutcome<TReport> =
  | { kind: "valid"; report: TReport }
  | { kind: "invalid"; report: TReport }
  /**
   * WACZ を開けなかった。`cause` は型情報を持たない (Node の fs / aws-sdk の
   * エラーは多形) ので `unknown` のまま運び、表示する側が
   * {@link describeCause} で 1 行にする。`.message` を直接読んではいけない —
   * aws-sdk は本文の無い応答で placeholder しか入れないので、そこだけを見ると
   * 404 も 403 も `"UnknownError"` になる。
   */
  | { kind: "openFailed"; filePath: string; cause: unknown }
  /**
   * engine が `Result<Report, never>` の err 分岐を返した。`never` 型なので
   * 論理的には到達不能だが、TS の narrowing 上 receiver 側が `!result.ok` を
   * 扱う必要があるため variant を残す。将来 engine が真に fallible になったら
   * ここに失敗情報を詰める。
   */
  | { kind: "engineFailed" };

/**
 * outcome → 数値 exit code への単一テーブル。
 *
 * 契約 (両 bin で共通):
 *   0 — validation 成功 (error severity の issue なし)
 *   1 — validation 失敗 (error severity の issue が 1 件以上)
 *   2 — operational な失敗 (ファイルが開けない、engine の想定外失敗)
 *
 * `kind` しか見ないので report の型は問わない。`switch` を `default` 無しで
 * 書くことで、`CliOutcome` に新 variant を追加したときに TS が
 * non-exhaustive を指す — これが「mapping はここに集約」の静的保証。
 */
export const exitCodeFor = (outcome: CliOutcome<unknown>): number => {
  switch (outcome.kind) {
    case "valid":
      return 0;
    case "invalid":
      return 1;
    case "openFailed":
    case "engineFailed":
      return 2;
  }
};
