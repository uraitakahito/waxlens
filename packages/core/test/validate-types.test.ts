/**
 * `validate/types.ts` の brand 型 / parser 群のテスト。
 *
 * 既存 brand 型 (`parseAbsolutePath` / `parseS3Uri`) は他テストで間接的に
 * 経由していたが、 集約 helper である `parseReportSource` の追加に
 * 合わせて、 transport 判定の正/誤入力 4 パターンを直接覆う。
 */
import { describe, expect, it } from "vitest";
import { parseReportSource } from "../src/validate/types.js";

describe("parseReportSource", () => {
  it("absolute file path → kind: 'file' (path はそのまま)", () => {
    const r = parseReportSource("/tmp/example.wacz");
    expect(r).toEqual({ kind: "file", path: "/tmp/example.wacz" });
  });

  it("relative file path → kind: 'file' (absolute に canonicalise される)", () => {
    const r = parseReportSource("./example.wacz");
    expect(r.kind).toBe("file");
    if (r.kind === "file") {
      expect(r.path.startsWith("/")).toBe(true);
      expect(r.path.endsWith("/example.wacz")).toBe(true);
    }
  });

  it("s3:// URI → kind: 's3' (URI は brand 型に通る)", () => {
    const r = parseReportSource("s3://bucket/path/to/file.wacz");
    expect(r).toEqual({
      kind: "s3",
      uri: "s3://bucket/path/to/file.wacz",
    });
  });

  it("malformed s3:// (key が無い) → TypeError", () => {
    expect(() => parseReportSource("s3://bucket-only")).toThrow(TypeError);
  });
});
