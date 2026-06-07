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
  ReadEntryParams,
  ReadEntryResult,
  RpcError,
  RpcRequest,
  RpcResponse,
  ValidateParams,
  WireReport,
} from "@waxlens/protocol";
import { DaemonError, readEntry, validate } from "./handlers.js";

const dispatch = async (
  method: string,
  params: unknown,
): Promise<WireReport | ReadEntryResult> => {
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
  if (req.method !== "POST" || req.url !== "/validate") {
    res.statusCode = 404;
    res.end();
    return;
  }
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

/** stateless な HTTP/WS サーバを組み立てて返す(listen は呼び出し側)。 */
export const createDaemon = (): Server => {
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
        } catch {
          return; // 解釈不能なフレームは無視
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
