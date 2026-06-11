/**
 * entry-preview の純ロジック(gzip 展開・テキスト/バイナリ判定・cap 打ち切り)のテスト。
 * 実 WACZ を要さず zlib で作った Buffer で完結するので常時走る(corpus 不要)。
 */
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { gunzipCapped, isGzip, previewEntry } from "../src/entry-preview.js";

const CAP = 64 * 1024;

describe("entry-preview", () => {
  it("isGzip: gzip マジックを検出する", () => {
    expect(isGzip(gzipSync(Buffer.from("hello")))).toBe(true);
    expect(isGzip(Buffer.from("hello"))).toBe(false);
  });

  it("gunzipCapped: 展開して元に戻る(multibyte 込み)", async () => {
    const { data, truncated } = await gunzipCapped(gzipSync(Buffer.from("あいうえお WARC")), CAP);
    expect(data.toString("utf-8")).toBe("あいうえお WARC");
    expect(truncated).toBe(false);
  });

  it("gunzipCapped: cap を超えたら truncated で打ち切る", async () => {
    const big = Buffer.alloc(10_000, 0x61); // 'a' * 10000
    const { data, truncated } = await gunzipCapped(gzipSync(big), 1000);
    expect(data.length).toBe(1000);
    expect(truncated).toBe(true);
  });

  it("previewEntry: gzip テキストは展開して kind:text(gunzipped)", async () => {
    const res = await previewEntry("rec.warc.gz", gzipSync(Buffer.from("WARC/1.0\r\nfoo")), CAP);
    expect(res.kind).toBe("text");
    if (res.kind === "text") {
      expect(res.content).toContain("WARC/1.0");
      expect(res.gunzipped).toBe(true);
    }
  });

  it("previewEntry: WARC(テキストヘッダ + バイナリボディ)はヘッダ部を見せて truncated", async () => {
    const header = `WARC/1.0\r\nWARC-Type: response\r\nContent-Type: application/http\r\n\r\n`;
    const body = Buffer.from([0x00, 0xff, 0xfe, 0x00, 0x01]); // バイナリボディ(NUL 入り)
    const warc = Buffer.concat([Buffer.from(header), body]);
    const res = await previewEntry("rec.warc.gz", gzipSync(warc), CAP);
    expect(res.kind).toBe("text");
    if (res.kind === "text") {
      expect(res.content).toContain("WARC-Type: response");
      expect(res.content).not.toContain("�"); // 文字化けしない
      expect(res.truncated).toBe(true); // バイナリボディは切られている
    }
  });

  it("previewEntry: 非テキスト(NUL が即出現)は kind:binary でサイズだけ", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]);
    const res = await previewEntry("img.png", png, CAP);
    expect(res.kind).toBe("binary");
    if (res.kind === "binary") expect(res.byteLength).toBe(png.length);
  });

  it("previewEntry: gzip の中身がバイナリなら kind:binary", async () => {
    const res = await previewEntry("blob.gz", gzipSync(Buffer.from([0x00, 0x01, 0x02, 0x00])), CAP);
    expect(res.kind).toBe("binary");
  });

  it("previewEntry: 非 gzip のテキストは従来どおり kind:text(gunzipped=false)", async () => {
    const res = await previewEntry("pages.jsonl", Buffer.from('{"url":"https://example.com"}\n'), CAP);
    expect(res.kind).toBe("text");
    if (res.kind === "text") {
      expect(res.gunzipped).toBe(false);
      expect(res.content).toContain("example.com");
    }
  });

  it("previewEntry: .json は pretty-print される", async () => {
    const res = await previewEntry("datapackage.json", Buffer.from('{"profile":"data-package"}'), CAP);
    expect(res.kind).toBe("text");
    if (res.kind === "text") expect(res.content).toContain('"profile": "data-package"');
  });

  it("previewEntry: 壊れた gzip は落とさず binary 扱い", async () => {
    const fake = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x99, 0x99, 0x99]); // magic だけ
    const res = await previewEntry("broken.gz", fake, CAP);
    expect(res.kind).toBe("binary");
  });
});
