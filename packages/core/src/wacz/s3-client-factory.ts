/**
 * S3Client を env から構築する。
 *
 * 用途: bundled SeaweedFS のような非 AWS な S3 互換 endpoint を CLI
 * から触るときに、`forcePathStyle: true` を選択させる手段が要る。
 * SDK は credentials / region / endpoint (`AWS_*` 系) を env から自動
 * 解決するので、waxlens 固有の env として残るのは path-style 切替の
 * 1 つだけ。
 *
 * 解決順:
 *   1. SDK 標準 env (`AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`,
 *      `AWS_SECRET_ACCESS_KEY`) — SDK の default chain がそのまま読む
 *   2. `WAXLENS_S3_FORCE_PATH_STYLE` — `"true"` のときだけ
 *      `forcePathStyle: true` を立てる。bundled SeaweedFS / MinIO 用 opt-in。
 */
import { S3Client } from "@aws-sdk/client-s3";

export const buildS3ClientFromEnv = (): S3Client => {
  const forcePathStyle = process.env["WAXLENS_S3_FORCE_PATH_STYLE"] === "true";
  return new S3Client({ forcePathStyle });
};
