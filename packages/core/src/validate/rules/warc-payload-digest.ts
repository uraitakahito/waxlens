/**
 * Rule: warc/payload-digest
 *
 * `WARC-Payload-Digest` header は record の payload bytes に対する
 * 新しい SHA-256 と一致する必要がある。"Payload" は WARC 1.1 spec
 * §6.2 に従って record type ごとに異なる:
 *
 *   - response / request:  HTTP entity body (内側の `\r\n\r\n` 区切り
 *                          の後の bytes)
 *   - warcinfo / metadata: record body をそのまま
 *   - resource:            record body をそのまま
 *   - revisit:             ここでは意図的にチェックしない — revisit
 *                          record は他 record の digest を再記述する
 *                          だけで自身に payload を持たないため、
 *                          local な sha が当てはまらない
 *
 * digest フォーマットは `sha256:<BASE32>` (RFC 4648、uppercase、
 * padding なし)。他のアルゴリズム (`sha1:...` 等) を emit する
 * producer は warning ではなく info レベルの note として受け入れる。
 * spec が任意の `algorithm:value` を許容しており、waxlens は
 * spec-coverage suite ではないため。
 *
 * Severity: `warning`。replay ツールは lookup 時に digest を再検証
 * しないのが普通なので、不一致はユーザ可視な挙動を壊さない — ただし
 * producer が response を記録した後で WARC bytes が変更された
 * シグナルにはなり、ほぼ常に corruption。
 */
import { ok } from "../../result.js";
import { formatHexLines } from "../../render/hex.js";
import { sha256Base32 } from "../../wacz/digest.js";
import { getHeader, httpEntityBody, parseWarcRecord } from "../../wacz/warc-header.js";
import { iterateWarcMembers } from "../../wacz/warc-iter.js";
import type { Issue, ValidationRule } from "../types.js";

const WARC_ENTRY = "archive/data.warc.gz";

/**
 * `WARC-Payload-Digest` が record body をそのまま digest 対象にする
 * record type。それ以外は HTTP entity スライスを使う (response/request)
 * か、意味のある local payload を持たない (revisit)。
 */
const BODY_VERBATIM_TYPES = new Set(["warcinfo", "metadata", "resource"]);

export const warcPayloadDigestRule: ValidationRule = {
  name: "warc/payload-digest",
  description: `WARC records' WARC-Payload-Digest must match a fresh sha256 of the payload`,
  severity: "warning",

  run: async (wacz) => {
    const issues: Issue[] = [];
    const warcBuf = await wacz.readEntry(WARC_ENTRY);
    if (!warcBuf) return ok(issues); // 不在は resource-hashes が cover する。

    let memberIdx = 0;
    for (const member of iterateWarcMembers(warcBuf, { loose: true })) {
      memberIdx += 1;
      const record = parseWarcRecord(member.raw);
      if (!record) continue;

      const recordType = (getHeader(record, "WARC-Type") ?? "").toLowerCase();
      const declared = getHeader(record, "WARC-Payload-Digest");
      if (declared === undefined) continue; // spec 上 optional。

      if (recordType === "revisit") continue; // header コメント参照。

      // sha256 以外のアルゴリズムは spec で許容される。rule は
      // informational にこれを表面化して、当該行は不一致ではなく
      // 未検証なのだと operator が把握できるようにする。
      if (!declared.toLowerCase().startsWith("sha256:")) {
        issues.push({
          rule: "warc/payload-digest",
          severity: "info",
          message: `WARC record #${String(memberIdx)} uses non-sha256 digest "${declared.split(":")[0] ?? ""}" — not verified`,
          location: { entry: WARC_ENTRY, offset: member.offset },
          details: { recordType, declared },
        });
        continue;
      }

      const payload = BODY_VERBATIM_TYPES.has(recordType) ? record.body : httpEntityBody(record);
      if (payload === null) {
        issues.push({
          rule: "warc/payload-digest",
          severity: "warning",
          message: `WARC record #${String(memberIdx)} (${recordType || "unknown"}) has WARC-Payload-Digest but no parseable HTTP body`,
          location: { entry: WARC_ENTRY, offset: member.offset },
          details: { recordType, declared },
        });
        continue;
      }

      const computed = sha256Base32(payload);
      if (computed.toUpperCase() !== declared.toUpperCase()) {
        issues.push({
          rule: "warc/payload-digest",
          severity: "warning",
          message: `WARC record #${String(memberIdx)} payload digest mismatch`,
          location: { entry: WARC_ENTRY, offset: member.offset },
          details: {
            recordType,
            expected: declared,
            actual: computed,
            payloadBytes: payload.byteLength,
            // payload 先頭 256 bytes の hex dump — operator が record
            // の運ぶはずのリソース (HTML? image? 全ゼロ pad?) として
            // 妥当に見えるかを目視確認できる。TUI 側の hex viewer が
            // この field を消費する。
            hexPreview: formatHexLines(payload),
          },
        });
      }
    }

    return ok(issues);
  },
};
