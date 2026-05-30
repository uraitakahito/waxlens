/**
 * `validate/types.ts` の brand 型 / parser 群のテスト。
 *
 * 既存 brand 型 (`parseAbsolutePath` / `parseS3Uri`) は他テストで間接的に
 * 経由していたが、 集約 helper である `parseReportSource` の追加に
 * 合わせて、 transport 判定の正/誤入力 4 パターンを直接覆う。 戻り値は
 * `Result<ReportSource, ParseSourceError>` なので、 ok / err の両方
 * を assertion でカバーする。
 */
import { describe, expect, it } from "vitest";
import { parseReportSource } from "../src/validate/types.js";

describe("parseReportSource", () => {
  it("absolute file path → ok({ kind: 'file', path はそのまま })", () => {
    const r = parseReportSource("/tmp/example.wacz");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({ kind: "file", path: "/tmp/example.wacz" });
    }
  });

  it("relative file path → ok({ kind: 'file', absolute に canonicalise })", () => {
    const r = parseReportSource("./example.wacz");
    expect(r.ok).toBe(true);
    if (r.ok && r.value.kind === "file") {
      expect(r.value.path.startsWith("/")).toBe(true);
      expect(r.value.path.endsWith("/example.wacz")).toBe(true);
    }
  });

  it("s3:// URI → ok({ kind: 's3', URI は brand 型に通る })", () => {
    const r = parseReportSource("s3://bucket/path/to/file.wacz");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({
        kind: "s3",
        uri: "s3://bucket/path/to/file.wacz",
      });
    }
  });

  it("malformed s3:// (key が無い) → err({ kind: 'invalid-s3-uri' })", () => {
    const r = parseReportSource("s3://bucket-only");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("invalid-s3-uri");
      expect(r.error.raw).toBe("s3://bucket-only");
    }
  });
});
