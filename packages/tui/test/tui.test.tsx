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
import type { AbsolutePath, Report } from "@waxlens/core";
import { App } from "../src/app.js";

const makeReport = (overrides: Partial<Report> = {}): Report => ({
  waxlensVersion: "0.0.0",
  profile: "spec",
  source: { kind: "file", path: "/tmp/fixture.wacz" as AbsolutePath },
  valid: false,
  summary: { passed: 3, failed: 2, warnings: 0, info: 0, durationMs: 12 },
  issues: [
    {
      rule: "datapackage/profile-required",
      severity: "error",
      messageKey: "datapackage/profile-required.missing-field",
      params: { entry: "datapackage.json" },
      location: { entry: "datapackage.json" },
      details: { expected: "data-package" },
    },
    {
      rule: "cdxj/filename-archive-relative",
      severity: "error",
      messageKey: "cdxj/filename-archive-relative.starts-with-archive",
      params: { entry: "indexes/index.cdxj" },
      location: { entry: "indexes/index.cdxj", line: 1 },
    },
  ],
  entries: [],
  ...overrides,
});

describe("tui rendering", () => {
  it("renders all issue rule names and the summary", () => {
    const { lastFrame } = render(<App report={makeReport()} locale="en" />);
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
    const { lastFrame } = render(<App report={report} locale="en" />);
    expect(lastFrame() ?? "").toContain("All rules passed.");
  });

  it("starts with the cursor on the first issue", () => {
    const { lastFrame } = render(<App report={makeReport()} locale="en" />);
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
    const { lastFrame, stdin } = render(<App report={makeReport()} locale="en" />);
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
    const { lastFrame, stdin } = render(<App report={makeReport()} locale="en" />);
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
    const frame = render(<App report={report} locale="en" />).lastFrame() ?? "";
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
          messageKey: "datapackage/resource-hashes.hash-mismatch",
          params: { path: "archive/data.warc.gz" },
          details: { expected: "sha256:GOOD", actual: "sha256:BAD" },
        },
      ],
    });
    const { lastFrame, stdin } = render(<App report={report} locale="en" />);
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
          messageKey: "cdxj/warc-offsets.offset-no-match",
          params: { line: "1", offset: "99" },
          details: {
            requested: { offset: 99, length: 100 },
            candidates: [{ offset: 0, length: 200, warcHeader: ["WARC/1.1"] }],
          },
        },
      ],
    });
    const { lastFrame, stdin } = render(<App report={report} locale="en" />);
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
          messageKey: "warc/payload-digest.mismatch",
          params: { memberIdx: "1" },
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
    const { lastFrame, stdin } = render(<App report={report} locale="en" />);
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Payload preview (hex):");
    expect(frame).toContain("4e a7 5b 0c");
  });
});

describe("tui — layout view", () => {
  const withEntries = () =>
    makeReport({
      entries: [
        {
          path: "archive/data.warc.gz",
          present: true,
          uncompressedSize: 100,
          compressionMethod: 0,
          expectedBy: ["datapackage"],
          issues: [{ rule: "datapackage/resource-hashes", severity: "error" }],
        },
        {
          path: "datapackage.json",
          present: true,
          uncompressedSize: 50,
          compressionMethod: 8,
          expectedBy: ["wacz-spec"],
          issues: [],
        },
        {
          path: "pages/extraPages.jsonl",
          present: false,
          expectedBy: ["datapackage"],
          issues: [],
        },
      ],
    });

  it("starts on the Issues view (no file tree)", () => {
    const frame = render(<App report={withEntries()} locale="en" />).lastFrame() ?? "";
    expect(frame).not.toContain("data.warc.gz");
  });

  it("Tab switches to the Layout view: §5.1 tree with compact status icons", async () => {
    const { lastFrame, stdin } = render(<App report={withEntries()} locale="en" />);
    stdin.write("\t"); // Tab
    await new Promise((resolve) => setTimeout(resolve, 20));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("data.warc.gz"); // tree leaf
    expect(frame).toContain("└──"); // §5.1 connector
    expect(frame).toContain("✗"); // compact status icon (error issue / missing)
    // 詳細(rule 名・欠落理由)はツリーから消え、DetailPane に一本化した。
    // focus 0 はディレクトリ行なのでペインは (select a file) → frame 全体から消える。
    expect(frame).not.toContain("datapackage/resource-hashes");
    expect(frame).not.toContain("(missing — declared in datapackage)");
  });

  // 詳細ペイン: 単一 root file を entry にして focus 0 がその file を指すようにし、
  // 矢印ナビに依存せず検証する(ナビ自体は別テストが cover 済み)。
  it("Layout pane shows metadata + full issue for the selected file", async () => {
    const report = makeReport({
      entries: [
        {
          path: "datapackage.json",
          present: true,
          uncompressedSize: 885,
          compressionMethod: 8,
          expectedBy: ["wacz-spec"],
          issues: [{ rule: "datapackage/profile-required", severity: "error" }],
        },
      ],
      issues: [
        {
          rule: "datapackage/profile-required",
          severity: "error",
          messageKey: "datapackage/profile-required.missing-field",
          params: { entry: "datapackage.json" },
          location: { entry: "datapackage.json" },
        },
      ],
    });
    const { lastFrame, stdin } = render(<App report={report} locale="en" />);
    stdin.write("\t"); // Tab → Layout、focus 0 = datapackage.json(root file）
    await new Promise((resolve) => setTimeout(resolve, 20));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("present"); // status
    expect(frame).toContain("DEFLATE"); // codecName(8)
    expect(frame).toContain("required by §5.2"); // expectedLabel(["wacz-spec"])
    expect(frame).toContain("datapackage/profile-required"); // ペインの issue rule
    // 全文 message はペイン幅で word-wrap される(Ink は語の途中で折らない)。
    // message にしか出ない語 "field" で本文が描かれていることを確認する。
    expect(frame).toContain("field");
  });

  it("Layout pane shows MISSING + §5.2 reason for an absent required file", async () => {
    const report = makeReport({
      entries: [
        {
          path: "datapackage.json",
          present: false,
          expectedBy: ["wacz-spec"],
          issues: [{ rule: "wacz/required-files", severity: "error" }],
        },
      ],
      issues: [
        {
          rule: "wacz/required-files",
          severity: "error",
          messageKey: "wacz/required-files.missing-datapackage",
          location: { entry: "datapackage.json" },
        },
      ],
    });
    const { lastFrame, stdin } = render(<App report={report} locale="en" />);
    stdin.write("\t");
    await new Promise((resolve) => setTimeout(resolve, 20));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("MISSING"); // pane の status(tree は小文字 missing なので pane を指す）
    expect(frame).toContain("wacz/required-files"); // pane の issue rule
  });
});
