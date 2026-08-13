// @module-tag cli
/**
 * `describeCause` の要は「**直すべき 2 つだけを直し、残りは 1 文字も動かさない**」
 * ことなので、テストも「不変であるべきもの」と「改善されるべきもの」を並べて書く。
 * 不変側が動いたら、それは改善ではなく退行。
 */
import { describe, expect, it } from "vitest";
import { describeCause } from "../src/describe-cause.js";

/** AWS SDK が投げるものと同じ形を、SDK に依存せず組み立てる。 */
const sdkError = (name: string, message: string, httpStatusCode: number): Error =>
  Object.assign(new Error(message), { name, $metadata: { httpStatusCode } });

describe("describeCause", () => {
  describe("情報が足りている失敗は素通しする", () => {
    // ここが動いたら退行。fs も socket も message にすべて書いてある。
    const unchanged: [string, Error, string][] = [
      [
        "fs ENOENT",
        Object.assign(new Error("ENOENT: no such file or directory, open '/nope.wacz'"), {
          code: "ENOENT",
        }),
        "ENOENT: no such file or directory, open '/nope.wacz'",
      ],
      [
        "接続拒否",
        Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8333"), { code: "ECONNREFUSED" }),
        "connect ECONNREFUSED 127.0.0.1:8333",
      ],
      ["素の Error", new Error("boom"), "boom"],
      ["TypeError", new TypeError("x is not a function"), "x is not a function"],
    ];

    for (const [label, error, expected] of unchanged) {
      it(label, () => {
        expect(describeCause(error)).toBe(expected);
      });
    }
  });

  describe("message が placeholder の失敗を救う", () => {
    it("S3 404 は name と status で言い直される", () => {
      expect(describeCause(sdkError("NotFound", "UnknownError", 404))).toBe("NotFound (HTTP 404)");
    });

    it("S3 403 は name も Unknown なので status が唯一の手がかり", () => {
      // これが 404 と同じ文字列になったら、利用者は「object が無い」と
      // 「資格情報が違う」を区別できない。
      expect(describeCause(sdkError("Unknown", "UnknownError", 403))).toBe("Unknown (HTTP 403)");
    });

    it("message が生きていれば name・status と併記する", () => {
      expect(describeCause(sdkError("NoSuchBucket", "The bucket does not exist", 404))).toBe(
        "NoSuchBucket: The bucket does not exist (HTTP 404)",
      );
    });
  });

  describe("端の入力", () => {
    it("Error でなければそのまま文字列化する", () => {
      expect(describeCause("plain string")).toBe("plain string");
      expect(describeCause(null)).toBe("null");
      expect(describeCause(undefined)).toBe("undefined");
      expect(describeCause(42)).toBe("42");
    });

    it("$metadata が壊れていても落ちない", () => {
      const broken = Object.assign(new Error("boom"), { $metadata: "not an object" });
      expect(describeCause(broken)).toBe("boom");
      const noCode = Object.assign(new Error("boom"), { $metadata: {} });
      expect(describeCause(noCode)).toBe("boom");
    });

    it("何も残らない場合でも空文字を返さない", () => {
      // 呼び手は `cannot open "x": ${describeCause(e)}` と繋ぐので、空文字だと
      // 行が尻切れになる。
      expect(describeCause(new Error(""))).toBe("");
      expect(describeCause(Object.assign(new Error("UnknownError"), { name: "Error" }))).toBe(
        "UnknownError",
      );
    });

    it("status だけあれば status だけ出す", () => {
      const statusOnly = Object.assign(new Error("UnknownError"), {
        name: "Error",
        $metadata: { httpStatusCode: 500 },
      });
      expect(describeCause(statusOnly)).toBe("(HTTP 500)");
    });
  });
});
