/**
 * WaczReader
 *
 * WACZ に合わせた accessor を提供する。
 *
 * reader は `close()` が呼ばれるまで zip handle を開きっぱなしにする
 * — rule runner はこれを `finally` で行うので、validation 失敗で fd
 * を漏らさない。
 *
 * `source` field は「この reader を開いた origin」を保持する。
 * `runValidation` は `Report.source` をここから取るので、caller は
 * runValidation に source を別途渡す必要がない (single source of truth)。
 */
import { resolve as resolvePath } from "node:path";
import {
  fromReader,
  open as openZip,
  type Entry,
  type ZipFile,
} from "yauzl-promise";
import {
  HeadObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  asAbsolutePath,
  s3UriToBucketKey,
  type ReportSource,
  type S3Uri,
} from "../validate/types.js";
import { S3RangeReader } from "./s3-range-reader.js";

/**
 * zip spec (PKWARE APPNOTE.TXT §4.4.5) の compression method 番号。
 * WACZ では今のところ STORE (無圧縮) と DEFLATE の 2 つしか登場しない。
 */
export const ZIP_COMPRESSION_STORE = 0;
export const ZIP_COMPRESSION_DEFLATE = 8;

export interface ZipEntryMeta {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
}

export class WaczReader {
  readonly source: ReportSource;
  private readonly zip: ZipFile;
  private readonly entries: Map<string, Entry>;

  private constructor(zip: ZipFile, entries: Map<string, Entry>, source: ReportSource) {
    this.zip = zip;
    this.entries = entries;
    this.source = source;
  }

  /**
   * ローカル file を開く。relative path も受け付け、`path.resolve()` で
   * 絶対パスに canonicalize してから `source` に乗せる。
   */
  static async open(path: string): Promise<WaczReader> {
    const absolute = asAbsolutePath(resolvePath(path));
    const zip = await openZip(absolute);
    const entries = new Map<string, Entry>();
    for await (const entry of zip) {
      entries.set(entry.filename, entry);
    }
    return new WaczReader(zip, entries, { kind: "file", path: absolute });
  }

  /**
   * S3 上の WACZ を range GET で開く。`client` が省略された場合は
   * default credential chain (env / shared config / IAM role) で
   * `S3Client` を構築する。Caller が region / endpoint / credential を
   * 細かく制御したい場合は事前に構築した `S3Client` を渡せばよい。
   *
   * `HeadObjectCommand` を 1 回先に発行して `ContentLength` を取る —
   * yauzl-promise の `fromReader` は total size を引数で要求するため、
   * S3 側に明示的に問い合わせる必要がある。
   */
  static async openFromS3(uri: S3Uri, client?: S3Client): Promise<WaczReader> {
    const c = client ?? new S3Client({});
    const { bucket, key } = s3UriToBucketKey(uri);
    const head = await c.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    const size = head.ContentLength;
    if (size === undefined) {
      throw new Error(`S3 HeadObject returned no ContentLength for ${uri}`);
    }
    const rangeReader = new S3RangeReader(c, bucket, key);
    const zip = await fromReader(rangeReader, size);
    const entries = new Map<string, Entry>();
    for await (const entry of zip) {
      entries.set(entry.filename, entry);
    }
    return new WaczReader(zip, entries, { kind: "s3", uri });
  }

  entryNames(): string[] {
    return Array.from(this.entries.keys());
  }

  hasEntry(name: string): boolean {
    return this.entries.has(name);
  }

  /**
   * payload を読まずに entry ごとの metadata を返す。entry が zip
   * にどう格納されているかだけを気にする rule が使う (例: rule #6 —
   * WARC は STORE であるべきで、内側の gzip を二重圧縮しないため)。
   */
  getEntryMeta(name: string): ZipEntryMeta | undefined {
    const entry = this.entries.get(name);
    if (!entry) return undefined;
    return {
      name: entry.filename,
      compressionMethod: entry.compressionMethod,
      compressedSize: entry.compressedSize,
      uncompressedSize: entry.uncompressedSize,
    };
  }

  /**
   * entry の uncompressed payload 全体を読む。実運用上 WACZ
   * archive は producer 側の上限で抑えられている (browserhive: 200 MB、
   * pywb / browsertrix-crawler: 設定可能だがほとんど数 GB 以下)
   * ので、entry 全体を Buffer に積むのが今は許容される — もし
   * multi-GB archive を検証する必要が出てきたら、stream + on-the-fly
   * hashing の複雑さを取りに行く価値が出てくる。
   */
  async readEntry(name: string): Promise<Buffer | undefined> {
    const entry = this.entries.get(name);
    if (!entry) return undefined;
    const stream = await entry.openReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks);
  }

  async close(): Promise<void> {
    await this.zip.close();
  }
}
