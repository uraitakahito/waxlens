#!/usr/bin/env node
/**
 * `waxlens` — WACZ validation のための Ink TUI。
 *
 * in-process で `@waxlens/core` を import し (spawn 無し)、得られた
 * `Report` を interactive に render する。stdout または stdin が TTY
 * でない場合は silent に同じ plain-text renderer
 * (`waxlens-validate --plain` が使うもの) に fallback する。
 * machine-readable JSON が欲しい場合は `waxlens-validate` を直接
 * 使う — そのコントラクトを enforce するために 2 つに分かれている。
 *
 * Exit code は `waxlens-validate` と同じ (`exitCodeFor` が単一情報源):
 *   0 — validation 成功 (error severity の issue なし)
 *   1 — validation 失敗 (error severity の issue が 1 件以上)
 *   2 — operational な失敗 (ファイルが開けない等)
 *
 * 副作用の責務分担:
 *   - `runCli`   outcome を組み立てるだけ; render はしない
 *   - `dispatch` TUI / plain / stderr の発火と await をここで集約
 *   - action     最後に `process.exitCode = exitCodeFor(outcome)` で締める
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, InvalidArgumentError } from "commander";
import {
  ALL_PROFILES,
  buildS3Client,
  DEFAULT_PROFILE,
  DEFAULT_RULES,
  exitCodeFor,
  formatParseSourceError,
  parseReportSource,
  runValidation,
  WaczReader,
  type CliOutcome,
  type Report,
  type ReportSource,
  type RuleProfile,
} from "@waxlens/core";
import { renderPlain } from "./render/plain.js";

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, "..", "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { version: string };

// env→boolean を strict に解釈 (空文字 / "false" / その他は全部 false)。
// CLI flag のデフォルト値として commander に渡す。flag が立てば true で
// 上書きされる。
const envS3ForcePathStyle = process.env["WAXLENS_S3_FORCE_PATH_STYLE"] === "true";

interface CliOptions {
  color: boolean;
  tui: boolean;
  profile: RuleProfile;
  s3ForcePathStyle: boolean;
}

/**
 * caller (`runCli`) が渡した `s3ForcePathStyle` で S3Client を構築し、
 * s3 source の場合だけ `WaczReader.open` に注入する pre-bound な opener。
 * file 入力時に S3 関連の構築コードは一切走らない。 caller は
 * transport を意識せず `openWacz(source, opts.s3ForcePathStyle)`
 * を呼ぶだけ — domain layer は S3 を知らない構造になる
 * (Composition Root pattern)。
 *
 * env (`WAXLENS_S3_FORCE_PATH_STYLE=true`) は CLI flag のデフォルト値に
 * しか影響しない: env=true ならフラグ無しでも path-style ON、 env=false /
 * 未設定なら OFF。CLI flag を立てると env を上書きして常に ON。
 * commander 14 の `Option.env()` は boolean flag に対しては正しく動かない
 * (env="false" や空文字を truthy として扱う) ため、env→boolean の解釈は
 * module top で hand-roll してから `.default()` に渡す。
 */
const openWacz = (
  source: ReportSource,
  s3ForcePathStyle: boolean,
): Promise<WaczReader> => {
  if (source.kind === "s3") {
    return WaczReader.open(source, { s3Client: buildS3Client(s3ForcePathStyle) });
  }
  return WaczReader.open(source);
};

const parseProfile = (raw: string): RuleProfile => {
  if ((ALL_PROFILES as readonly string[]).includes(raw)) return raw as RuleProfile;
  throw new InvalidArgumentError(`Unknown profile "${raw}". Valid: ${ALL_PROFILES.join(", ")}.`);
};

const program = new Command();
program
  .name("waxlens")
  .description("Interactive TUI for WACZ validation (use waxlens-validate for JSON output)")
  .version(manifest.version)
  .argument(
    "<source>",
    "Local path or s3://bucket/key URI of the .wacz to validate",
  )
  .option("--no-color", "Disable ANSI colour escapes in plain output")
  .option(
    "--no-tui",
    "Force plain output even when stdout is a TTY (default chooses based on isTTY)",
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
    await dispatch(outcome, options);
    // `process.exit(N)` ではなく `process.exitCode` をセット。Ink の
    // `instance.waitUntilExit()` は `useApp().exit()` を待つ自然な経路で、
    // ここで強制終了すると raw-mode TTY が ANSI escape を残すなど後始末
    // を踏み外しうる。`runCli` が reader を `finally` で閉じ、TUI 経路は
    // `waitUntilExit` を await しているので、callback が return すれば
    // event loop は自然に drain して Node が `exitCode` で終了する。
    process.exitCode = exitCodeFor(outcome);
  });

await program.parseAsync(process.argv);

/**
 * outcome に従って副作用 (TUI render / plain stdout / stderr) を発火
 * する。`runTui` は async (Ink の `waitUntilExit` を待つ) なので、
 * この関数自身も async にして、TUI 終了前に exit code がセットされる
 * 競合を避ける。
 *
 * `engineFailed` は `Result<Report, never>` から narrowing のためだけに
 * 生まれる variant で、論理的には到達不能。万一来たら silent で抜けて
 * exit code 2 になる — 現状の挙動と同じ。
 */
async function dispatch(outcome: CliOutcome, opts: CliOptions): Promise<void> {
  switch (outcome.kind) {
    case "valid":
    case "invalid":
      if (shouldUseTui(opts)) {
        await runTui(outcome.report);
      } else {
        process.stdout.write(renderPlain(outcome.report, { color: opts.color }));
      }
      return;
    case "openFailed": {
      const message =
        outcome.cause instanceof Error ? outcome.cause.message : String(outcome.cause);
      process.stderr.write(`waxlens: cannot open "${outcome.filePath}": ${message}\n`);
      return;
    }
    case "engineFailed":
      return;
  }
}

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

// `const` の arrow ではなく `function` 宣言にしているのは、module
// トップの `await program.parseAsync(...)` が `runCli` (これらを呼ぶ)
// を invoke しても temporal dead zone に当たらないようにするため。
function shouldUseTui(opts: CliOptions): boolean {
  if (!opts.tui) return false;
  // 双方向に意味がある: Ink は stdout に書く (cursor 制御に TTY が
  // 必要) し stdin から読む (navigation のために raw-mode の
  // keystroke が必要)。どちらかでも TTY で無いと interactive surface
  // が壊れるので、plain text に fallback する。
  return process.stdout.isTTY && process.stdin.isTTY;
}

async function runTui(report: Report): Promise<void> {
  const [{ render }, { createElement }, { App }] = await Promise.all([
    import("ink"),
    import("react"),
    import("./app.js"),
  ]);
  const instance = render(createElement(App, { report }));
  await instance.waitUntilExit();
}
