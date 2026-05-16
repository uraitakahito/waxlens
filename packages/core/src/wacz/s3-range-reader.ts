/**
 * S3RangeReader
 *
 * yauzl-promise の `Reader` を実装し、S3 object を range GET で読む。
 * `WaczReader.openFromS3` がこの reader を `yauzl.fromReader` に渡す
 * ことで、S3 上の WACZ を local file と同じように parse できる。
 *
 * Memory 効率: yauzl が必要とする部分 (EOCD / Central Directory /
 * 各 entry の local header + data) だけを GET するので、WACZ 全体を
 * 一度に download する必要は無い。validation rule が全 entry を
 * 読む場合は結局 WACZ 全体ぶんの byte を GET するが、それでも単一
 * buffer に全部載せる必要は無い。
 *
 * yauzl-promise の Reader contract:
 *   - `_read(start, length)` を override すれば `read()` の path が使う
 *   - `_createReadStream(start, length)` は `openReadStream()` の path
 *     が使う — 同期的に Readable を返す必要があるので、async な S3
 *     GET は `Readable.from(asyncGenerator)` で lazy 評価する
 *   - `_open()` / `_close()` は default の no-op で十分 (S3 client は
 *     呼び出し側が lifecycle を管理する)
 */
import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { Reader } from "yauzl-promise";

export class S3RangeReader extends Reader {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly key: string;

  constructor(client: S3Client, bucket: string, key: string) {
    super();
    this.client = client;
    this.bucket = bucket;
    this.key = key;
  }

  /**
   * yauzl の structural read (EOCD / CD / local header) と
   * `Reader.read()` 経由の任意 range 取得の両方で使われる経路。
   * S3 GetObject を Range header 付きで発行して Body を集約する。
   */
  override async _read(start: number, length: number): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.key,
        Range: `bytes=${String(start)}-${String(start + length - 1)}`,
      }),
    );
    const body = response.Body;
    if (!body) {
      throw new Error(
        `S3 GetObject returned no body for s3://${this.bucket}/${this.key} @ ${String(start)}-${String(start + length - 1)}`,
      );
    }
    const bytes = await body.transformToByteArray();
    return Buffer.from(bytes);
  }

  /**
   * yauzl が `openReadStream` 経由で entry body を読むときに使う。
   * `Readable.from(asyncGenerator)` を使うことで stream が consume
   * されるまで S3 GET は走らない。1 entry = 1 GetObject。
   */
  override _createReadStream(start: number, length: number): Readable {
    return Readable.from(this.streamForRange(start, length));
  }

  private async *streamForRange(
    start: number,
    length: number,
  ): AsyncGenerator<Buffer> {
    yield await this._read(start, length);
  }
}
