/**
 * Rule: cdxj/warc-offsets
 *
 * 各 CDXJ entry は `offset` / `length` field を持ち、これが
 * `archive/data.warc.gz` 内の WARC record の byte range を指す。両方
 * とも valid な整数文字列で、かつ independent な gzip member 境界に
 * 正確に当たる必要がある — そうでないと offset で seek する replay
 * ツールは garbage を fetch して silent に "Archived Page Not Found"
 * を返す。
 *
 * Spec / 慣習: pywb / wacz-creator は offset / length を decimal で
 *       文字列化する。wabac.js の CDXJ loader は文字列と数値の両方を
 *       parse するので、producer 側はどちらでも自由。
 * Reference producer: browserhive の `src/storage/wacz/cdxj.ts` は
 *       文字列として出力する。
 *
 * クロスチェック戦略:
 *   1. 既存の `iterateWarcMembers` で WARC を辿り、すべての
 *      (offset, length) ペアを map に集める。
 *   2. `filename` が `data.warc.gz` に解決される CDXJ entry ごとに
 *      `offset` / `length` を parse し、member を lookup。
 *   3. 不一致 → error。CDXJ の行番号と、近傍の候補 member (operator
 *      が corruption を目視できるよう) を付ける。
 *
 * `filename === "data.warc.gz"` の entry だけが対象 — 他の filename は
 * WACZ が同梱しない別ファイルを指していて、`archive/` プレフィックスの
 * ミスは別 rule (filename-archive-relative、M1) が既に cover している。
 */
import { ok } from "../../result.js";
import { parseCdxj } from "../../wacz/cdxj-parser.js";
import { parseWarcRecord } from "../../wacz/warc-header.js";
import {
  WarcMemberDecodeError,
  iterateWarcMembers,
  type WarcMember,
} from "../../wacz/warc-iter.js";
import type { Issue, ValidationRule } from "../types.js";

const CDXJ_ENTRY = "indexes/index.cdxj";
const WARC_ENTRY = "archive/data.warc.gz";
const EXPECTED_FILENAME = "data.warc.gz";

export const cdxjWarcOffsetsRule: ValidationRule = {
  name: "cdxj/warc-offsets",
  description: `${CDXJ_ENTRY} offset/length must land on a WARC gzip-member boundary`,
  severity: "error",
  applicability: {
    severityByProfile: { lenient: "warning" },
  },

  run: async (wacz) => {
    const issues: Issue[] = [];

    const cdxjBuf = await wacz.readEntry(CDXJ_ENTRY);
    const warcBuf = await wacz.readEntry(WARC_ENTRY);
    if (!cdxjBuf || !warcBuf) return ok(issues); // 不在は他 rule が報告する。

    // `loose: true` にしているのは、warc/members-independent rule が
    // 既に rich な context つきで decode 失敗を報告するため。member
    // 1 つの不良で offset check を short-circuit させて、他の CDXJ
    // 行の visibility を失うのを避けたい。
    let members: WarcMember[];
    try {
      members = Array.from(iterateWarcMembers(warcBuf, { loose: true }));
    } catch (error) {
      if (error instanceof WarcMemberDecodeError) return ok(issues);
      throw error;
    }
    const byOffset = new Map<number, WarcMember>();
    for (const m of members) byOffset.set(m.offset, m);

    const { entries } = parseCdxj(cdxjBuf.toString("utf-8"));
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (!entry) continue;
      const filename = entry.fields["filename"];
      if (filename !== EXPECTED_FILENAME) continue;

      const offsetField = entry.fields["offset"];
      const lengthField = entry.fields["length"];
      const offset = parseIntOrUndef(offsetField);
      const length = parseIntOrUndef(lengthField);

      const line = i + 1;
      if (offset === undefined || length === undefined) {
        issues.push({
          rule: "cdxj/warc-offsets",
          severity: "error",
          message: `${CDXJ_ENTRY} line ${String(line)}: offset / length missing or not numeric`,
          location: { entry: CDXJ_ENTRY, line },
          details: { offset: offsetField, length: lengthField },
        });
        continue;
      }

      const member = byOffset.get(offset);
      if (!member) {
        // 候補には WARC-Type header を付けて、operator が CDXJ 行が
        // それらしい record を指しているか一目で分かるようにする。
        // 全 member を dump せず近接の 2 〜 3 件だけ sniff して、
        // 詳細ブロックを読める長さに保つ。
        const candidates = members
          .map((m) => ({
            offset: m.offset,
            length: m.length,
            warcHeader: snippetHeader(m),
          }))
          .slice(0, 3);
        issues.push({
          rule: "cdxj/warc-offsets",
          severity: "error",
          message: `${CDXJ_ENTRY} line ${String(line)}: offset ${String(offset)} does not match any WARC gzip-member start`,
          location: { entry: CDXJ_ENTRY, line, offset },
          details: {
            requested: { offset, length },
            candidates,
          },
        });
        continue;
      }
      if (member.length !== length) {
        issues.push({
          rule: "cdxj/warc-offsets",
          severity: "error",
          message: `${CDXJ_ENTRY} line ${String(line)}: length ${String(length)} does not match WARC member at offset ${String(offset)} (actual ${String(member.length)})`,
          location: { entry: CDXJ_ENTRY, line, offset },
          details: {
            expected: { offset, length },
            actual: { offset: member.offset, length: member.length },
            // この offset に実在する record の完全な header block。
            // CDXJ 側 length のずれが header バグなのか、WARC が
            // 書き換えられたのかを operator が判別できる。
            warcHeader: snippetHeader(member),
          },
        });
      }
    }

    return ok(issues);
  },
};

/**
 * member の decode 済み bytes から正式な WARC header 行 (protocol +
 * Key:Value 行、blank line 区切りを除いたもの) を抜き出す。
 * issue.details に入れて、TUI の warcHeader view が「CDXJ 行が指し
 * 示した先には実際にはどの record があるか」を併記できるようにする。
 */
const snippetHeader = (member: WarcMember): string[] => {
  const record = parseWarcRecord(member.raw);
  if (!record) return [];
  const lines: string[] = [];
  if (record.protocol !== undefined) lines.push(record.protocol);
  for (const h of record.headers) {
    lines.push(`${h.name}: ${h.value}`);
  }
  return lines;
};

const parseIntOrUndef = (raw: unknown): number | undefined => {
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) return raw;
  if (typeof raw !== "string") return undefined;
  // CDXJ の慣習は decimal。非数字を含むなら reject — hex 風の
  // offset が間違った member と silent に match するのを防ぐ。
  if (!/^\d+$/.test(raw)) return undefined;
  return Number.parseInt(raw, 10);
};
