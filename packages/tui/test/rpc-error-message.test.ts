// @module-tag tui
/**
 * daemon が整形した説明を、tui が**もう一度飾らない**ことの検査。
 *
 * `RpcCallError` は `this.name = "RpcCallError"` を立てるので、これを
 * `describeCause` に通すと name が前に付いて
 * `RpcCallError: NotFound (HTTP 404)` になる。整形の責務は wire に載せる側
 * (daemon) にあり、受け手は運ばれてきた文をそのまま出す — その境界を固定する。
 *
 * 非対話の shell では tui 本体が早期終了して daemon まで到達しないため、
 * この経路は手動では踏めない。ここでしか守れない。
 */
import { describe, expect, it } from "vitest";
import { describeCause } from "@waxlens/protocol";
import { RpcCallError } from "../src/daemon-client.js";

describe("wire で運ばれた説明の扱い", () => {
  const wireMessage = "NotFound (HTTP 404)";
  const fromDaemon = new RpcCallError({ code: "openFailed", message: wireMessage });

  it("RpcCallError の message は daemon が作った説明そのもの", () => {
    expect(fromDaemon.message).toBe(wireMessage);
  });

  it("describeCause に通すと二重に飾られる(だから通してはいけない)", () => {
    // この期待値が「望ましい出力」なのではない。**避けるべき出力**を書き留めて
    // いる。`describeCause` の汎用名リストに "RpcCallError" を足すなどして
    // ここが変わったら、tui 側の分岐も見直すこと。
    expect(describeCause(fromDaemon)).toBe(`RpcCallError: ${wireMessage}`);
  });

  it("daemon 由来でない cause は describeCause で整形される", () => {
    const local = Object.assign(new Error("UnknownError"), {
      name: "NotFound",
      $metadata: { httpStatusCode: 404 },
    });
    expect(describeCause(local)).toBe("NotFound (HTTP 404)");
  });
});
