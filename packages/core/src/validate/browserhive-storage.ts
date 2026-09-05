/**
 * `browserhive:capture.storage` と `storage/origins.jsonl` を読むための共有部分。
 *
 * 2 つの rule が同じものを読む —— 目録が在って形が合っているか
 * (`browserhive/storage-inventory`) と、値のファイルが在るならその形と目録との
 * 整合が取れているか (`browserhive/storage-shape`)。読み取りをここに集め、
 * rule 側は「何を問題とするか」だけを持つ。
 *
 * `tls` と違い、目録は profile 1.1.0 の **MUST**。したがって不在は違反であって、
 * 「何も言うことがない」ではない —— `readStorage` が `null` を返す意味も、
 * あちらとは逆になる。
 *
 * Spec: https://uraitakahito.github.io/browserhive-specs/wacz-profile/1.1.0/#storage
 */
import { parseDatapackage } from "../wacz/datapackage.js";
import type { WaczReader } from "../wacz/reader.js";

/** 値のファイル。目録が `valuesRecorded: true` のときだけ在る。 */
export const STORAGE_ENTRY = "storage/origins.jsonl";

/** この版が期待する profile の綴り。producer が規則を変えたらここも変わる。 */
export const EXPECTED_STORAGE_PROFILE = "browserhive:storage/1";

/** この版が規範として固定している stage。 */
export const EXPECTED_STORAGE_STAGE = "after-behaviors";

/** 目録が必ず持つ member。 */
export const INVENTORY_MEMBERS = [
  "profile",
  "stage",
  "valuesRecorded",
  "origins",
] as const;

/** 値のファイルの各行が必ず持つ member。 */
export const VALUE_LINE_MEMBERS = [
  "profile",
  "origin",
  "takenAt",
  "stage",
  "areas",
] as const;

/** 1 area の形。値は持たない。 */
export interface AreaShape {
  readonly keys?: unknown;
  readonly bytes?: unknown;
  readonly digest?: unknown;
}

export interface OriginShape {
  readonly origin?: unknown;
  readonly local?: unknown;
  readonly session?: unknown;
  readonly unreadable?: unknown;
}

export interface StorageInventory {
  readonly profile?: unknown;
  readonly stage?: unknown;
  readonly valuesRecorded?: unknown;
  readonly origins?: unknown;
}

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** `sha256:` + 小文字 16 進 64 桁。profile が定める形。 */
export const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

/**
 * `datapackage.json` から `browserhive:capture` を取り出す。
 *
 * `undefined` は「browserhive のアーカイブではない / datapackage が読めない」。
 * その場合、この profile の MUST を当てる相手がそもそも居ない。
 */
export const readCapture = async (
  wacz: WaczReader,
): Promise<Record<string, unknown> | undefined> => {
  const raw = await wacz.readEntry("datapackage.json");
  if (raw === undefined) return undefined;
  const dp = parseDatapackage(raw.toString("utf8"));
  if (dp === null) return undefined;
  const capture = (dp as Record<string, unknown>)["browserhive:capture"];
  return isRecord(capture) ? capture : undefined;
};

/**
 * 値のファイルを 1 行ずつ。無ければ `null` (在ることを求めるのは呼び出し側の判断)。
 *
 * 行番号を添えるのは、落ちたときにどの行かを名指しするため —— JSON の
 * `Unexpected token` だけでは、10 万行のうちどこかが分からない。
 */
export const readStorageValues = async (
  wacz: WaczReader,
): Promise<{ lineNumber: number; parsed: Record<string, unknown> | null }[] | null> => {
  const raw = await wacz.readEntry(STORAGE_ENTRY);
  if (raw === undefined) return null;
  return raw
    .toString("utf8")
    .split("\n")
    .map((line, i) => ({ line: line.trim(), lineNumber: i + 1 }))
    .filter((x) => x.line.length > 0)
    .map(({ line, lineNumber }) => {
      try {
        const parsed: unknown = JSON.parse(line);
        return { lineNumber, parsed: isRecord(parsed) ? parsed : null };
      } catch {
        return { lineNumber, parsed: null };
      }
    });
};
