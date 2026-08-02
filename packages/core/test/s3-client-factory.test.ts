// @module-tag remote
/**
 * `buildS3Client(forcePathStyle)` のユニット。 引数の boolean が
 * `S3Client.config.forcePathStyle` に乗ることを確認する。 SDK v3 の
 * `forcePathStyle` は **boolean か Provider 関数** のどちらかになりうる
 * union 型なので、 `typeof` で narrow してから await する。
 *
 * env (`WAXLENS_S3_FORCE_PATH_STYLE`) と CLI flag (`--s3-force-path-style`)
 * の merge は cli.ts 側 (commander の `Option.env()` + `argParser()`)
 * が行うので、 ここでは扱わない。 `buildS3Client` は受け取った boolean
 * を SDK に渡すだけの pure wrapper。
 */
import type { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { buildS3Client } from "../src/wacz/s3-client-factory.js";

const resolveForcePathStyle = async (client: S3Client): Promise<boolean | undefined> => {
  // SDK の型は `boolean | (false & Provider<...>) | (true & Provider<...>)` という
  // intersection を含む union で、`typeof` narrowing が効かない (intersection
  // 側が `never` に潰れて call signature を失う)。test では値を取り出せれば十分
  // なので、boolean | Provider の 2-way union に明示 cast する。
  const fps = client.config.forcePathStyle as boolean | (() => Promise<boolean | undefined>);
  return typeof fps === "function" ? await fps() : fps;
};

describe("buildS3Client", () => {
  it("forcePathStyle is false when passed false", async () => {
    const client = buildS3Client(false);
    expect(await resolveForcePathStyle(client)).toBe(false);
  });

  it("forcePathStyle is true when passed true", async () => {
    const client = buildS3Client(true);
    expect(await resolveForcePathStyle(client)).toBe(true);
  });
});
