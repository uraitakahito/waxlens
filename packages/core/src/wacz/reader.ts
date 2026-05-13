/**
 * WaczReader
 *
 * `yauzl-promise` の薄いラッパで、WACZ に合わせた accessor を提供する:
 *   - `entryNames()` — zip entry path のリスト
 *   - `readEntry(name)` — entry の全 Buffer (eager)
 *   - `getEntryMeta(name)` — { compressionMethod, compressedSize, uncompressedSize }。
 *     例えば `archive/data.warc.gz` が STORE (method 0) であることを rule で
 *     assert できる
 *
 * yauzl-promise の裏側は callback ベースで、`.entries()` は async
 * iterator を返す。`open()` のタイミングで一度 iterate して name →
 * entry map を作る。実世界の WACZ archive は entry が数十個程度なので、
 * メモリコスト (1 entry につき 1 レコード) は無視できる範囲で、map
 * によって validation rule に O(1) lookup を提供できる。
 *
 * reader は `close()` が呼ばれるまで zip handle を開きっぱなしにする
 * — rule runner はこれを `finally` で行うので、validation 失敗で fd
 * を漏らさない。
 */
import { open as openZip, type Entry, type ZipFile } from "yauzl-promise";

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
  private readonly zip: ZipFile;
  private readonly entries: Map<string, Entry>;

  private constructor(zip: ZipFile, entries: Map<string, Entry>) {
    this.zip = zip;
    this.entries = entries;
  }

  static async open(path: string): Promise<WaczReader> {
    const zip = await openZip(path);
    const entries = new Map<string, Entry>();
    for await (const entry of zip) {
      // yauzl の Entry は `filename` (zip 内パス) を公開する。
      // ディレクトリ entry は `/` で終わる。気にする呼び出し側のために
      // map に入れたままにするが、M1 の rule は file entry しか見ない。
      entries.set(entry.filename, entry);
    }
    return new WaczReader(zip, entries);
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
      compressedSize: Number(entry.compressedSize),
      uncompressedSize: Number(entry.uncompressedSize),
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
