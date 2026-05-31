/**
 * S3Client を所与の `forcePathStyle` で構築する thin wrapper。
 *
 * 用途: bundled SeaweedFS のような非 AWS な S3 互換 endpoint を CLI
 * から触るときに、`forcePathStyle: true` を選択させる手段が要る。
 * SDK は credentials / region / endpoint (`AWS_*` 系) を env から自動
 * 解決するので、waxlens 固有の設定として残るのは path-style 切替の
 * 1 つだけ。
 *
 * env (`WAXLENS_S3_FORCE_PATH_STYLE`) と CLI flag (`--s3-force-path-style`)
 * の merge は呼び出し側 (cli.ts の commander Option 定義) が行う:
 *
 *     new Option("--s3-force-path-style", "...")
 *       .env("WAXLENS_S3_FORCE_PATH_STYLE")
 *       .argParser((v) => v === true || v === "true")
 *       .default(false);
 *
 * これにより `buildS3Client` は env を知らない pure な wrapper として
 * 保たれ、 tui 側も @waxlens/core 経由で `@aws-sdk/client-s3` を直接
 * 依存せずに S3Client を作れる。
 */
import { S3Client } from "@aws-sdk/client-s3";

export const buildS3Client = (forcePathStyle: boolean): S3Client =>
  new S3Client({ forcePathStyle });
