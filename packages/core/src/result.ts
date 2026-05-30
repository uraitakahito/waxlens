/**
 * Result<T, E> — fallible な操作のための discriminated-union な return type。
 *
 * 採用判断は 2 軸で決める:
 *   1. caller が失敗種別ごとに *specific に反応* するか
 *      (switch(error.kind) で個別 message / retry / 経路分岐をやる)
 *   2. 失敗の集合は *閉じている* か (列挙可能か)
 * 両方 yes なら Result + tagged union を使う。 caller の network 失敗が
 * 全部「共通 catch して通知するだけ」 で済むような場面は throw で十分
 * — それを取り立てて Result 化する benefit は無い。
 *
 * よくある誤解として 「想定される失敗 = Result、 想定外 = throw」 と
 * 二分するものがあるが、 これは不正確。 I/O や network エラーも
 * 「想定される」 ことは想定されている。 違いは caller がそれに
 * specific に反応するかどうかであって、 想定の有無ではない。 判断は
 * API ごとに caller の現コードを見て決める。
 *
 * waxlens の用例: validation rule は `Result<Issue[], never>` を返す
 * — engine が失敗を必ず Issue に畳む契約なので、 caller (engine) は
 * 失敗を見ない。 err variant が空 (`never`) で表現される。
 */

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/**
 * narrowing helper — 失敗ケースが稀な場合、各 call site で `if (!r.ok)`
 * を書くより少し読みやすい。
 */
export const isOk = <T, E>(r: Result<T, E>): r is { ok: true; value: T } => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is { ok: false; error: E } => !r.ok;
