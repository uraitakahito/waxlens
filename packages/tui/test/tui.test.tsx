/**
 * TUI rendering テスト。
 *
 * Ink の `App` コンポーネントを `ink-testing-library` で駆動する。
 * これは in-memory な frame buffer に render して、`lastFrame()` /
 * `stdin.write()` を露出する。実 terminal は関わらないので、test
 * スイートは他の Vitest テストと同じくらい速く、完全に決定的に動く。
 *
 * assert すること:
 *   - コンポーネントが全 issue を rule 名と severity アイコンつきで
 *     render する。
 *   - カーソル (`▶`) は最初の issue から始まり、`↑` / `↓` で移動する。
 *   - `enter` で focused issue の `details` ブロックがトグルする。
 *   - `q` で app が綺麗に終了する (Ink の `useApp().exit()`)。
 *
 * 意図的に assert しないこと:
 *   - フレームのバイト単位 snapshot。Ink の render 出力は ANSI rich で、
 *     ライブラリの minor バージョンで変動しうる; これを pin すると
 *     M2 が動く標的になる。substring assertion で意味論的な surface は
 *     cover できる。
 */
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import type { Report } from "@waxlens/core";
import { App } from "../src/app.js";

const makeReport = (overrides: Partial<Report> = {}): Report => ({
  waxlensVersion: "0.0.0",
  profile: "spec",
  file: "/tmp/fixture.wacz",
  valid: false,
  summary: { passed: 3, failed: 2, warnings: 0, info: 0, durationMs: 12 },
  issues: [
    {
      rule: "datapackage/profile-required",
      severity: "error",
      message: 'datapackage.json is missing the "profile" field',
      location: { entry: "datapackage.json" },
      details: { expected: "data-package" },
    },
    {
      rule: "cdxj/filename-archive-relative",
      severity: "error",
      message: 'entry "filename" starts with "archive/"',
      location: { entry: "indexes/index.cdxj", line: 1 },
    },
  ],
  ...overrides,
});

describe("tui rendering", () => {
  it("renders all issue rule names and the summary", () => {
    const { lastFrame } = render(<App report={makeReport()} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("waxlens");
    expect(frame).toContain("datapackage/profile-required");
    expect(frame).toContain("cdxj/filename-archive-relative");
    expect(frame).toContain("3 passed");
    expect(frame).toContain("2 failed");
    expect(frame).toContain("↑↓ navigate");
  });

  it("shows 'All rules passed.' when there are no issues", () => {
    const report = makeReport({
      issues: [],
      valid: true,
      summary: { passed: 5, failed: 0, warnings: 0, info: 0, durationMs: 8 },
    });
    const { lastFrame } = render(<App report={report} />);
    expect(lastFrame() ?? "").toContain("All rules passed.");
  });

  it("starts with the cursor on the first issue", () => {
    const { lastFrame } = render(<App report={makeReport()} />);
    const frame = lastFrame() ?? "";
    // カーソルは最初の rule 名と同じ行に座る。順序を確認することで
    // assert する: ▶ は最初の rule の手前にあり、フレーム内では
    // 唯一のマーカー。
    const cursorIdx = frame.indexOf("▶");
    const firstRuleIdx = frame.indexOf("datapackage/profile-required");
    expect(cursorIdx).toBeGreaterThanOrEqual(0);
    expect(cursorIdx).toBeLessThan(firstRuleIdx);
    expect(frame.match(/▶/g)?.length ?? 0).toBe(1);
  });

  it("expands details on enter", async () => {
    const { lastFrame, stdin } = render(<App report={makeReport()} />);
    // enter を押す前は details payload が見えていないはず。
    expect(lastFrame() ?? "").not.toContain("expected:");

    // enter を押す — ink-testing-library は raw bytes を mock stdin
    // に書き込む; Ink が return キーとして解釈するのは `\r`。
    stdin.write("\r");
    // 次の render tick を走らせる。
    await new Promise((resolve) => setTimeout(resolve, 20));

    // 最初の issue の details は `{ expected: "data-package" }` —
    // diff view は `expected` と `actual` の両方を要求するので、
    // ペアの `actual` が無い場合は generic JSON view に流れる。
    // dispatch の判断に依存しないよう、ここでは JSON-tail として
    // render される `expected` の存在を assert する。
    expect(lastFrame() ?? "").toContain("data-package");
  });

  it("moves the cursor with the down arrow", async () => {
    const { lastFrame, stdin } = render(<App report={makeReport()} />);
    // ESC[B は down arrow の ANSI シーケンス。Ink はこれを
    // `useInput` 内で `key.downArrow` に decode する。
    stdin.write("[B");
    await new Promise((resolve) => setTimeout(resolve, 20));

    const frame = lastFrame() ?? "";
    const cursorIdx = frame.indexOf("▶");
    const firstRuleIdx = frame.indexOf("datapackage/profile-required");
    const secondRuleIdx = frame.indexOf("cdxj/filename-archive-relative");
    expect(cursorIdx).toBeGreaterThan(firstRuleIdx);
    expect(cursorIdx).toBeLessThan(secondRuleIdx);
  });

  it("renders the stats footer when report.stats is present", () => {
    const report = makeReport({
      stats: { warcRecordCount: 42, warcArchiveBytes: 5 * 1024 * 1024, hosts: ["a", "b", "c"] },
    });
    const frame = render(<App report={report} />).lastFrame() ?? "";
    expect(frame).toContain("42 records");
    expect(frame).toContain("5.0 MB");
    expect(frame).toContain("3 hosts");
  });

  it("diff view shows expected/actual for hash-style issues", async () => {
    const report = makeReport({
      issues: [
        {
          rule: "datapackage/resource-hashes",
          severity: "error",
          message: "hash mismatch",
          details: { expected: "sha256:GOOD", actual: "sha256:BAD" },
        },
      ],
    });
    const { lastFrame, stdin } = render(<App report={report} />);
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("expected:");
    expect(frame).toContain("actual:");
    expect(frame).toContain("sha256:GOOD");
    expect(frame).toContain("sha256:BAD");
  });

  it("WARC header view renders for CDXJ↔WARC mismatch details", async () => {
    const report = makeReport({
      issues: [
        {
          rule: "cdxj/warc-offsets",
          severity: "error",
          message: "offset mismatch",
          details: {
            requested: { offset: 99, length: 100 },
            candidates: [{ offset: 0, length: 200, warcHeader: ["WARC/1.1"] }],
          },
        },
      ],
    });
    const { lastFrame, stdin } = render(<App report={report} />);
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(lastFrame() ?? "").toContain("Nearby WARC members:");
  });

  it("hex view renders when details carry hexPreview", async () => {
    const report = makeReport({
      issues: [
        {
          rule: "warc/payload-digest",
          severity: "warning",
          message: "payload digest mismatch",
          details: {
            expected: "sha256:GOOD",
            actual: "sha256:BAD",
            hexPreview: [
              "00000000  4e a7 5b 0c 1f 8b 08 00  00 00 00 00 00 03 b5 d3   N.[..........X..",
            ],
          },
        },
      ],
    });
    const { lastFrame, stdin } = render(<App report={report} />);
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Payload preview (hex):");
    expect(frame).toContain("4e a7 5b 0c");
  });
});
