/**
 * WARC.gz 用の independent-gzip-member iterator。
 *
 * WARC spec に従って生成された `.warc.gz` は *independent* な gzip
 * member の連結である (record 1 つにつき 1 member)。これにより CDXJ
 * index の offset/length ペアを使って、ファイルの残りを parse せず
 * 単一 record まで seek して展開できる。(WARC 1.1 §A.1。参考実装
 * として browserhive の `src/storage/warc/writer.ts:1-15` がこの
 * コントラクトを実装している。) この不変条件が成り立つかは
 * `warc/members-independent` rule が検証する。
 *
 * 検出戦略: 各 gzip member は magic bytes `0x1f 0x8b` で始まる。
 * Buffer を scan してこのマーカーを集めて slice し、各 slice に
 * `gunzipSync` をかける。境界が実際に正しいかは gunzipSync が
 * 検証する (slice が member の途中から始まっていれば throw する)。
 * magic bytes が偶然 compressed payload 内に現れることもあるが、
 * 不正なマッチは後続の `gunzipSync` で落ちる — つまり "有効な連結"
 * の check は「すべての slice がきれいに展開できる」と言い換えられる。
 *
 * iterator は `WarcMember { offset, length, gzipped, raw }` を yield
 * するので、downstream の rule は CDXJ offset をクロスチェックしたり、
 * `raw` から WARC header を parse したりできる。M1 では CDXJ 境界
 * rule のために `offset` / `length` だけを使い (これも実装は M3 まで
 * 遅れる)、iterator 自体は reader 層を一度に完成させるためここに作る。
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
   * true のとき、`gunzipSync` の失敗を呑み込み、最初の不良 member で
   * iteration を停止する。この iterator を *使う* validation rule
   * は逆を求める — strict mode を要求し、throw を Issue に変換する。
   * (人向けにエラー context を出すなど) iteration ヘルパは loose
   * モードを使ってよい。
   *
   * Default: false (不良 member で throw)。
   */
  loose?: boolean;
}

/**
 * `bytes` 内の全 gzip member を iterate する。`opts.loose !== true`
 * のとき、malformed な member で throw する。関数は generator 風で
 * (Iterable を返す)、archive 全体を 2 回メモリに展開せず呼び出し側
 * が早期停止できる。
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
 * gzip member の開始になり *うる* byte offset をすべて見つける。
 * ナイーブな実装 — magic byte ペア `1f 8b` を scan して、すべての
 * マッチを受け入れる。偽陽性 (圧縮 payload 内に magic が出るケース)
 * は、後段の `gunzipSync` が悪い slice で fail することで filter
 * される。
 *
 * 偽陽性をさらに減らすため、offset+2 の compression method byte が
 * 0x08 (DEFLATE。Node の `gunzipSync` が受け入れる唯一の method)
 * であることも要求する。完璧ではないが、実運用では仕様準拠の
 * producer は well-formed な member だけを出すので、validator の
 * 仕事は「実際の producer バグを捕まえること」であって、敵対的入力
 * への堅牢性ではない。
 */
const findMemberStarts = (bytes: Buffer): number[] => {
  const starts: number[] = [];
  // ファイルが well-formed なら最初の member は常に offset 0 から
  // 始まる。`starts` を無条件に 0 で seed せず、scan に発見させる
  // ことで、offset 0 に magic が無い場合を "zero members" として
  // 報告できる。
  for (let i = 0; i + 2 < bytes.length; i++) {
    if (bytes[i] === GZIP_MAGIC_0 && bytes[i + 1] === GZIP_MAGIC_1 && bytes[i + 2] === 0x08) {
      starts.push(i);
    }
  }
  return starts;
};

export class WarcMemberDecodeError extends Error {
  override readonly name = "WarcMemberDecodeError";
  // `Error` 自身は optional な `cause` (ES2022) を持つ。`override`
  // を付けて narrow した (常に存在する) 型で再宣言することで、
  // throw 側が型付きアクセスを失わずに元の失敗を attach できる。
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
