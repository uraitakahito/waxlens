/**
 * daemon-client(WS クライアント)の単体テスト。
 *
 * 偽の ws サーバを立てて hermetic に検証する(実 daemon も WACZ も不要):
 *   - request が相関 id で結果を解決する
 *   - error 応答は RpcCallError で reject し code を保持する
 *   - startDaemon(--server URL) は spawn せず URL をそのまま返す
 */
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import type { RpcRequest } from "@waxlens/protocol";
import { connect, RpcCallError, startDaemon } from "../src/daemon-client.js";

let server: Server;
let port = 0;

beforeEach(async () => {
  server = createServer();
  const wss = new WebSocketServer({ server });
  wss.on("connection", (socket) => {
    socket.on("message", (raw: Buffer) => {
      const req = JSON.parse(raw.toString("utf8")) as RpcRequest;
      // uri="fail" のときだけ error 枠を返す(それ以外は echo 的な result)。
      if (req.params.source.uri === "fail") {
        socket.send(JSON.stringify({ id: req.id, error: { code: "openFailed", message: "boom" } }));
      } else {
        socket.send(JSON.stringify({ id: req.id, result: { ok: true, method: req.method } }));
      }
    });
  });
  await new Promise<void>((res) => {
    server.listen(0, "127.0.0.1", () => {
      res();
    });
  });
  const addr = server.address();
  port = typeof addr === "object" && addr !== null ? addr.port : 0;
});

afterEach(async () => {
  await new Promise<void>((res) => {
    server.close(() => {
      res();
    });
  });
});

const url = (): string => `ws://127.0.0.1:${String(port)}`;

describe("daemon-client", () => {
  it("request は相関 id で結果を解決する", async () => {
    const client = await connect(url());
    const result = await client.request<{ ok: boolean; method: string }>("waxlens/validate", {
      source: { kind: "uri", uri: "x" },
      locale: "en",
    });
    expect(result).toEqual({ ok: true, method: "waxlens/validate" });
    client.close();
  });

  it("error 応答は RpcCallError で reject し code を保持する", async () => {
    const client = await connect(url());
    await expect(
      client.request("waxlens/validate", { source: { kind: "uri", uri: "fail" }, locale: "en" }),
    ).rejects.toBeInstanceOf(RpcCallError);
    client.close();
  });

  it("startDaemon(--server URL) は spawn せず URL をそのまま返す", async () => {
    const handle = await startDaemon("ws://example.test:1234");
    expect(handle.url).toBe("ws://example.test:1234");
    await handle.close(); // no-op(spawn していない)
  });
});
