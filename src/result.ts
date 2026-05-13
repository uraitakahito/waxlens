/**
 * Result<T, E> — discriminated-union return type for fallible operations.
 *
 * The stack-wide convention (browserhive, waggle) is to use this instead of
 * exceptions for *expected* failure modes: parser rejections, missing entries,
 * hash mismatches, etc. Exceptions are reserved for genuinely-unexpected
 * conditions (programmer errors, I/O the OS itself refused). This lets
 * validation rules return `Result<Issue[], never>` — they always produce a
 * report, never throw.
 */

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/**
 * Narrow helpers — slightly nicer than `if (!r.ok)` at every call site when
 * the failure case is the rare path.
 */
export const isOk = <T, E>(r: Result<T, E>): r is { ok: true; value: T } => r.ok;
export const isErr = <T, E>(r: Result<T, E>): r is { ok: false; error: E } => !r.ok;
