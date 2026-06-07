#!/usr/bin/env node
/**
 * `waxlens-daemon` bin — stateless サーバを指定 host/port で起動し、URL を stderr に出す。
 * `--host` / `--port`(既定 127.0.0.1 / 0=OS 任せ)。env `WAXLENS_DAEMON_HOST` / `_PORT` も
 * フォールバック(優先順: フラグ > env > 既定)。host/port は string option なので
 * `Option.env()` が効く(boolean flag では効かない既知の制約には当たらない)。
 */
import { Command, Option } from "commander";
import { createDaemon } from "./server.js";

const program = new Command()
  .name("waxlens-daemon")
  .addOption(
    new Option("--host <host>", "Bind address").default("127.0.0.1").env("WAXLENS_DAEMON_HOST"),
  )
  .addOption(
    new Option("--port <port>", "Port (0 = OS-assigned)").default("0").env("WAXLENS_DAEMON_PORT"),
  );
program.parse();

const { host, port } = program.opts<{ host: string; port: string }>();
const server = createDaemon();
server.listen(Number(port), host, () => {
  const addr = server.address();
  const actual = typeof addr === "object" && addr !== null ? addr.port : Number(port);
  process.stderr.write(`waxlens-daemon ws://${host}:${String(actual)}\n`);
});
