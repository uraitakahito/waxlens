#!/usr/bin/env node
/**
 * `waxlens-validate` — validation engine の CLI。
 *
 * machine-readable な出力のみ
 *
 * Exit codes:
 *   0 — validation 成功 (error 重大度の issue なし)
 *   1 — validation 失敗 (error 重大度の issue が 1 件以上)
 *   2 — operational な失敗 (ファイルが開けない等)
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, InvalidArgumentError } from "commander";
import { exitCodeFor, type CliOutcome } from "./cli-outcome.js";
import { renderJson } from "./render/json.js";
import { DEFAULT_PROFILE, runValidation } from "./validate/engine.js";
import { DEFAULT_RULES } from "./validate/rules/index.js";
import type { ReportSource, RuleProfile } from "./validate/domain.js";
import {
  ALL_PROFILES,
  formatParseSourceError,
  parseReportSource,
} from "./validate/domain.js";
import { buildS3Client } from "./wacz/s3-client-factory.js";
import { fileTransport, s3Transport } from "./wacz/transport.js";
import { WaczReader } from "./wacz/reader.js";

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, "..", "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { version: string };

// env→boolean を strict に解釈 (空文字 / "false" / その他は全部 false)。
// CLI flag のデフォルト値として commander に渡す。flag が立てば true で
// 上書きされる。
const envS3ForcePathStyle = process.env["WAXLENS_S3_FORCE_PATH_STYLE"] === "true";

interface CliOptions {
  profile: RuleProfile;
  s3ForcePathStyle: boolean;
}

const parseProfile = (raw: string): RuleProfile => {
  if ((ALL_PROFILES as readonly string[]).includes(raw)) return raw as RuleProfile;
  throw new InvalidArgumentError(`Unknown profile "${raw}". Valid: ${ALL_PROFILES.join(", ")}.`);
};

// source.kind に応じた transport を選んで WaczReader.open に渡す唯一の
// dispatch 点。s3 のときだけ client を構築する (file 入力では S3 関連の
// コードは一切走らない)。
const openWacz = (
  source: ReportSource,
  s3ForcePathStyle: boolean,
): Promise<WaczReader> =>
  WaczReader.open(
    source.kind === "s3"
      ? s3Transport(source.uri, buildS3Client(s3ForcePathStyle))
      : fileTransport(source.path),
  );

async function runCli(filePath: string, opts: CliOptions): Promise<CliOutcome> {
  const sourceResult = parseReportSource(filePath);
  if (!sourceResult.ok) {
    return {
      kind: "openFailed",
      filePath,
      cause: new Error(formatParseSourceError(sourceResult.error)),
    };
  }

  let reader: WaczReader;
  try {
    reader = await openWacz(sourceResult.value, opts.s3ForcePathStyle);
  } catch (cause) {
    return { kind: "openFailed", filePath, cause };
  }

  try {
    const result = await runValidation(reader, {
      waxlensVersion: manifest.version,
      rules: DEFAULT_RULES,
      profile: opts.profile,
    });
    if (!result.ok) return { kind: "engineFailed" };
    const report = result.value;

    return report.valid ? { kind: "valid", report } : { kind: "invalid", report };
  } finally {
    await reader.close();
  }
}

const program = new Command();
program
  .name("waxlens-validate")
  .description("WACZ validator — emits a machine-readable JSON report to stdout")
  .version(manifest.version)
  .argument(
    "<source>",
    "Local path or s3://bucket/key URI of the .wacz to validate",
  )
  .option(
    "--profile <name>",
    `Rule profile (${ALL_PROFILES.join(" | ")}). Defaults to "${DEFAULT_PROFILE}".`,
    parseProfile,
    DEFAULT_PROFILE,
  )
  .option(
    "--s3-force-path-style",
    "Force path-style S3 addressing for bundled SeaweedFS / MinIO 等 (also via WAXLENS_S3_FORCE_PATH_STYLE=true)",
    envS3ForcePathStyle,
  )
  .action(async (filePath: string, options: CliOptions) => {
    const outcome = await runCli(filePath, options);
    dispatch(outcome);
    // `process.exit(N)` ではなく `process.exitCode` をセットすることで、
    // stdout の同期 flush と `parseAsync` の Promise の clean な resolve
    // を保証しつつ、Node が event loop drain で自然終了するときに正しい
    // exit code を返す。`runCli` は `reader.close()` を `finally` で
    // await しているので、外側に lingering handle は残らない。
    //
    // 反面、event loop が drain しないと process は hang する (例: stdout
    // pipe を読まない consumer)。waxlens は timer / socket / watcher を
    // 持たず fd も finally で閉じるので drain 阻害経路は stdout のみで、
    // pathological consumer による hang は `process.exit(N)` に切り替え
    // ても output が truncate するだけで防げない — loud な hang の方が
    // silent truncation より望ましいので safety net は入れない。将来
    // timer / network / 子プロセスを伴う依存を足すときは
    // `setTimeout(...).unref()` 形式の hard-exit を検討する (cf.
    // `browserhive/bin/server.ts:HARD_EXIT_TIMEOUT_MS`)。
    process.exitCode = exitCodeFor(outcome);
  });

await program.parseAsync(process.argv);

/**
 * outcome に従って副作用 (stdout / stderr) を発火する。exit code は
 * 呼び出し側で `exitCodeFor` を使うので、ここでは触らない。
 *
 * `engineFailed` は `Result<Report, never>` から narrowing のためだけに
 * 生まれる variant で、論理的には到達不能。万一来たら silent (stderr
 * 出さない) のまま exit code 2 になる — 現状の挙動と同じ。
 */
function dispatch(outcome: CliOutcome): void {
  switch (outcome.kind) {
    case "valid":
    case "invalid":
      process.stdout.write(renderJson(outcome.report));
      return;
    case "openFailed": {
      const message =
        outcome.cause instanceof Error ? outcome.cause.message : String(outcome.cause);
      process.stderr.write(`waxlens-validate: cannot open "${outcome.filePath}": ${message}\n`);
      return;
    }
    case "engineFailed":
      return;
  }
}
