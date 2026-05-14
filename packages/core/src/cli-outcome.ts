/**
 * CLI outcome — `@waxlens/core` の bin (`waxlens-validate`) と
 * `@waxlens/tui` の bin (`waxlens`) の共通 return shape。
 *
 * `runCli` は exit code (数値) を返すのではなく「何が起きたか」を表す
 * この discriminated union を返す。数値 exit code に変換するのは
 * `exitCodeFor` の責務で、その関数だけが mapping を知る。
 *
 * 設計意図:
 *   - magic number (0 / 1 / 2) を CLI コードに散らさない。検索性は
 *     `exitCodeFor` 一点で十分。
 *   - 「何が起きたか」 (`kind`) と 「外向き contract」 (exit code) を
 *     分離。前者で render / stderr を dispatch し、後者は単一テーブル。
 *   - exhaustiveness を `switch` narrowing が静的に強制 — 新 variant を
 *     入れると `exitCodeFor` がコンパイルエラーで指してくる。
 *
 * 副作用 (stderr / stdout / Ink render) はこの outcome を消費する
 * 側 (CLI の action callback) が持つ。`runCli` は I/O を起こさず
 * outcome を組み立てるだけにする。これによって bin 名 prefix の差
 * (`waxlens-validate:` vs `waxlens:`) が共有モジュールに漏れない。
 */
import type { Report } from "./validate/types.js";

export type CliOutcome =
  | { kind: "valid"; report: Report }
  | { kind: "invalid"; report: Report }
  /**
   * `WaczReader.open` が throw した。`cause` は型情報を持たない (Node の
   * fs エラーは多形) ので `unknown` のまま運び、stderr formatter 側で
   * `error instanceof Error ? error.message : String(error)` する。
   */
  | { kind: "openFailed"; filePath: string; cause: unknown }
  /**
   * engine の `runValidation` が `Result<Report, never>` の err 分岐を
   * 返した。`never` 型なので論理的には到達不能だが、TS の narrowing 上
   * receiver 側が `!result.ok` を扱う必要があるため variant を残す。
   * 将来 engine が真に fallible になったらここに失敗情報を詰める。
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
 * `switch` を `default` 無しで書くことで、CliOutcome に新 variant を
 * 追加したときに TS が non-exhaustive を指す。これが「mapping は
 * ここに集約」の静的保証になっている。
 */
export const exitCodeFor = (outcome: CliOutcome): number => {
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
