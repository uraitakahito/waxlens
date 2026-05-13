/**
 * WARC.gz independent-gzip-member iterator.
 *
 * A `.warc.gz` produced per the WARC spec is a *concatenation* of
 * independent gzip members — one per record — so that an offset/length pair
 * in the CDXJ index can be used to seek to and decompress a single record
 * without parsing the rest of the file. (See browserhive's
 * `src/storage/warc/writer.ts:1-15` for the producer side.) Verifying that
 * this invariant holds is rule #7 in the M3 set.
 *
 * Detection strategy: each gzip member begins with the magic bytes
 * `0x1f 0x8b`. We scan the buffer for these markers and slice; `gunzipSync`
 * on each slice then verifies that the boundaries are actually correct
 * (it'll throw if a slice starts mid-member). The marker bytes can also
 * appear inside compressed payloads by chance, but a stray match makes the
 * subsequent `gunzipSync` fail — so a "valid concatenation" check is just
 * "every slice decompresses cleanly".
 *
 * The iterator yields `WarcMember { offset, length, gzipped, raw }` so
 * downstream rules can cross-check CDXJ offsets and parse WARC headers
 * out of `raw`. M1 only uses `offset` / `length` for the CDXJ boundary
 * rule (and even that lands in M3); the iterator itself is built here so
 * the reader layer is complete in one go.
 */
import { gunzipSync } from "node:zlib";

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

export interface WarcMember {
  /** Byte offset of this member's first byte in the source buffer. */
  offset: number;
  /** Length of the gzipped member in bytes. */
  length: number;
  /** The gzipped bytes (still compressed). */
  gzipped: Buffer;
  /** Decompressed payload (the raw WARC record). */
  raw: Buffer;
}

export interface IterateOptions {
  /**
   * When true, swallow `gunzipSync` failures and stop iteration at the
   * first bad member. The validation rule that *uses* this iterator
   * wants the opposite: it asks for strict mode and turns the thrown
   * error into an Issue. Iteration helpers (e.g. printing record headers
   * for human-readable error context) can use the loose mode.
   *
   * Default: false (throw on a bad member).
   */
  loose?: boolean;
}

/**
 * Iterate every gzip member in `bytes`. Throws on a malformed member when
 * `opts.loose !== true`. The function is generator-flavoured (returns an
 * Iterable) so callers can stop early without forcing the whole archive
 * into memory twice.
 */
export function* iterateWarcMembers(
  bytes: Buffer,
  opts: IterateOptions = {},
): Generator<WarcMember, void, void> {
  const memberStarts = findMemberStarts(bytes);
  if (memberStarts.length === 0) return;

  for (let i = 0; i < memberStarts.length; i++) {
    const offset = memberStarts[i];
    const end = memberStarts[i + 1] ?? bytes.length;
    if (offset === undefined) continue;
    const gzipped = bytes.subarray(offset, end);
    let raw: Buffer;
    try {
      raw = gunzipSync(gzipped);
    } catch (error) {
      if (opts.loose) return;
      throw new WarcMemberDecodeError(offset, end - offset, error);
    }
    yield {
      offset,
      length: end - offset,
      gzipped,
      raw,
    };
  }
}

/**
 * Locate every byte offset that *could* be a gzip member start. Naïve
 * implementation — we scan for the magic byte pair `1f 8b` and accept all
 * matches. False positives (magic appearing inside compressed payload)
 * are filtered downstream by `gunzipSync` failing on a bad slice.
 *
 * To minimise false positives we additionally require the compression
 * method byte at offset+2 to be 0x08 (DEFLATE, the only method Node's
 * `gunzipSync` accepts). This still isn't bullet-proof, but in practice
 * the producer (browserhive's `WarcWriter`) emits only well-formed
 * members, so the validator's job is to catch real producer bugs — not
 * to be robust against adversarial input.
 */
const findMemberStarts = (bytes: Buffer): number[] => {
  const starts: number[] = [];
  // The first member always starts at offset 0 if the file is well-formed.
  // We don't seed `starts` with 0 unconditionally — let the scan find it
  // so a missing magic at offset 0 is reported as "zero members".
  for (let i = 0; i + 2 < bytes.length; i++) {
    if (bytes[i] === GZIP_MAGIC_0 && bytes[i + 1] === GZIP_MAGIC_1 && bytes[i + 2] === 0x08) {
      starts.push(i);
    }
  }
  return starts;
};

export class WarcMemberDecodeError extends Error {
  override readonly name = "WarcMemberDecodeError";
  // `Error` itself has an optional `cause` (ES2022); we re-declare with
  // `override` and a narrower (always-present) type so the throw site can
  // attach the original failure without losing the typed access.
  override readonly cause: unknown;
  constructor(
    readonly offset: number,
    readonly length: number,
    cause: unknown,
  ) {
    super(`Failed to decode gzip member at offset ${String(offset)} (length ${String(length)})`);
    this.cause = cause;
  }
}
