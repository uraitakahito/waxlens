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
import { EventEmitter } from "node:events";
import { render } from "ink-testing-library";
import { render as inkRender } from "ink";
import { describe, expect, it } from "vitest";
import type { ReactElement } from "react";
import type { AbsolutePath, ExpectedBy, ReadEntryResult, WireReport } from "@waxlens/protocol";
import { App } from "../src/app.js";

/**
 * 端末サイズ(columns × rows)を明示して App を描く小さなハーネス。
 * ink-testing-library の stdout は rows を持たず、Ink の getWindowSize が実端末サイズ
 * (terminal-size)へフォールバックする。「frame ≤ 端末行数」を決定論的に検証するには
 * rows を固定する必要があるので、ink 本体の render に固定サイズの stdout を渡す。
 */
class FakeOut extends EventEmitter {
  readonly columns: number;
  readonly rows: number;
  last = "";
  constructor(columns: number, rows: number) {
    super();
    this.columns = columns;
    this.rows = rows;
  }
  write = (frame: string): void => {
    this.last = frame;
  };
}
/** Ink が stdin に対して呼ぶが、テストでは何もしなくてよいメソッド群の共有 no-op。 */
const noop = (): void => {
  /* unused stdin stub */
};
class FakeIn extends EventEmitter {
  isTTY = true;
  data: string | null = null;
  setEncoding = noop;
  setRawMode = noop;
  resume = noop;
  pause = noop;
  ref = noop;
  unref = noop;
  read = (): string | null => {
    const d = this.data;
    this.data = null;
    return d;
  };
  write = (d: string): void => {
    this.data = d;
    this.emit("readable");
    this.emit("data", d);
  };
}
const renderAt = (
  columns: number,
  rows: number,
  el: ReactElement,
): { stdin: FakeIn; lastFrame: () => string; unmount: () => void } => {
  const stdout = new FakeOut(columns, rows);
  const stdin = new FakeIn();
  const instance = inkRender(el, {
    stdout: stdout as never,
    stderr: new FakeOut(columns, rows) as never,
    stdin: stdin as never,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return { stdin, lastFrame: (): string => stdout.last, unmount: instance.unmount };
};

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
  it("renders all issue rule names and the summary", async () => {
    const { lastFrame } = render(<App report={makeReport()} />);
    // ビューポートは useBoxMetrics で高さを実測してから可視ぶんを描くので、初回 layout
    // パスが終わるまで 1 tick 待つ(以降のスクロール系テストも同様)。
    await new Promise((resolve) => setTimeout(resolve, 60));
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

  it("長いファイル名でも端末幅(100)を超えない(左ツリーが折り返さない)", async () => {
    // ink-testing-library は columns=100 固定。100 桁超のファイル名を入れ、左ツリーが
    // maxWidth で頭打ちされて端末幅を超えない(=折り返して崩れない)ことを確かめる。
    const longName = `archive/rec-${"0".repeat(90)}.warc.gz`;
    const report = makeReport({
      entries: [
        {
          path: longName,
          present: true,
          uncompressedSize: 100,
          compressionMethod: 0,
          expectedBy: ["datapackage"],
          issues: [],
        },
      ],
    });
    const { lastFrame, stdin } = render(<App report={report} />);
    stdin.write("\t"); // → Layout
    await new Promise((resolve) => setTimeout(resolve, 60));
    const max = Math.max(...(lastFrame() ?? "").split("\n").map((l) => l.length));
    expect(max).toBeLessThanOrEqual(100);
  });
});

describe("tui — content view (実測スクロール)", () => {
  // ルート直下のファイル 1 つ。tab→Layout 直後の focus=0 がこのファイル行になる。
  const reportWithFile = (): WireReport =>
    makeReport({
      entries: [
        {
          path: "data.warc.gz",
          present: true,
          uncompressedSize: 92700,
          compressionMethod: 0,
          expectedBy: ["datapackage"],
          issues: [],
        },
      ],
    });

  const warcText =
    "WARC/1.0\nWARC-Type: response\nWARC-Target-URI: https://en.wikipedia.org/wiki/World_Wide_Web";
  const requestContent = (): Promise<ReadEntryResult> =>
    Promise.resolve({ kind: "text", content: warcText, truncated: false, gunzipped: true });

  const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 60));

  it("Layout で enter: 全幅 content view に開く(ツリーは消える)", async () => {
    const { lastFrame, stdin } = render(
      <App report={reportWithFile()} requestContent={requestContent} />,
    );
    stdin.write("\t"); // → Layout
    await tick();
    stdin.write("\r"); // enter → 全幅 content view(取得 + 遷移)
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("content (gzip 展開)"); // content ビューのヘッダ
    expect(frame).toContain("WARC/1.0"); // 内容(スクロール窓内)
    expect(frame).not.toContain("data.warc.gz"); // ツリーは別ビューなので描かれない
  });

  it("content view で esc: Layout に戻る", async () => {
    const { lastFrame, stdin } = render(
      <App report={reportWithFile()} requestContent={requestContent} />,
    );
    stdin.write("\t");
    await tick();
    stdin.write("\r"); // → content view
    await tick();
    stdin.write(""); // esc → Layout
    await tick();
    expect(lastFrame() ?? "").toContain("data.warc.gz"); // ツリーが戻る
  });

  it("content をスクロールできる(G で末尾へ・先頭行が窓から外れる)", async () => {
    const many = Array.from({ length: 100 }, (_, i) => `row-${String(i).padStart(3, "0")}`).join("\n");
    const reqMany = (): Promise<ReadEntryResult> =>
      Promise.resolve({ kind: "text", content: many, truncated: false, gunzipped: true });
    const { lastFrame, stdin } = render(<App report={reportWithFile()} requestContent={reqMany} />);
    stdin.write("\t");
    await tick();
    stdin.write("\r"); // → content view(先頭行が窓内)
    await tick();
    expect(lastFrame() ?? "").toContain("row-000");
    stdin.write("G"); // 末尾へジャンプ
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("row-099"); // 末尾行が見える
    expect(frame).not.toContain("row-000"); // 先頭行は窓から外れた
  });

  // どの端末高でも、Layout でも content(100 行ロード)でも、App のフレーム行数が
  // 端末行数を超えないこと(=Ink の縦はみ出し崩れが起きない)を、rows を固定して検証。
  // ※ ink-testing-library は rows を持たず実端末サイズへフォールバックするので renderAt を使う。
  for (const rows of [20, 30, 50]) {
    it(`端末 ${String(rows)} 行: App はその行数を超えない`, async () => {
      const many = Array.from({ length: 100 }, (_, i) => `line-${String(i)}`).join("\n");
      const reqMany = (): Promise<ReadEntryResult> =>
        Promise.resolve({ kind: "text", content: many, truncated: false, gunzipped: true });
      const { lastFrame, stdin, unmount } = renderAt(
        120,
        rows,
        <App report={reportWithFile()} requestContent={reqMany} />,
      );
      stdin.write("\t"); // → Layout
      await tick();
      const layoutH = lastFrame().split("\n").length;
      stdin.write("\r"); // → content view(100 行ロード)
      await tick();
      const contentH = lastFrame().split("\n").length;
      unmount();
      expect(layoutH).toBeLessThanOrEqual(rows);
      expect(contentH).toBeLessThanOrEqual(rows);
    });
  }
});

describe("tui — layout view: 右枠の幅はコンテンツに依存しない", () => {
  // 枠線 ─ の最長連続数 = 枠の内側幅。端末幅が同じなら短/長メタで一致するはず。
  const boxWidth = (frame: string): number =>
    Math.max(0, ...frame.split("\n").map((l) => (l.match(/─/g) ?? []).length));

  const reportWith = (path: string, expectedBy: ExpectedBy[]): WireReport =>
    makeReport({
      entries: [{ path, present: true, uncompressedSize: 10, compressionMethod: 0, expectedBy, issues: [] }],
    });

  const widthAfterTab = async (report: WireReport): Promise<number> => {
    const { stdin, lastFrame, unmount } = renderAt(120, 24, <App report={report} />);
    stdin.write("\t"); // → Layout
    await new Promise((resolve) => setTimeout(resolve, 60)); // 実測 layout パス待ち
    const w = boxWidth(lastFrame());
    unmount();
    return w;
  };

  it("短いメタと長いメタで右枠の横幅が一致する(端末幅 120 固定)", async () => {
    const wShort = await widthAfterTab(reportWith("a.json", []));
    const wLong = await widthAfterTab(reportWith("data.warc.gz", ["datapackage"]));
    expect(wShort).toBeGreaterThan(0);
    expect(wShort).toBe(wLong); // 改修前: 22 ≠ 36 で失敗 / 改修後: 一致
  });
});
