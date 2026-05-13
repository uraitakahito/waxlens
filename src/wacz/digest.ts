/**
 * SHA-256 helpers for WACZ validation.
 *
 * WACZ uses two distinct digest formats:
 *   - `datapackage.json` resource hashes:  `sha256:<hex>`     (this module)
 *   - WARC `WARC-Payload-Digest` headers:  `sha256:<base32>`  (used by
 *     the `warc/payload-digest` rule)
 *
 * Keeping the two formats in one module so the asymmetry is obvious to
 * anyone touching either side later.
 */
import { createHash } from "node:crypto";

/**
 * `sha256:<hex>` over the given bytes. The format specified by the
 * Frictionless Data Package descriptor that WACZ `datapackage.json`
 * embeds.
 */
export const sha256Hex = (bytes: Buffer): string =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

/**
 * `sha256:<base32>` over the given bytes — the WARC-Payload-Digest format
 * (RFC 4648 base32, no padding, uppercase). Not used yet (M3); shipped here
 * for proximity to the hex variant so the two stay in sync.
 */
export const sha256Base32 = (bytes: Buffer): string => {
  const digest = createHash("sha256").update(bytes).digest();
  return `sha256:${toBase32(digest)}`;
};

/**
 * RFC 4648 base32 encoder (no padding). Inlined rather than pulled from a
 * dependency: ~30 lines of pure logic, no need to take on a transitive.
 */
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const toBase32 = (bytes: Buffer): string => {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      // BASE32_ALPHABET has exactly 32 chars; the 5-bit value can only
      // index 0..31, so the lookup is total — `!` is safe here.
      const ch = BASE32_ALPHABET[(value >> bits) & 0x1f];
      if (ch !== undefined) output += ch;
    }
  }
  if (bits > 0) {
    const ch = BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
    if (ch !== undefined) output += ch;
  }
  return output;
};
