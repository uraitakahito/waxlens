/**
 * TUI rendering テスト。
 *
 * Ink の `App` を `ink-testing-library` で駆動する。daemon クライアント化後の
 * App は解決済みの {@link WireReport}(`message` / `specUrl` / `conformance` が
 * inline)を受け取り、core の i18n を呼ばずそれを描く。よってモックの issue は
 * `message`(必須)/ 必要なら `specUrl` を直接持たせる。
 *
 * 実 terminal は関わらない(in-memory frame)。byte 単位 snapshot は取らず、
 * substring assertion で意味論的 surface を cover する。
 */
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import type { AbsolutePath, WireReport } from "@waxlens/protocol";
import { App } from "../src/app.js";

const makeReport = (overrides: Partial<WireReport> = {}): WireReport => ({
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
      message: 'datapackage.json is missing the "profile" field',
      params: { entry: "datapackage.json" },
      location: { entry: "datapackage.json" },
      details: { expected: "data-package" },
    },
    {
      rule: "cdxj/filename-archive-relative",
      severity: "error",
      messageKey: "cdxj/filename-archive-relative.starts-with-archive",
      message: 'entry "filename" starts with "archive/"',
      params: { entry: "indexes/index.cdxj" },
      location: { entry: "indexes/index.cdxj", line: 1 },
    },
  ],
  entries: [],
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
    const cursorIdx = frame.indexOf("▶");
    const firstRuleIdx = frame.indexOf("datapackage/profile-required");
    expect(cursorIdx).toBeGreaterThanOrEqual(0);
    expect(cursorIdx).toBeLessThan(firstRuleIdx);
    expect(frame.match(/▶/g)?.length ?? 0).toBe(1);
  });

  it("expands details on enter", async () => {
    const { lastFrame, stdin } = render(<App report={makeReport()} />);
    expect(lastFrame() ?? "").not.toContain("expected:");
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(lastFrame() ?? "").toContain("data-package");
  });

  it("moves the cursor with the down arrow", async () => {
    const { lastFrame, stdin } = render(<App report={makeReport()} />);
    // 本物の down-arrow は ESC + CSI(`[B`)。ESC 無しの "[B" は ink の
    // デコードが不安定なので、正しい制御シーケンスで決定的に駆動する。
    stdin.write("[B");
    await new Promise((resolve) => setTimeout(resolve, 60));
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
          messageKey: "datapackage/resource-hashes.hash-mismatch",
          message: 'Resource "archive/data.warc.gz" hash mismatch',
          params: { path: "archive/data.warc.gz" },
          details: { expected: "sha256:GOOD", actual: "sha256:BAD" },
        },
      ],
    });
    const { lastFrame, stdin } = render(<App report={report} />);
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 60));
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
          message: "indexes/index.cdxj line 1: offset 99 does not match any WARC member start",
          params: { line: "1", offset: "99" },
          details: {
            requested: { offset: 99, length: 100 },
            candidates: [{ offset: 0, length: 200, warcHeader: ["WARC/1.1"] }],
          },
        },
      ],
    });
    const { lastFrame, stdin } = render(<App report={report} />);
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(lastFrame() ?? "").toContain("Nearby WARC members:");
  });

  it("hex view renders when details carry hexPreview", async () => {
    const report = makeReport({
      issues: [
        {
          rule: "warc/payload-digest",
          severity: "warning",
          messageKey: "warc/payload-digest.mismatch",
          message: "WARC record #1 payload digest mismatch",
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
    const { lastFrame, stdin } = render(<App report={report} />);
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 60));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Payload preview (hex):");
    expect(frame).toContain("4e a7 5b 0c");
  });

  it("shows a spec URL line when an issue carries a resolved specUrl", () => {
    const report = makeReport({
      issues: [
        {
          rule: "wacz/required-files",
          severity: "error",
          messageKey: "wacz/required-files.missing-archive",
          message: "archive/ has no WARC file",
          specUrl: "https://specs.webrecorder.net/wacz/1.1.1/#archive",
          params: { section: "5.2.1" },
          location: { entry: "archive/" },
        },
      ],
    });
    const frame = render(<App report={report} />).lastFrame() ?? "";
    expect(frame).toContain("spec https://specs.webrecorder.net/wacz/1.1.1/#archive");
  });

  it("omits the spec line when an issue has no resolved specUrl", () => {
    const report = makeReport({
      issues: [
        {
          rule: "x/y",
          severity: "error",
          messageKey: "x/y.z",
          message: "some issue",
          location: { entry: "datapackage.json" },
        },
      ],
    });
    const frame = render(<App report={report} />).lastFrame() ?? "";
    expect(frame).not.toContain("spec https://");
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
    const frame = render(<App report={withEntries()} />).lastFrame() ?? "";
    expect(frame).not.toContain("data.warc.gz");
  });

  it("Tab switches to the Layout view: §5.1 tree with compact status icons", async () => {
    const { lastFrame, stdin } = render(<App report={withEntries()} />);
    stdin.write("\t"); // Tab
    await new Promise((resolve) => setTimeout(resolve, 60));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("data.warc.gz"); // tree leaf
    expect(frame).toContain("└──"); // §5.1 connector
    expect(frame).toContain("✗"); // compact status icon (error issue / missing)
    expect(frame).not.toContain("datapackage/resource-hashes");
  });

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
          message: 'datapackage.json is missing the "profile" field',
          params: { entry: "datapackage.json" },
          location: { entry: "datapackage.json" },
        },
      ],
    });
    const { lastFrame, stdin } = render(<App report={report} />);
    stdin.write("\t"); // Tab → Layout、focus 0 = datapackage.json(root file）
    await new Promise((resolve) => setTimeout(resolve, 60));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("present"); // status
    expect(frame).toContain("DEFLATE"); // codecName(8)
    expect(frame).toContain("required by §5.2"); // expectedLabel(["wacz-spec"])
    expect(frame).toContain("datapackage/profile-required"); // ペインの issue rule
    expect(frame).toContain("field"); // 全文 message(word-wrap されても "field" は残る）
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
          message: "datapackage.json is missing",
          location: { entry: "datapackage.json" },
        },
      ],
    });
    const { lastFrame, stdin } = render(<App report={report} />);
    stdin.write("\t");
    await new Promise((resolve) => setTimeout(resolve, 60));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("MISSING"); // pane の status
    expect(frame).toContain("wacz/required-files"); // pane の issue rule
  });
});
