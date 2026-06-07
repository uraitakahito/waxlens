/**
 * daemon クライアント — daemon を spawn(or `--server` に接続)し、
 * WS で相関 id つき request/response を行う薄い層。
 *
 * tui はここを通して core(validation)を間接的に使う(直接 import しない)。
 * spawn した daemon は ephemeral で、validate を終えたら `close()` で kill する。
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { WebSocket, type RawData } from "ws";
import type {
  ReadEntryParams,
  RpcError,
  RpcMethod,
  RpcRequest,
  RpcResponse,
  ValidateParams,
} from "@waxlens/protocol";
import { ServerEndpoint } from "./server-url.js";

/** daemon が RpcError を返したときに reject する型つきエラー。 */
export class RpcCallError extends Error {
  readonly code: RpcError["code"];
  constructor(error: RpcError) {
    super(error.message);
    this.code = error.code;
    this.name = "RpcCallError";
  }
}

export interface DaemonHandle {
  endpoint: ServerEndpoint;
  /** spawn した daemon を kill し、その `exit` を待つ(--server 接続時は no-op)。 */
  close: () => Promise<void>;
}

const DAEMON_START_TIMEOUT_MS = 8000;

/** `--server URL` があれば接続のみ。無ければ daemon bin を spawn し ws URL を得る。 */
export const startDaemon = async (server: ServerEndpoint | undefined): Promise<DaemonHandle> => {
  if (server !== undefined) {
    return { endpoint: server, close: () => Promise.resolve() };
  }
  const cliPath = createRequire(import.meta.url).resolve("@waxlens/daemon/dist/cli.js");
  const child = spawn(process.execPath, [cliPath], {
    env: { ...process.env, WAXLENS_DAEMON_PORT: "0" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  const endpoint = await new Promise<ServerEndpoint>((resolveEndpoint, rejectUrl) => {
    const timer = setTimeout(() => {
      rejectUrl(new Error("daemon did not become ready in time"));
    }, DAEMON_START_TIMEOUT_MS);
    // stdio: ["ignore","ignore","pipe"] により stderr は Readable(非 null)。
    child.stderr.on("data", (chunk: Buffer) => {
      const match = /(ws:\/\/127\.0\.0\.1:\d+)/.exec(chunk.toString("utf8"));
      if (match?.[1] !== undefined) {
        clearTimeout(timer);
        // 正規表現が ws://127.0.0.1:port を保証するので parse は必ず成功する。
        resolveEndpoint(ServerEndpoint.parse(match[1]));
      }
    });
    child.on("error", (cause) => {
      clearTimeout(timer);
      rejectUrl(cause);
    });
    child.on("exit", () => {
      clearTimeout(timer);
      rejectUrl(new Error("daemon exited before becoming ready"));
    });
  });
  return {
    endpoint,
    // kill して child の exit を待つ。これを待たずに親が終了処理へ進むと、
    // 死にかけの child handle が event loop に残り、exit code が確定する前に
    // 親が抜けて 0 になるレースが起きる。
    close: () =>
      new Promise<void>((resolveClose) => {
        child.once("exit", () => {
          resolveClose();
        });
        child.kill();
      }),
  };
};

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

export interface DaemonClient {
  request: <R>(method: RpcMethod, params: ValidateParams | ReadEntryParams) => Promise<R>;
  close: () => void;
}

const rawToString = (raw: RawData): string =>
  Array.isArray(raw)
    ? Buffer.concat(raw).toString("utf8")
    : Buffer.isBuffer(raw)
      ? raw.toString("utf8")
      : Buffer.from(raw).toString("utf8");

/** ws を開き、相関 id つき request を提供するクライアントを返す。 */
export const connect = async (endpoint: ServerEndpoint): Promise<DaemonClient> => {
  const ws = new WebSocket(endpoint.url);
  await new Promise<void>((resolveOpen, rejectOpen) => {
    ws.once("open", () => {
      resolveOpen();
    });
    ws.once("error", rejectOpen);
  });

  let nextId = 1;
  const pending = new Map<number, Pending>();

  ws.on("message", (raw: RawData) => {
    let response: RpcResponse;
    try {
      response = JSON.parse(rawToString(raw)) as RpcResponse;
    } catch {
      return;
    }
    const entry = pending.get(response.id);
    if (!entry) return;
    pending.delete(response.id);
    if (response.error !== undefined) entry.reject(new RpcCallError(response.error));
    else entry.resolve(response.result);
  });

  return {
    request: <R>(method: RpcMethod, params: ValidateParams | ReadEntryParams): Promise<R> =>
      new Promise<R>((resolveReq, rejectReq) => {
        const id = nextId++;
        pending.set(id, { resolve: (value) => { resolveReq(value as R); }, reject: rejectReq });
        ws.send(JSON.stringify({ id, method, params } satisfies RpcRequest));
      }),
    close: () => {
      ws.close();
    },
  };
};
