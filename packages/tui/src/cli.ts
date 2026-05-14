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
 * Exit code は `waxlens-validate` と同じ:
 *   0 — validation 成功 (error severity の issue なし)
 *   1 — validation 失敗 (error severity の issue が 1 件以上)
 *   2 — operational な失敗 (ファイルが開けない等)
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, InvalidArgumentError } from "commander";
import {
  ALL_PROFILES,
  DEFAULT_PROFILE,
  M1_RULES,
  runValidation,
  WaczReader,
  type Report,
  type RuleProfile,
} from "@waxlens/core";
import { renderPlain } from "./render/plain.js";

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, "..", "package.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as { version: string };

interface CliOptions {
  color: boolean;
  tui: boolean;
  profile: RuleProfile;
}

const parseProfile = (raw: string): RuleProfile => {
  if ((ALL_PROFILES as readonly string[]).includes(raw)) return raw as RuleProfile;
  throw new InvalidArgumentError(`Unknown profile "${raw}". Valid: ${ALL_PROFILES.join(", ")}.`);
};

const program = new Command();
program
  .name("waxlens")
  .description("Interactive TUI for WACZ validation (use waxlens-validate for JSON output)")
  .version(manifest.version)
  .argument("<file>", "Path to the .wacz file to validate")
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
  .action(async (filePath: string, options: CliOptions) => {
    // `process.exit(N)` ではなく `process.exitCode` をセット。Ink の
    // `instance.waitUntilExit()` は `useApp().exit()` を待つ自然な経路で、
    // ここで強制終了すると raw-mode TTY が ANSI escape を残すなど後始末
    // を踏み外しうる。`runCli` が reader を `finally` で閉じ、TUI 経路は
    // `waitUntilExit` を await しているので、callback が return すれば
    // event loop は自然に drain して Node が `exitCode` で終了する。
    process.exitCode = await runCli(filePath, options);
  });

await program.parseAsync(process.argv);

async function runCli(filePath: string, opts: CliOptions): Promise<number> {
  const absolutePath = resolve(filePath);

  let reader: WaczReader;
  try {
    reader = await WaczReader.open(absolutePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`waxlens: cannot open "${filePath}": ${message}\n`);
    return 2;
  }

  try {
    const result = await runValidation(reader, {
      file: filePath,
      waxlensVersion: manifest.version,
      rules: M1_RULES,
      profile: opts.profile,
    });
    if (!result.ok) return 2;
    const report = result.value;

    if (shouldUseTui(opts)) {
      await runTui(report);
    } else {
      process.stdout.write(renderPlain(report, { color: opts.color }));
    }

    return report.valid ? 0 : 1;
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
  return Boolean(process.stdout.isTTY) && Boolean(process.stdin.isTTY);
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
