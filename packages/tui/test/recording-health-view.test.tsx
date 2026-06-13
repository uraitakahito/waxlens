/**
 * Recording health パネル(案3)の描画テスト。
 *
 * `ExpandedDetails` に `details.recording` を渡すと、棒・件数・サンプル URL を
 * 描く専用ビューが出ることを検証する。`warc/recording-complete`(案1)が載せる
 * details 形を入力にする。
 */
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { ExpandedDetails } from "../src/app.js";

describe("Recording health panel", () => {
  const recording = {
    responses: 259,
    incomplete: 49,
    percent: 16,
    byReason: { failed: 23, incomplete: 26, truncated: 0, blocked: 0 },
    samples: [{ url: "https://amazon-adsystem.com/x", reason: "failed" }],
  };

  it("renders the header, incomplete count, and percent from details.recording", () => {
    const { lastFrame } = render(<ExpandedDetails details={{ recording }} />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Recording health");
    expect(frame).toContain("49");
    expect(frame).toContain("16%");
  });

  it("does not dump recording as raw JSON (it is consumed by the panel)", () => {
    const { lastFrame } = render(<ExpandedDetails details={{ recording }} />);
    // 専用ビューが消費するので、生 JSON の "responses": 259 は出ない。
    expect(lastFrame() ?? "").not.toContain('"responses": 259');
  });
});
