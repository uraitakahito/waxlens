/**
 * ZIP エントリの生バイトを「プレビュー用 {@link ReadEntryResult}」に変換する純ロジック。
 *
 * 方針: gzip(`.warc.gz` / `.cdx.gz` 等)は展開してから中身を見せ、テキストでない
 * バイトは文字化けさせずサイズだけ返す。実 WARC は「テキストの WARC/HTTP ヘッダ +
 * バイナリのボディ」の混在なので、最初の NUL の手前(=ヘッダ部)までをテキストとして
 * 見せ、その先はバイナリとして切る。展開は出力 cap byte で打ち切るので展開 bomb に強い。
 * I/O は持たず Buffer だけで完結するので hermetic にテストできる。
 */
import { createGunzip } from "node:zlib";
import type { ReadEntryResult } from "@waxlens/protocol";

/** NUL の手前にこれ未満しかテキストが無ければ、プレビューに値しない=バイナリ扱い。 */
const TEXT_MIN = 16;

/** 先頭 2 byte が gzip マジック(1f 8b)か。 */
export const isGzip = (b: Buffer): boolean => b.length >= 2 && b[0] === 0x1f && b[1] === 0x8b;

/**
 * head が UTF-8 テキストとして妥当か。cap 境界で割れた末尾のマルチバイト 1 文字は
 * 許容するため、末尾を最大 3 byte 落として strict デコードを試す。内部に不正バイトが
 * あれば(画像・圧縮データ等)false。
 */
const isTextUtf8 = (head: Buffer): boolean => {
  for (let drop = 0; drop <= 3 && drop <= head.length; drop++) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(head.subarray(0, head.length - drop));
      return true;
    } catch {
      // 末尾が不完全なマルチバイトかもしれないので 1 byte 削って再試行。
    }
  }
  return false;
};

/**
 * gzip を展開しつつ出力を cap byte で打ち切る(展開 bomb 対策)。
 * cap 到達で早期に stream を destroy する。壊れた gzip は reject。
 * WACZ の `.warc.gz` は record 単位 gzip を連結した multi-member が多いが、
 * createGunzip は連結メンバを順に展開でき、cap で先頭から切るので有用な preview になる。
 */
export const gunzipCapped = (
  input: Buffer,
  cap: number,
): Promise<{ data: Buffer; truncated: boolean }> =>
  new Promise((resolve, reject) => {
    const gunzip = createGunzip();
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    const finish = (truncated: boolean): void => {
      if (done) return;
      done = true;
      resolve({ data: Buffer.concat(chunks).subarray(0, cap), truncated });
    };
    gunzip.on("data", (c: Buffer) => {
      chunks.push(c);
      total += c.length;
      if (total >= cap) {
        gunzip.destroy();
        finish(true);
      }
    });
    gunzip.on("end", () => {
      finish(false);
    });
    gunzip.on("error", reject);
    gunzip.end(input);
  });

/** 拡張子で内容を整形する(.json は pretty-print)。 */
const formatBody = (path: string, text: string): string => {
  if (path.endsWith(".json")) {
    try {
      return JSON.stringify(JSON.parse(text) as unknown, null, 2);
    } catch {
      return text;
    }
  }
  return text;
};

/**
 * 生バイトを {@link ReadEntryResult} にする。gzip は展開し、最初の NUL の手前を
 * テキストプレビューとして見せる(WARC/HTTP ヘッダ等)。テキスト部が無い/不正なら
 * binary としてサイズだけ返す。byteLength は常に元(圧縮)エントリのサイズ。
 */
export const previewEntry = async (
  path: string,
  buf: Buffer,
  cap: number,
): Promise<ReadEntryResult> => {
  let data = buf;
  let gunzipped = false;
  let gzipTruncated = false;
  if (isGzip(buf)) {
    try {
      const r = await gunzipCapped(buf, cap);
      data = r.data;
      gzipTruncated = r.truncated;
      gunzipped = true;
    } catch {
      // 壊れた gzip → 生バイトのまま下の判定に落とす(クラッシュさせない)。
    }
  }
  // テキストは NUL を含まない。最初の NUL より先(画像・圧縮ボディ等)は切り、手前を見せる。
  const nul = data.indexOf(0);
  const region = nul === -1 ? data : data.subarray(0, nul);
  const head = region.subarray(0, cap);
  if ((nul !== -1 && region.length < TEXT_MIN) || !isTextUtf8(head)) {
    return { kind: "binary", byteLength: buf.length };
  }
  const truncated = gzipTruncated || nul !== -1 || region.length > cap;
  return { kind: "text", content: formatBody(path, head.toString("utf-8")), truncated, gunzipped };
};
