/**
 * @waxlens/daemon の public 面 — テスト / 組み込み用にハンドラとサーバを export。
 */
export { DaemonError, readEntry, validate } from "./handlers.js";
export { createDaemon } from "./server.js";
