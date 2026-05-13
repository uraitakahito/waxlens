/**
 * CLI integration tests.
 *
 * Spawns the built `dist/cli.js` against generated fixtures and asserts on:
 *   - exit code     — 0 for valid, 1 for invalid, 2 for operational failures
 *   - JSON shape    — snapshot-based, with non-deterministic fields scrubbed
 *
 * Why spawn instead of importing the CLI module directly: the CLI ends
 * with `process.exit`, which would kill the test runner. Plus the spawn
 * path exercises the shebang / bin-script wiring that the pack-smoke
 * workflow also exercises in CI — keeping the two assertions identical
 * means a failure here points to the same root cause.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildWacz, type FixtureOptions } from "./fixtures/generator.js";

const execFileAsync = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(HERE, "..", "dist", "cli.js");

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

/**
 * Run the built CLI. `dist/cli.js` is invoked via `node` so we don't depend
 * on the chmod step having been run in this test's session (the test
 * suite drives `npm run build` itself before running).
 */
const runCli = async (args: string[]): Promise<RunResult> => {
  try {
    const { stdout, stderr } = await execFileAsync("node", [CLI_PATH, ...args], {
      // Disable colour by default so JSON-only snapshots aren't tinted.
      env: { ...process.env, NO_COLOR: "1" },
    });
    return { stdout, stderr, code: 0 };
  } catch (e) {
    // execFile rejects on non-zero exit. The rejection value carries
    // `code`, `stdout`, `stderr` — TS types it as `Error & {...}`.
    const err = e as Error & { code?: number; stdout?: string; stderr?: string };
    return {
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
      code: err.code ?? -1,
    };
  }
};

const writeFixture = async (
  tmpDir: string,
  filename: string,
  options: FixtureOptions = {},
): Promise<string> => {
  const { bytes } = await buildWacz(options);
  const path = join(tmpDir, filename);
  await writeFile(path, bytes);
  return path;
};

/**
 * JSON output carries the absolute file path and an elapsed-ms duration
 * — both vary between machines/runs and would make snapshots brittle.
 * Replace them with stable placeholders before snapshotting.
 */
const stabiliseJson = (text: string): unknown => {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  if (typeof parsed["file"] === "string") parsed["file"] = "<tmp>/fixture.wacz";
  const summary = parsed["summary"] as Record<string, unknown> | undefined;
  if (summary && typeof summary["durationMs"] === "number") {
    summary["durationMs"] = 0;
  }
  return parsed;
};

describe("cli — exit codes", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "waxlens-cli-test-"));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("valid WACZ → exit 0", async () => {
    const path = await writeFixture(tmpDir, "good.wacz");
    const result = await runCli([path]);
    expect(result.code).toBe(0);
  });

  it("missing profile → exit 1", async () => {
    const path = await writeFixture(tmpDir, "no-profile.wacz", { profile: null });
    const result = await runCli([path]);
    expect(result.code).toBe(1);
  });

  it("non-existent file → exit 2 (operational failure)", async () => {
    const result = await runCli([join(tmpDir, "does-not-exist.wacz")]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("cannot open");
  });

  it("--plain emits a colour-stripped human summary", async () => {
    // Default output is JSON; `--plain` flips to the human renderer.
    // We don't snapshot the text (it'd be brittle to layout tweaks);
    // we just assert that the version banner and the summary line
    // appear, which together signal the plain renderer ran.
    const path = await writeFixture(tmpDir, "good.wacz");
    const result = await runCli([path, "--plain"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("waxlens 0.0.0");
    expect(result.stdout).toContain("passed");
  });
});

describe("cli — JSON output shape (default)", () => {
  let tmpDir: string;
  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "waxlens-cli-test-"));
  });
  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("valid WACZ JSON snapshot", async () => {
    const path = await writeFixture(tmpDir, "good.wacz");
    const result = await runCli([path]);
    expect(result.code).toBe(0);
    expect(stabiliseJson(result.stdout)).toMatchSnapshot();
  });

  it("missing-profile JSON snapshot", async () => {
    const path = await writeFixture(tmpDir, "no-profile.wacz", { profile: null });
    const result = await runCli([path]);
    expect(result.code).toBe(1);
    expect(stabiliseJson(result.stdout)).toMatchSnapshot();
  });

  it("gzipped CDXJ JSON snapshot", async () => {
    const path = await writeFixture(tmpDir, "gz-cdxj.wacz", { cdxjGzipped: true });
    const result = await runCli([path]);
    expect(result.code).toBe(1);
    expect(stabiliseJson(result.stdout)).toMatchSnapshot();
  });
});
