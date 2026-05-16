/**
 * `buildS3ClientFromEnv` のユニット。env が立っている / 立っていない
 * の 2 ケースを直接観測する。SDK v3 の `S3Client.config.forcePathStyle`
 * は **boolean か Provider 関数** のどちらかになりうる union 型なので、
 * `typeof` で narrow してから await する。
 */
import type { S3Client } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildS3ClientFromEnv } from "../src/wacz/s3-client-factory.js";

const resolveForcePathStyle = async (client: S3Client): Promise<boolean | undefined> => {
  // SDK の型は `boolean | (false & Provider<...>) | (true & Provider<...>)` という
  // intersection を含む union で、`typeof` narrowing が効かない (intersection
  // 側が `never` に潰れて call signature を失う)。test では値を取り出せれば十分
  // なので、boolean | Provider の 2-way union に明示 cast する。
  const fps = client.config.forcePathStyle as boolean | (() => Promise<boolean | undefined>);
  return typeof fps === "function" ? await fps() : fps;
};

describe("buildS3ClientFromEnv", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env["WAXLENS_S3_FORCE_PATH_STYLE"];
    delete process.env["WAXLENS_S3_FORCE_PATH_STYLE"];
  });
  afterEach(() => {
    if (original === undefined) delete process.env["WAXLENS_S3_FORCE_PATH_STYLE"];
    else process.env["WAXLENS_S3_FORCE_PATH_STYLE"] = original;
  });

  it("forcePathStyle is false by default", async () => {
    const client = buildS3ClientFromEnv();
    expect(await resolveForcePathStyle(client)).toBe(false);
  });

  it("forcePathStyle is true when WAXLENS_S3_FORCE_PATH_STYLE=true", async () => {
    process.env["WAXLENS_S3_FORCE_PATH_STYLE"] = "true";
    const client = buildS3ClientFromEnv();
    expect(await resolveForcePathStyle(client)).toBe(true);
  });

  it("only the exact string 'true' enables forcePathStyle", async () => {
    for (const v of ["1", "yes", "True", "TRUE", "", "false"]) {
      process.env["WAXLENS_S3_FORCE_PATH_STYLE"] = v;
      const client = buildS3ClientFromEnv();
      expect(await resolveForcePathStyle(client), `value=${JSON.stringify(v)}`).toBe(false);
    }
  });
});
