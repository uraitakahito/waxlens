// @module-tag daemon
/**
 * wire に載る `error.message` が、原因を説明していることの検査。
 *
 * ここが daemon の最上流 (`handlers.ts`)。捨てた情報は受け手 (tui) では
 * **復元できない** — 向こうに届くのは string だけだから。`code` だけを見る
 * テストでは、message が placeholder に退化しても気づけない。
 *
 * 難しいのは「placeholder が出る状況」を hermetic に作ること。
 * `"UnknownError"` は aws-sdk が **本文の無い応答** でエラーを組み立てるときに
 * 入れるもので、ローカルファイルの ENOENT では再現しない (fs のエラーは
 * message にすべて書いてあり、素通ししても同じ文字列になるので、テストが
 * 空回りする)。
 *
 * なので偽の S3 を立てる。HTTP 404 を **本文なし** で返すだけのサーバに
 * `HeadObject` を投げれば、実物と同じ形のエラーが SDK から出てくる。
 */
import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { RpcRequest, RpcResponse } from "@waxlens/protocol";
import { createDaemon } from "../src/server.js";

let fakeS3: Server;
let daemon: Server;
let daemonPort = 0;

const listen = (server: Server): Promise<number> =>
  new Promise((res) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      res(typeof addr === "object" && addr !== null ? addr.port : 0);
    });
  });

const close = (server: Server): Promise<void> =>
  new Promise((res) => {
    server.close(() => {
      res();
    });
  });

beforeAll(async () => {
  // 何を訊かれても「404・本文なし」で答える。S3 が存在しない key に対して
  // HEAD で返すのと同じ形。
  fakeS3 = createServer((_req, res) => {
    res.writeHead(404);
    res.end();
  });
  const port = await listen(fakeS3);

  vi.stubEnv("AWS_ENDPOINT_URL_S3", `http://127.0.0.1:${String(port)}`);
  vi.stubEnv("AWS_REGION", "us-east-1");
  vi.stubEnv("AWS_ACCESS_KEY_ID", "test");
  vi.stubEnv("AWS_SECRET_ACCESS_KEY", "test");
  // profile が居ると SDK は静的キーを無視して profile 側へ行ってしまうので、
  // 開発機の設定に結果が左右されないよう消しておく (undefined で削除)。
  vi.stubEnv("AWS_PROFILE", undefined);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await close(fakeS3);
});

beforeEach(async () => {
  daemon = createDaemon();
  daemonPort = await listen(daemon);
});

afterEach(async () => {
  await close(daemon);
});

const call = (message: RpcRequest): Promise<RpcResponse> =>
  new Promise((res, rej) => {
    const ws = new WebSocket(`ws://127.0.0.1:${String(daemonPort)}`);
    ws.on("open", () => {
      ws.send(JSON.stringify(message));
    });
    ws.on("message", (raw: Buffer) => {
      res(JSON.parse(raw.toString("utf8")) as RpcResponse);
      ws.close();
    });
    ws.on("error", rej);
  });

describe("openFailed の message", () => {
  it("本文の無い 404 でも HTTP status が wire に載る", async () => {
    const res = await call({
      id: 1,
      method: "waxlens/validate",
      params: {
        source: { kind: "uri", uri: "s3://bucket/missing.wacz" },
        locale: "en",
        s3ForcePathStyle: true,
      },
    });

    expect(res.error?.code).toBe("openFailed");
    // 素の `cause.message` を載せていた頃はここが "UnknownError" だった。
    expect(res.error?.message).not.toBe("UnknownError");
    expect(res.error?.message).toContain("404");
  });
});
