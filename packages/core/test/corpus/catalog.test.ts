// @module-tag corpus
/**
 * renderCatalog / injectCatalog の単体テスト。
 *
 * inline の小さな manifest を使うので `CORPUS_DIR` も実 WACZ も不要 —
 * 通常の `pnpm check` (= vitest run) で常時走り、カタログ生成ロジックの
 * 退行を常設で捕まえる。corpus 実体に対する end-to-end な検証は
 * build-docs.test.ts (CORPUS_DIR 必須・CI 限定) の責務。
 */
import { describe, expect, it } from "vitest";
import { injectCatalog, renderCatalog, type Manifest } from "./catalog.js";

const MANIFEST: Manifest = {
  defaultProfile: "spec",
  fixtures: [
    {
      file: "fixtures/good.wacz",
      description: "全 rule を pass する正常系 WACZ",
      $schema: null,
      expect: { valid: true, issues: [] },
    },
    {
      file: "fixtures/wacz-missing-archive.wacz",
      description: "archive/ に WARC が無い (§5.2.1)",
      $schema: null,
      expect: { valid: false, issues: [{ rule: "wacz/required-files", severity: "error" }] },
    },
    {
      // 実 corpus には `$schema` を宣言する標本がまだ 1 つも無い。列が実際に
      // レンダリングされることは、ここで押さえておかないとどこでも通らない。
      file: "fixtures/good-webrecorder.wacz",
      description: "webrecorder producer の正常系",
      $schema: "https://datapackage.org/profiles/2.0/datapackage.json",
      byProfile: {
        spec: { valid: true, issues: [{ rule: "cdxj/index-not-gzipped", severity: "warning" }] },
        browserhive: {
          valid: false,
          issues: [{ rule: "cdxj/index-not-gzipped", severity: "error" }],
        },
        lenient: { valid: true, issues: [{ rule: "cdxj/index-not-gzipped", severity: "info" }] },
      },
    },
  ],
};

describe("renderCatalog", () => {
  const md = renderCatalog(MANIFEST);

  it("正常系は発火 rule が — / exit 0", () => {
    // — が 2 つ並ぶ: $schema 無し、発火 rule 無し。
    expect(md).toContain("| `good.wacz` | 全 rule を pass する正常系 WACZ | — | — | 0 |");
  });

  it("error issue を持つ標本は rule(severity) / exit 1", () => {
    expect(md).toContain(
      "| `wacz-missing-archive.wacz` | archive/ に WARC が無い (§5.2.1) | — | `wacz/required-files` (error) | 1 |",
    );
  });

  it("宣言された $schema はコードスパンで出る", () => {
    expect(md).toContain("| `https://datapackage.org/profiles/2.0/datapackage.json` |");
  });

  it("byProfile 標本は spec を主表に、3 profile を差分表に出す", () => {
    // 主表は spec profile 代表 (valid=true → exit 0)
    expect(md).toContain("| `good-webrecorder.wacz` |");
    // 差分表に rule ごとの spec/browserhive/lenient severity
    expect(md).toContain(
      "| `good-webrecorder.wacz` | `cdxj/index-not-gzipped` | warning | error | info |",
    );
  });

  it("2 つの見出しを持つ", () => {
    expect(md).toContain("### 全標本(`spec` profile)");
    expect(md).toContain("### profile で severity が変わる標本");
  });
});

describe("injectCatalog", () => {
  const doc =
    "前書き\n\n<!-- BEGIN corpus-catalog (generated — do not edit) -->\n古い中身\n<!-- END corpus-catalog -->\n\n後書き\n";

  it("マーカー間だけを差し替え、前後とマーカーは温存する", () => {
    const out = injectCatalog(doc, "新しい本文");
    expect(out).toContain("前書き");
    expect(out).toContain("後書き");
    expect(out).toContain("<!-- BEGIN corpus-catalog (generated — do not edit) -->");
    expect(out).toContain("<!-- END corpus-catalog -->");
    expect(out).toContain("新しい本文");
    expect(out).not.toContain("古い中身");
  });

  it("同じ本文の再注入は冪等", () => {
    const once = injectCatalog(doc, "本文");
    expect(injectCatalog(once, "本文")).toBe(once);
  });

  it("マーカーが無ければ throw する (silent 上書きしない)", () => {
    expect(() => injectCatalog("マーカー無しの doc", "x")).toThrow(/マーカー/);
  });
});
