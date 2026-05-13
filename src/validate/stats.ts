/**
 * Best-effort `ReportStats` computation.
 *
 * Runs alongside the validation rules so the renderer can show humans a
 * "42 records · 4.8 MB · 3 hosts" footer for context. We deliberately
 * isolate this from the rule registry: a stats-extraction failure
 * (malformed WARC, unreadable CDXJ) must NOT block the report, and a
 * stats success must NOT contribute issues. So we return `undefined` on
 * any internal error and let the renderer omit the footer.
 *
 * `archive/data.warc.gz` may be absent (some experimental WACZ variants
 * separate WARC bytes into multiple files); we report what we can.
 */
import { parseCdxj } from "../wacz/cdxj-parser.js";
import type { WaczReader } from "../wacz/reader.js";
import { iterateWarcMembers } from "../wacz/warc-iter.js";
import type { ReportStats } from "./types.js";

const WARC_ENTRY = "archive/data.warc.gz";
const CDXJ_ENTRY = "indexes/index.cdxj";

export const computeStats = async (wacz: WaczReader): Promise<ReportStats | undefined> => {
  try {
    const warcBuf = await wacz.readEntry(WARC_ENTRY);
    if (!warcBuf) return undefined;

    let count = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const _ of iterateWarcMembers(warcBuf, { loose: true })) count += 1;

    const cdxjBuf = await wacz.readEntry(CDXJ_ENTRY);
    const hosts = new Set<string>();
    if (cdxjBuf) {
      const { entries } = parseCdxj(cdxjBuf.toString("utf-8"));
      for (const entry of entries) {
        const url = entry.fields["url"];
        if (typeof url !== "string") continue;
        try {
          // `new URL` rejects opaque schemes (about:, blob:, …) — those
          // are not "hosts" in any operationally useful sense, so we
          // skip rather than include the URL verbatim.
          hosts.add(new URL(url).hostname);
        } catch {
          // skip
        }
      }
    }

    return {
      warcRecordCount: count,
      warcArchiveBytes: warcBuf.byteLength,
      hosts: Array.from(hosts).sort(),
    };
  } catch {
    return undefined;
  }
};
