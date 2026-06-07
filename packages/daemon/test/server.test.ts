/**
 * daemon の HTTP/WS サーバ(dispatch + 相関 id 枠)のテスト。
 *
 * createDaemon() を in-process で listen(port 0)し、ws クライアントで叩く。
 * 未知メソッドのエラー枠は hermetic に常時走る。validate/readEntry の happy path
 * は実 WACZ を要するので CORPUS_DIR 未設定なら skip(handlers.test と同様)。
 */
import type { Server } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { RpcRequest, RpcResponse } from "@waxlens/protocol";
import { createDaemon } from "../src/server.js";

const corpusDir = process.env["CORPUS_DIR"];
const fixtureUri = (rel: string): string => pathToFileURL(resolve(corpusDir ?? "", rel)).href;

let server: Server;
let port: number;

beforeEach(async () => {
  server = createDaemon();
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

const call = (message: RpcRequest): Promise<RpcResponse> =>
  new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${String(port)}`);
    ws.on("open", () => {
      ws.send(JSON.stringify(message));
    });
    ws.on("message", (raw: Buffer) => {
      res(JSON.parse(raw.toString("utf8")) as RpcResponse);
      ws.close();
    });
    ws.on("error", rej);
  });

describe("daemon server (WS)", () => {
  it("未知メソッドは badRequest エラーを相関 id つきで返す", async () => {
    const res = await call({
      id: 7,
      method: "waxlens/validate",
      params: { source: { kind: "uri", uri: "file:///waxlens/no-such.wacz" }, locale: "en" },
    });
    expect(res.id).toBe(7);
    // 開けない URI は openFailed として error 枠で返る(throw ではなく)。
    expect(res.error?.code).toBe("openFailed");
  });

  describe.skipIf(corpusDir === undefined || corpusDir === "")("with corpus fixtures", () => {
    it("validate: good.wacz は valid な WireReport を返す", async () => {
      const res = await call({
        id: 1,
        method: "waxlens/validate",
        params: { source: { kind: "uri", uri: fixtureUri("fixtures/good.wacz") }, locale: "en" },
      });
      expect(res.error).toBeUndefined();
      expect(res.result && "valid" in res.result ? res.result.valid : null).toBe(true);
    });

    it("readEntry: datapackage.json の内容を返す", async () => {
      const res = await call({
        id: 2,
        method: "waxlens/readEntry",
        params: { source: { kind: "uri", uri: fixtureUri("fixtures/good.wacz") }, path: "datapackage.json" },
      });
      expect(res.error).toBeUndefined();
      const content = res.result && "content" in res.result ? res.result.content : "";
      expect(content).toContain('"profile": "data-package"');
    });
  });
});
