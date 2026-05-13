/**
 * WARC record header parser.
 *
 * A single WARC record laid out per the spec:
 *
 *   WARC/1.1<CRLF>
 *   Key: Value<CRLF>
 *   Key: Value<CRLF>
 *   <CRLF>                       ← header/body separator
 *   <body bytes>
 *   <CRLF><CRLF>                 ← record terminator
 *
 * The parser locates the first `<CRLF><CRLF>` (header/body separator),
 * splits the header block by `<CRLF>`, and yields each line as a
 * `[name, value]` pair. The body is whatever lies between the separator
 * and the trailing terminator (the iterator caller can strip the
 * terminator if it needs the exact `Content-Length` bytes).
 *
 * Header parsing is intentionally permissive: we don't fold continuation
 * lines (WARC records browserhive emits don't use them), we don't
 * normalise header-name casing (the spec is case-insensitive but tools
 * — including ours — rely on the canonical mixed-case spellings), and
 * we accept any `Key: Value` shape including empty values.
 *
 * Payload-Digest helpers:
 *   - For `warcinfo` / `metadata` records the digest is over the record
 *     body verbatim.
 *   - For `response` records the digest is over the HTTP *entity body*
 *     — i.e. the bytes after the first `<CRLF><CRLF>` *inside the
 *     body* (which separates the HTTP headers from the HTTP payload).
 *     `httpEntityBody` extracts that slice.
 */
import { Buffer } from "node:buffer";

const CRLF = Buffer.from("\r\n");
const HEADER_BODY_SEP = Buffer.from("\r\n\r\n");

export interface WarcHeader {
  /** Canonical mixed-case `Key`. */
  name: string;
  /** Raw value, no whitespace stripped (callers trim if needed). */
  value: string;
}

export interface ParsedWarcRecord {
  /** First line, e.g. "WARC/1.1". Undefined if the slice doesn't start with the protocol token. */
  protocol?: string;
  headers: WarcHeader[];
  /** Bytes between the header/body separator and the trailing `\r\n\r\n` terminator. */
  body: Buffer;
}

/**
 * Parse a single WARC record from its raw (decompressed) bytes. Returns
 * a structured form even for partially-malformed records — the caller's
 * rule decides whether incompleteness is a violation. Returns null only
 * when the header/body separator cannot be located at all.
 */
export const parseWarcRecord = (raw: Buffer): ParsedWarcRecord | null => {
  const sepIdx = raw.indexOf(HEADER_BODY_SEP);
  if (sepIdx === -1) return null;
  const headerBlock = raw.subarray(0, sepIdx);
  let body = raw.subarray(sepIdx + HEADER_BODY_SEP.byteLength);

  // The producer appends `\r\n\r\n` after the body as the record
  // terminator. Strip exactly those four bytes when present so the
  // returned body matches `Content-Length` exactly.
  if (body.length >= 4 && body.subarray(body.length - 4).equals(HEADER_BODY_SEP)) {
    body = body.subarray(0, body.length - 4);
  }

  const lines = splitByCrlf(headerBlock);
  let protocol: string | undefined;
  const headers: WarcHeader[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (i === 0 && line.startsWith("WARC/")) {
      protocol = line;
      continue;
    }
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const name = line.slice(0, colon);
    const value = line.slice(colon + 1).trimStart();
    headers.push({ name, value });
  }

  return protocol !== undefined ? { protocol, headers, body } : { headers, body };
};

const splitByCrlf = (buf: Buffer): string[] => {
  const out: string[] = [];
  let start = 0;
  while (start < buf.length) {
    const idx = buf.indexOf(CRLF, start);
    if (idx === -1) {
      out.push(buf.subarray(start).toString("utf-8"));
      break;
    }
    out.push(buf.subarray(start, idx).toString("utf-8"));
    start = idx + CRLF.byteLength;
  }
  return out;
};

/** Convenience: case-insensitive header lookup, last-wins (matches HTTP semantics). */
export const getHeader = (record: ParsedWarcRecord, name: string): string | undefined => {
  const lowered = name.toLowerCase();
  let value: string | undefined;
  for (const h of record.headers) {
    if (h.name.toLowerCase() === lowered) value = h.value;
  }
  return value;
};

/**
 * For a `response` record, extract the HTTP entity body — the bytes the
 * `WARC-Payload-Digest` is computed over. The record body has the shape
 * `<HTTP status line + headers>\r\n\r\n<entity body>`; we slice on the
 * first inner `\r\n\r\n`. Returns `null` if no separator is present
 * (malformed HTTP block).
 */
export const httpEntityBody = (record: ParsedWarcRecord): Buffer | null => {
  const sepIdx = record.body.indexOf(HEADER_BODY_SEP);
  if (sepIdx === -1) return null;
  return record.body.subarray(sepIdx + HEADER_BODY_SEP.byteLength);
};
