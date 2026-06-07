#!/usr/bin/env node
/**
 * `waxlens-daemon` bin — stateless サーバを指定 host/port で起動し、URL を stderr に出す。
 * `--host` / `--port` / `--log-level`(silent|error|debug)。env `WAXLENS_DAEMON_HOST` /
 * `_PORT` / `_LOG_LEVEL` もフォールバック(優先順: フラグ > env > 既定)。いずれも string
 * option なので `Option.env()` が効く(boolean flag では効かない既知の制約には当たらない)。
 */
import { Command, Option } from "commander";
import { createDaemon, LOG_LEVELS, type LogLevel } from "./server.js";

const program = new Command()
  .name("waxlens-daemon")
  .addOption(
    new Option("--host <host>", "Bind address").default("127.0.0.1").env("WAXLENS_DAEMON_HOST"),
  )
  .addOption(
    new Option("--port <port>", "Port (0 = OS-assigned)").default("0").env("WAXLENS_DAEMON_PORT"),
  )
  .addOption(
    new Option("--log-level <level>", "Diagnostic log level")
      .choices([...LOG_LEVELS])
      .default("silent")
      .env("WAXLENS_DAEMON_LOG_LEVEL"),
  );
program.parse();

const { host, port, logLevel } = program.opts<{ host: string; port: string; logLevel: LogLevel }>();
const server = createDaemon({ logLevel });
server.listen(Number(port), host, () => {
  const addr = server.address();
  const actual = typeof addr === "object" && addr !== null ? addr.port : Number(port);
  process.stderr.write(`waxlens-daemon ws://${host}:${String(actual)}\n`);
});
