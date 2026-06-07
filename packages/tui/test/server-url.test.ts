/**
 * ServerEndpoint.parse(--server の値オブジェクト生成)の単体テスト。
 *
 * 純粋関数なので daemon も WACZ も不要。ws:// / wss:// + host を持つ URL だけを
 * 受理して ServerEndpoint を返し、それ以外は commander の InvalidArgumentError で
 * 弾くことを網羅する。private constructor の封じ込めはコンパイル時の保証(tsc)。
 */
import { InvalidArgumentError } from "commander";
import { describe, expect, it } from "vitest";
import { ServerEndpoint } from "../src/server-url.js";

describe("ServerEndpoint.parse", () => {
  it.each(["ws://127.0.0.1:7333", "ws://localhost", "wss://example.test:443"])(
    "accepts %s",
    (input) => {
      const ep = ServerEndpoint.parse(input);
      expect(ep).toBeInstanceOf(ServerEndpoint);
      expect(ep.url.protocol).toMatch(/^wss?:$/);
    },
  );

  it.each([
    ["foo", "URL として解釈できない"],
    ["", "空文字"],
    ["127.0.0.1:7333", "scheme が無い → new URL が throw"],
    ["http://127.0.0.1:7333", "scheme が ws/wss でない"],
    ["ws://", "special scheme で host 空 → new URL が throw"],
  ])("rejects %s (%s)", (input) => {
    expect(() => ServerEndpoint.parse(input)).toThrow(InvalidArgumentError);
  });
});
