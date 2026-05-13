/**
 * WARC record header parser。
 *
 * spec に従った単一の WARC record のレイアウト:
 *
 *   WARC/1.1<CRLF>
 *   Key: Value<CRLF>
 *   Key: Value<CRLF>
 *   <CRLF>                       ← header/body 区切り
 *   <body bytes>
 *   <CRLF><CRLF>                 ← record 終端
 *
 * parser は最初の `<CRLF><CRLF>` (header/body 区切り) を見つけ、
 * header block を `<CRLF>` で分割し、各行を `[name, value]` ペアと
 * して yield する。body は区切りから末尾の終端までの間にある bytes
 * (iterator の呼び出し側が必要なら終端を strip して `Content-Length`
 * バイトに揃えられる)。
 *
 * header の parse は意図的に緩く: 継続行は fold しない (我々が見た
 * WARC producer ではまれ)、header 名の大小は正規化しない (spec は
 * case-insensitive だがツール — 我々のも — は canonical な
 * mixed-case 表記に依存している)、`Key: Value` 形状なら空 value
 * も含めて何でも受け付ける。
 *
 * Payload-Digest 補助:
 *   - `warcinfo` / `metadata` record の digest は record body をそのまま
 *     対象にする。
 *   - `response` record の digest は HTTP *entity body* — つまり
 *     body の中で最初の `<CRLF><CRLF>` (HTTP header と HTTP payload
 *     を区切る) のあとの bytes — を対象にする。`httpEntityBody`
 *     がそのスライスを抜き出す。
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
 * raw (展開済み) bytes から単一の WARC record を parse する。一部が
 * malformed でも構造化された形を返す — 不完全さを違反とみなすかは
 * 呼び出し側の rule が決める。null を返すのは header/body 区切りが
 * 全く見つからない場合のみ。
 */
export const parseWarcRecord = (raw: Buffer): ParsedWarcRecord | null => {
  const sepIdx = raw.indexOf(HEADER_BODY_SEP);
  if (sepIdx === -1) return null;
  const headerBlock = raw.subarray(0, sepIdx);
  let body = raw.subarray(sepIdx + HEADER_BODY_SEP.byteLength);

  // producer は body の後に record 終端として `\r\n\r\n` を付ける。
  // 末尾にあれば正確にこの 4 バイトを strip し、返す body を
  // `Content-Length` ぴったりに揃える。
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

/** 補助: 大小無視の header lookup、後勝ち (HTTP semantics と一致)。 */
export const getHeader = (record: ParsedWarcRecord, name: string): string | undefined => {
  const lowered = name.toLowerCase();
  let value: string | undefined;
  for (const h of record.headers) {
    if (h.name.toLowerCase() === lowered) value = h.value;
  }
  return value;
};

/**
 * `response` record の HTTP entity body — `WARC-Payload-Digest` の
 * 計算対象になるバイト列 — を取り出す。record body は
 * `<HTTP ステータス行 + headers>\r\n\r\n<entity body>` の形をして
 * いるので、内側の最初の `\r\n\r\n` で slice する。区切りが無い
 * (malformed な HTTP block) 場合は `null` を返す。
 */
export const httpEntityBody = (record: ParsedWarcRecord): Buffer | null => {
  const sepIdx = record.body.indexOf(HEADER_BODY_SEP);
  if (sepIdx === -1) return null;
  return record.body.subarray(sepIdx + HEADER_BODY_SEP.byteLength);
};
