/**
 * Result<T, E> — fallible な操作のための discriminated-union な return type。
 *
 * *想定される* 失敗モード (parser の reject、entry 欠落、hash 不一致など)
 * には例外ではなくこちらを使う。例外は本当に *想定外* の状況 (プログラマ
 * のバグや OS 側が拒んだ I/O など) に取っておく。これによって validation
 * rule は `Result<Issue[], never>` を返せる — 必ず report を生成し、
 * throw しない。
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
