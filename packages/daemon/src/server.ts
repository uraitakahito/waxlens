/**
 * stateless な HTTP/WS サーバ。
 *
 * WS は相関 id つきの request/response(セッション/購読は持たない)。
 * REST `POST /validate` も用意(serverless / 単発用)。どのリクエストも
 * ハンドラが open→処理→close するだけで、サーバは可変状態を持たない。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { WebSocketServer, type RawData } from "ws";
import type {
  HealthStatus,
  ReadEntryParams,
  ReadEntryResult,
  RpcError,
  RpcRequest,
  RpcResponse,
  ValidateParams,
  WireReport,
} from "@waxlens/protocol";
import { BUILD_INFO } from "./generated/build-info.js";
import { DaemonError, readEntry, validate } from "./handlers.js";

const healthStatus = (): HealthStatus => ({
  status: "ok",
  version: BUILD_INFO.version,
  gitSha: BUILD_INFO.gitSha,
  builtAt: BUILD_INFO.builtAt,
  uptimeSec: Math.round(process.uptime()),
});

const dispatch = async (
  method: string,
  params: unknown,
): Promise<WireReport | ReadEntryResult | HealthStatus> => {
  if (method === "waxlens/ping") return healthStatus();
  if (method === "waxlens/validate") return validate(params as ValidateParams);
  if (method === "waxlens/readEntry") return readEntry(params as ReadEntryParams);
  throw new DaemonError("badRequest", `unknown method: ${method}`);
};

const toError = (cause: unknown): RpcError =>
  cause instanceof DaemonError
    ? { code: cause.code, message: cause.message }
    : { code: "engineFailed", message: cause instanceof Error ? cause.message : String(cause) };

const rawToString = (raw: RawData): string =>
  Array.isArray(raw)
    ? Buffer.concat(raw).toString("utf8")
    : Buffer.isBuffer(raw)
      ? raw.toString("utf8")
      : Buffer.from(raw).toString("utf8");

const handleRest = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(healthStatus()));
    return;
  }
  if (req.method !== "POST" || req.url !== "/validate") {
    res.statusCode = 404;
    res.end();
    return;
  }
  // 本文はネットワーク越しに複数チャンクへ割れて届く。chunk ごとに toString せず、
  // Buffer.concat で連結してから一度だけ decode する。マルチバイト文字(UTF-8 で複数
  // バイト)がチャンク境界をまたぐと、半端なバイトが U+FFFD に化けて値が静かに壊れる
  // ため(JSON 構造文字は ASCII なので JSON.parse は素通りし、例外も出ない)。
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    const params = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ValidateParams;
    const report = await validate(params);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(report));
  } catch (cause) {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(toError(cause)));
  }
};

export const LOG_LEVELS = ["silent", "error", "debug"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface CreateDaemonOptions {
  /** stderr 診断ログの level(既定 "silent")。malformed frame は "error" 以上で出る。 */
  logLevel?: LogLevel;
}

/** level に応じて stderr に書く薄い logger。 */
const makeLogger = (level: LogLevel) => ({
  error: (msg: string) => {
    if (level !== "silent") process.stderr.write(`waxlens-daemon [error] ${msg}\n`);
  },
  debug: (msg: string) => {
    if (level === "debug") process.stderr.write(`waxlens-daemon [debug] ${msg}\n`);
  },
});

/** stateless な HTTP/WS サーバを組み立てて返す(listen は呼び出し側)。 */
export const createDaemon = (opts: CreateDaemonOptions = {}): Server => {
  const log = makeLogger(opts.logLevel ?? "silent");
  const server = createServer((req, res) => {
    void handleRest(req, res);
  });
  const wss = new WebSocketServer({ server });
  wss.on("connection", (socket) => {
    socket.on("message", (raw: RawData) => {
      void (async () => {
        let request: RpcRequest;
        try {
          request = JSON.parse(rawToString(raw)) as RpcRequest;
        } catch (cause) {
          log.error(`ignored malformed frame: ${cause instanceof Error ? cause.message : String(cause)}`);
          return;
        }
        const response: RpcResponse = { id: request.id };
        try {
          response.result = await dispatch(request.method, request.params);
        } catch (cause) {
          response.error = toError(cause);
        }
        socket.send(JSON.stringify(response));
      })();
    });
  });
  return server;
};
