/**
 * WaczTransport
 *
 * 「WACZ の `ZipFile` をどう得るか」を表す値。 transport ごとに名前付き
 * factory (`fileTransport` / `s3Transport`) で生成する。
 * `WaczReader.open(transport)` はこの `openZip()` を呼ぶだけで、
 * transport の種別を知らない — 多態は transport 値が担う。
 *
 * 依存の向き: この module は `WaczReader` を import しない (factory は
 * `ZipFile` を返すだけ)。`reader.ts` 側が `import type { WaczTransport }`
 * で型のみ参照するので、runtime の循環参照は発生しない。
 */
import { fromReader, open as yauzlOpen, type ZipFile } from "yauzl-promise";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import {
  s3UriToBucketKey,
  type AbsolutePath,
  type ReportSource,
  type S3Source,
} from "../validate/domain.js";
import { S3RangeReader } from "./s3-range-reader.js";
import { buildS3Client } from "./s3-client-factory.js";

export interface WaczTransport {
  /** この transport が開く WACZ の identity。`WaczReader.source` になる。 */
  readonly source: ReportSource;
  /** transport 固有の方法で yauzl の `ZipFile` を開く。 */
  openZip(): Promise<ZipFile>;
}

/**
 * identity ({@link S3Source}) に接続設定 `forcePathStyle` を足した、open
 * に使う「解決済み」 source。 runtime 専用で、 wire format (`Report.source`)
 * には出さない (`s3Transport` が identity に剥がす)。 forcePathStyle の
 * env / CLI flag 解決は cli.ts の責務で、 ここには resolved な boolean が届く。
 */
export interface ResolvedS3Source extends S3Source {
  /** path-style addressing を強制するか (bundled SeaweedFS / MinIO 等)。 */
  forcePathStyle: boolean;
}

/** file transport — 絶対パスを yauzl でそのまま開く。 */
export const fileTransport = (path: AbsolutePath): WaczTransport => ({
  source: { kind: "file", path },
  openZip: () => yauzlOpen(path),
});

/**
 * s3 transport — `forcePathStyle` から `S3Client` を構築し、
 * `HeadObjectCommand` で `ContentLength` を 1 回先に取得して
 * `S3RangeReader` 経由で `fromReader` に渡す (yauzl-promise の `fromReader`
 * は total size 必須なので、S3 側に明示的に問い合わせる手順)。
 *
 * `source` は `forcePathStyle` 付きの {@link ResolvedS3Source} を受け取るが、
 * `WaczTransport.source` (= `WaczReader.source` / `Report.source`) には
 * identity (`{ kind, uri }`) だけを載せる。 `source` を spread すると
 * `forcePathStyle` が wire (JSON report) に漏れるので、明示的に剥がす。
 */
export const s3Transport = (source: ResolvedS3Source): WaczTransport => ({
  source: { kind: "s3", uri: source.uri },
  openZip: async () => {
    const client = buildS3Client(source.forcePathStyle);
    const { bucket, key } = s3UriToBucketKey(source.uri);
    const head = await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    const size = head.ContentLength;
    if (size === undefined) {
      throw new Error(`S3 HeadObject returned no ContentLength for ${source.uri}`);
    }
    const rangeReader = new S3RangeReader(client, bucket, key);
    return fromReader(rangeReader, size);
  },
});
