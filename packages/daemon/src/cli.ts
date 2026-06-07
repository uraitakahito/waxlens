#!/usr/bin/env node
/**
 * `waxlens-daemon` bin — stateless サーバを 127.0.0.1 で起動し、URL を stderr に出す。
 * ポートは `WAXLENS_DAEMON_PORT`(未指定/0 なら OS 任せの空きポート)。
 */
import { createDaemon } from "./server.js";

const port = Number(process.env["WAXLENS_DAEMON_PORT"] ?? "0");
const server = createDaemon();
server.listen(port, "127.0.0.1", () => {
  const addr = server.address();
  const actual = typeof addr === "object" && addr !== null ? addr.port : port;
  process.stderr.write(`waxlens-daemon ws://127.0.0.1:${String(actual)}\n`);
});
