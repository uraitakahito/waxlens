/**
 * WaczTransport
 *
 * 「WACZ の `ZipFile` をどう得るか」を表す値。 transport ごとに名前付き
 * factory (`fileTransport` / `s3Transport`) で生成する。
 * `WaczReader.open(transport)` はこの `openZip()` を呼ぶだけで、
 * transport の種別を知らない — 多態は transport 値が担う。
 *
 * 新しい transport (gs:// / http range / in-memory 等) を足すときは
 * ここに factory を 1 つ追加するだけで済み、`reader.ts` / `open` は不変。
 *
 * 依存の向き: この module は `WaczReader` を import しない (factory は
 * `ZipFile` を返すだけ)。`reader.ts` 側が `import type { WaczTransport }`
 * で型のみ参照するので、runtime の循環参照は発生しない。
 */
import { fromReader, open as yauzlOpen, type ZipFile } from "yauzl-promise";
import { HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import {
  s3UriToBucketKey,
  type AbsolutePath,
  type ReportSource,
  type S3Uri,
} from "../validate/domain.js";
import { S3RangeReader } from "./s3-range-reader.js";

export interface WaczTransport {
  /** この transport が開く WACZ の identity。`WaczReader.source` になる。 */
  readonly source: ReportSource;
  /** transport 固有の方法で yauzl の `ZipFile` を開く。 */
  openZip(): Promise<ZipFile>;
}

/** file transport — 絶対パスを yauzl でそのまま開く。 */
export const fileTransport = (path: AbsolutePath): WaczTransport => ({
  source: { kind: "file", path },
  openZip: () => yauzlOpen(path),
});

/**
 * s3 transport — `HeadObjectCommand` で `ContentLength` を 1 回先に取得し、
 * `S3RangeReader` 経由で `fromReader` に渡す (yauzl-promise の `fromReader`
 * は total size 必須なので、S3 側に明示的に問い合わせる手順)。
 * `client` は呼び出し側が構築して渡す — 必須引数で、default fallback は
 * 持たない (env / CLI flag からの forcePathStyle 解決は cli.ts の責務)。
 */
export const s3Transport = (uri: S3Uri, client: S3Client): WaczTransport => ({
  source: { kind: "s3", uri },
  openZip: async () => {
    const { bucket, key } = s3UriToBucketKey(uri);
    const head = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    const size = head.ContentLength;
    if (size === undefined) {
      throw new Error(`S3 HeadObject returned no ContentLength for ${uri}`);
    }
    const rangeReader = new S3RangeReader(client, bucket, key);
    return fromReader(rangeReader, size);
  },
});
