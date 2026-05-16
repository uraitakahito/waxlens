/**
 * `WaczReader.openFromS3` の end-to-end テスト。
 *
 * aws-sdk-client-mock で S3 を mock し、`buildWacz()` で生成した完全
 * な WACZ buffer を kosher な S3 object として serve する。
 *
 * 目的:
 *   1. `HeadObjectCommand` → `GetObjectCommand` の orchestration が
 *      正しく走ること
 *   2. `S3RangeReader._read(start, length)` が yauzl の指定通りの
 *      range を要求し、Range header の文字列フォーマットが正しいこと
 *   3. `Report.source` が `{ kind: "s3", uri }` で wire format に
 *      乗ること
 *   4. 同じ fixture を local で開いたときと等価な validation 結果
 *      (`valid: true`) を生むこと
 *
 * 実 S3 への credential なしで動作確認できる範囲のテスト — 実 S3
 * での挙動 (network failure / partial response / 認証) は CI の外で
 * 手動確認する。
 */
import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { runValidation } from "../src/validate/engine.js";
import { DEFAULT_RULES } from "../src/validate/rules/index.js";
import { parseS3Uri } from "../src/validate/types.js";
import { WaczReader } from "../src/wacz/reader.js";
import { buildWacz } from "./fixtures/generator.js";

const s3Mock = mockClient(S3Client);

const RANGE_RE = /^bytes=(\d+)-(\d+)$/;

describe("WaczReader.openFromS3", () => {
  beforeEach(() => {
    s3Mock.reset();
  });

  it("range-reads a valid WACZ from a mocked S3 bucket", async () => {
    const { bytes } = await buildWacz();

    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: bytes.length });
    s3Mock.on(GetObjectCommand).callsFake((input: { Range?: string }) => {
      const m = RANGE_RE.exec(input.Range ?? "");
      if (!m?.[1] || !m[2]) {
        throw new Error(`unexpected Range header: ${input.Range ?? "(none)"}`);
      }
      const start = Number(m[1]);
      const end = Number(m[2]);
      const slice = bytes.subarray(start, end + 1);
      // SdkStream body の代替 — `transformToByteArray()` のみを持つ
      // 最小 mock で十分 (S3RangeReader._read はこの関数しか呼ばない)。
      // `callsFake` の返り型は Partial 許容なので、cast は不要。
      return {
        Body: {
          transformToByteArray: () => Promise.resolve(new Uint8Array(slice)),
        },
      };
    });

    const uri = parseS3Uri("s3://test-bucket/fixture.wacz");
    const client = new S3Client({ region: "us-east-1" });
    const reader = await WaczReader.openFromS3(uri, client);
    try {
      expect(reader.source).toEqual({ kind: "s3", uri });

      const result = await runValidation(reader, {
        waxlensVersion: "0.0.0",
        rules: DEFAULT_RULES,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.source).toEqual({ kind: "s3", uri });
      expect(result.value.valid).toBe(true);
      expect(result.value.summary.failed).toBe(0);
    } finally {
      await reader.close();
    }

    // 少なくとも 1 回は HEAD と GET が走ったことを確認 — 詳細な call
    // count は yauzl の internal で振れるため固定値で assert しない。
    expect(s3Mock.commandCalls(HeadObjectCommand).length).toBe(1);
    expect(s3Mock.commandCalls(GetObjectCommand).length).toBeGreaterThan(0);
  });

  it("throws TypeError on malformed S3 URI before any network call", () => {
    expect(() => parseS3Uri("not-an-s3-uri")).toThrow(TypeError);
    expect(s3Mock.calls().length).toBe(0);
  });

  it("propagates the error when S3 HeadObject lacks ContentLength", async () => {
    s3Mock.on(HeadObjectCommand).resolves({});  // ContentLength なし
    const uri = parseS3Uri("s3://test-bucket/bad.wacz");
    const client = new S3Client({ region: "us-east-1" });
    await expect(WaczReader.openFromS3(uri, client)).rejects.toThrow(
      /no ContentLength/,
    );
  });
});
