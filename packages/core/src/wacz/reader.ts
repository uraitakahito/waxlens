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
  s3UriToBucketKey,
  type ReportSource,
} from "../validate/types.js";
import { S3RangeReader } from "./s3-range-reader.js";

/**
 * `WaczReader.open` の任意 option。 s3 transport 時の `S3Client`
 * 注入のみが現状の用途。 file transport 時には無視される。
 */
export interface WaczOpenOptions {
  s3Client?: S3Client;
}

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
   * `source.kind` で dispatch する unified factory。
   *
   * - `kind: "file"` — `source.path` は `AbsolutePath` brand 済の
   *   絶対パス。`yauzl-promise` の `open` をそのまま使う。
   * - `kind: "s3"` — `HeadObjectCommand` で `ContentLength` を 1 回
   *   先に取得し、`S3RangeReader` 経由で `fromReader` に渡す
   *   (yauzl-promise の `fromReader` は total size 必須なので、
   *   S3 側に明示的に問い合わせる手順)。`options.s3Client` が無ければ
   *   default credential chain で構築する。
   *
   * raw な string (CLI argv 等) から開きたい場合は `parseReportSource`
   * で `ReportSource` を組み立ててから渡す。
   */
  static async open(
    source: ReportSource,
    options?: WaczOpenOptions,
  ): Promise<WaczReader> {
    if (source.kind === "file") {
      const zip = await openZip(source.path);
      return WaczReader.fromZipHandle(zip, source);
    }
    const c = options?.s3Client ?? new S3Client({});
    const { bucket, key } = s3UriToBucketKey(source.uri);
    const head = await c.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    const size = head.ContentLength;
    if (size === undefined) {
      throw new Error(`S3 HeadObject returned no ContentLength for ${source.uri}`);
    }
    const rangeReader = new S3RangeReader(c, bucket, key);
    const zip = await fromReader(rangeReader, size);
    return WaczReader.fromZipHandle(zip, source);
  }

  /**
   * 開いた `ZipFile` から entries map を作って `WaczReader` を組み立てる
   * 共通処理。file / s3 の 2 path どちらでも、 zip handle 取得まで終われば
   * あとは同じ手順 (zip の async iterator を 1 回 drain して filename →
   * Entry の Map にする) になるので、ここに集約する。
   */
  private static async fromZipHandle(
    zip: ZipFile,
    source: ReportSource,
  ): Promise<WaczReader> {
    const entries = new Map<string, Entry>();
    for await (const entry of zip) {
      entries.set(entry.filename, entry);
    }
    return new WaczReader(zip, entries, source);
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
