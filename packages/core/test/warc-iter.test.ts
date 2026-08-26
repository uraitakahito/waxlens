// @module-tag warc
/**
 * `iterateWarcMembers` のテスト。
 *
 * この iterator は WACZ の検証の土台で、`warc/members-independent`・
 * `cdxj/warc-offsets`・`warc/recording-complete`・`validate/stats` が全部これを
 * 通る。ここが 1 つメンバを取り違えると、その先の rule が揃って誤った Issue を
 * 出す —— 実際に 9 MB の WACZ で 573 件の誤りが出た。
 *
 * 中心にあるのは 1 つの落とし穴: **gzip の magic (`1f 8b 08`) は圧縮データの
 * 中にも偶然現れる**。境界を magic の位置から推測すると、その偽の位置が
 * *直前の本物のメンバ* を途中で切り、切られたほうが復号に失敗する。頻度は
 * 9 MB あたりおよそ 1 個で、1 個で足りる。
 */
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { iterateWarcMembers, WarcMemberDecodeError } from "../src/wacz/warc-iter.js";

/** WARC のレコード 1 本を、それ自身で完結した gzip メンバにする。 */
const member = (body: Buffer | string, level?: number): Buffer =>
  gzipSync(Buffer.from(body), level === undefined ? {} : { level });

const record = (type: string, extra: Buffer = Buffer.alloc(0)): Buffer =>
  Buffer.concat([
    Buffer.from(`WARC/1.1\r\nWARC-Type: ${type}\r\nContent-Length: 0\r\n\r\n`),
    extra,
    Buffer.from("\r\n\r\n"),
  ]);

describe("iterateWarcMembers", () => {
  it("連結されたメンバを 1 本ずつ返す", () => {
    const warc = Buffer.concat([
      member(record("warcinfo")),
      member(record("request")),
      member(record("response")),
    ]);

    const members = [...iterateWarcMembers(warc)];

    expect(members).toHaveLength(3);
    expect(members[0]!.offset).toBe(0);
    expect(members[0]!.raw.toString()).toContain("WARC-Type: warcinfo");
    expect(members[2]!.raw.toString()).toContain("WARC-Type: response");
  });

  it("offset と length が実際の境界に一致する", () => {
    const first = member(record("warcinfo"));
    const second = member(record("response"));
    const warc = Buffer.concat([first, second]);

    const members = [...iterateWarcMembers(warc)];

    expect(members.map((m) => [m.offset, m.length])).toEqual([
      [0, first.length],
      [first.length, second.length],
    ]);
    // 最後のメンバの終端がファイル長と一致する —— 走査に取りこぼしが無いこと。
    expect(members.at(-1)!.offset + members.at(-1)!.length).toBe(warc.length);
  });

  it("圧縮データの中に現れる gzip の magic に騙されない", () => {
    // `level: 0` は deflate の *stored* ブロックを使わせるので、本文のバイトが
    // そのまま圧縮後にも出る。これが無いと `1f 8b 08` は圧縮で潰れてしまい、
    // このテストは何も確かめないまま緑になる。
    const withMagic = member(
      record("response", Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00])),
      0,
    );
    const warc = Buffer.concat([withMagic, member(record("request"))]);

    // 偽の magic が本当に圧縮後のバイト列に居ることを確かめてから本題に入る。
    let found = false;
    for (let i = 1; i + 2 < withMagic.length; i++) {
      if (withMagic[i] === 0x1f && withMagic[i + 1] === 0x8b && withMagic[i + 2] === 0x08) {
        found = true;
        break;
      }
    }
    expect(found, "fixture に偽の magic が入っていない").toBe(true);

    const members = [...iterateWarcMembers(warc)];

    expect(members).toHaveLength(2);
    expect(members[0]!.length).toBe(withMagic.length);
    expect(members[1]!.raw.toString()).toContain("WARC-Type: request");
  });

  describe("壊れた入力", () => {
    it("そもそも gzip で始まらないものは 0 本 —— throw ではない", () => {
      // 呼ぶ側 (`warc/members-independent`) は 0 本を `no-members` として報告する。
      // ここで throw すると、その経路が「復号に失敗した」に化けてしまう。
      expect([...iterateWarcMembers(Buffer.from("not gzip at all"))]).toHaveLength(0);
      expect([...iterateWarcMembers(Buffer.alloc(0))]).toHaveLength(0);
    });

    it("読めたところまでは返してから、続きのゴミで止まる (loose)", () => {
      const warc = Buffer.concat([member(record("warcinfo")), Buffer.from("garbage")]);

      const members = [...iterateWarcMembers(warc, { loose: true })];

      expect(members).toHaveLength(1);
      expect(members[0]!.raw.toString()).toContain("WARC-Type: warcinfo");
    });

    it("続きのゴミを strict では拒む", () => {
      const warc = Buffer.concat([member(record("warcinfo")), Buffer.from("garbage")]);

      expect(() => [...iterateWarcMembers(warc)]).toThrow(WarcMemberDecodeError);
    });

    it("途中で切れたメンバを strict では拒む", () => {
      const whole = member(record("response"));
      const truncated = whole.subarray(0, whole.length - 5);

      expect(() => [...iterateWarcMembers(truncated)]).toThrow(WarcMemberDecodeError);
    });

    it("trailer の CRC32 が合わない member を拒む", () => {
      // deflate の stream 自体は無傷なので、展開そのものは成功してしまう。
      // trailer を検めていなければ、この member は黙って通る。
      const whole = Buffer.from(member(record("response")));
      whole.writeUInt32LE(0xdeadbeef, whole.length - 8);

      expect(() => [...iterateWarcMembers(whole)]).toThrow(WarcMemberDecodeError);
    });

    it("trailer の ISIZE が合わない member を拒む", () => {
      const whole = Buffer.from(member(record("response")));
      whole.writeUInt32LE(999_999, whole.length - 4);

      expect(() => [...iterateWarcMembers(whole)]).toThrow(WarcMemberDecodeError);
    });
  });
});
