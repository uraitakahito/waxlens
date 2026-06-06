/**
 * waxlens-corpus の fixture 定義 (案 3 — flat fixtures + 中央 manifest)。
 *
 * 各エントリは「どう作るか (`options`)」 と「意図する違反 rule
 * (`expectRules`)」 を宣言する。 実際の違反 rule は build-corpus が
 * `runValidation` で確かめ、 `expectRules` がそれに含まれなければ fail
 * させる (意図と実装のズレ検出)。 manifest に書く期待結果は宣言ではなく
 * 実 validation の出力なので、 嘘が入らない。
 *
 * `options` の各フィールドの意味は `../fixtures/generator.ts` の
 * `FixtureOptions` を参照。 時刻系 (`capturedAt` 等) は default が固定値
 * かつ zip entry 日時も固定されるので、 生成は決定的 (LFS churn なし)。
 */
import type { FixtureOptions } from "../fixtures/generator.js";

export interface CorpusSpec {
  /** 出力ファイル名 (= `fixtures/<name>.wacz`)。 */
  name: string;
  /** manifest に載る 1 行説明。 */
  description: string;
  /** buildWacz に渡す生成オプション。 */
  options: FixtureOptions;
  /**
   * 意図する違反 rule (`spec` profile での発火を期待)。 空配列 = 正常系
   * (どの rule も error にしない)。 build-corpus が
   * `expectRules ⊆ 実際に出た rule` を assert する。
   */
  expectRules: string[];
}

export const CORPUS: CorpusSpec[] = [
  // ── 正常系 (全 rule pass) ────────────────────────────────────────────
  {
    name: "good",
    description: "全 rule を pass する正常系 WACZ (browserhive producer)",
    options: {},
    expectRules: [],
  },
  {
    name: "good-webrecorder",
    description:
      "webrecorder producer の正常系。spec/lenient では valid、browserhive では cdxj/index-not-gzipped が error (byProfile になる)",
    options: { producer: "webrecorder" },
    expectRules: [],
  },

  // ── datapackage/* ─────────────────────────────────────────────────
  {
    name: "datapackage-no-profile",
    description: "datapackage.json の profile field を省略",
    options: { profile: null },
    expectRules: ["datapackage/profile-required"],
  },
  {
    name: "datapackage-wrong-profile",
    description: "datapackage.json の profile が不正な値",
    options: { profile: "not-a-data-package" },
    expectRules: ["datapackage/profile-required"],
  },
  {
    name: "datapackage-unknown-version",
    description: "wacz_version が未知の値 (9.9.9) — warning",
    options: { waczVersion: "9.9.9" },
    expectRules: ["datapackage/wacz-version-required"],
  },
  {
    name: "datapackage-bad-hash",
    description: "datapackage.json の resource hash が実体と不一致",
    options: {
      mutateResources: (defaults) =>
        defaults.map((r) =>
          r.path === "archive/data.warc.gz"
            ? {
                ...r,
                hash: "sha256:dead0000000000000000000000000000000000000000000000000000000000ff",
              }
            : r,
        ),
    },
    expectRules: ["datapackage/resource-hashes"],
  },
  {
    name: "datapackage-absent",
    description: "datapackage.json を丸ごと欠落 (§5.2.4 の MUST 欠落 → required-files)",
    options: { omitDatapackage: true },
    expectRules: ["wacz/required-files"],
  },
  {
    name: "datapackage-frictionless-bad-name",
    description:
      "resource.name が Frictionless の許容パターン外 (大文字)。WACZ 固有 rule は通り、frictionless-schema だけが warning (lenient では除外)",
    options: {
      // name を大文字化するだけ。path/hash は不変なので resource-hashes は通り、
      // frictionless-schema (name パターン違反) だけが発火する。warning なので
      // valid は true のまま。lenient profile では除外され issues 空になる。
      mutateResources: (defaults) =>
        defaults.map((r, i) => (i === 0 ? { ...r, name: "DATA.warc.gz" } : r)),
    },
    expectRules: ["datapackage/frictionless-schema"],
  },

  // ── wacz/* (§5.2 構造的な MUST の欠落) ────────────────────────────
  {
    name: "wacz-missing-pages",
    description: "pages/pages.jsonl が欠落 (§5.2.3 の MUST 欠落)。宣言も落とすので required-files 単独",
    options: { omitPages: true },
    expectRules: ["wacz/required-files"],
  },
  {
    name: "wacz-missing-archive",
    description: "archive/ に WARC が無い (§5.2.1 の MUST 欠落)。宣言も落とすので required-files 単独",
    options: { omitArchive: true },
    expectRules: ["wacz/required-files"],
  },
  {
    name: "wacz-missing-indexes",
    description:
      "indexes/ に index が無い (§5.2.2 の MUST 欠落)。required-files に加え index-recognised-by-wabac も発火 (相補的)",
    options: { omitIndexes: true },
    expectRules: ["wacz/required-files"],
  },

  // ── cdxj/* ────────────────────────────────────────────────────────
  {
    name: "cdxj-filename-absolute",
    description: "CDXJ の filename が archive-relative でない",
    options: { cdxjFilenameOverride: "archive/data.warc.gz" },
    expectRules: ["cdxj/filename-archive-relative"],
  },
  {
    name: "cdxj-index-gzipped",
    description:
      "index を gzip 化 (browserhive layout)。index-not-gzipped と index-recognised-by-wabac が発火",
    options: { cdxjGzipped: true },
    expectRules: ["cdxj/index-not-gzipped", "cdxj/index-recognised-by-wabac"],
  },
  {
    name: "cdxj-offset-wrong",
    description: "CDXJ の offset が WARC 実体とずれている",
    options: { cdxjOffsetOverride: "999999" },
    expectRules: ["cdxj/warc-offsets"],
  },
  {
    name: "cdxj-length-mismatch",
    description: "CDXJ の length が WARC member 長と不一致 (length 分岐)",
    options: { cdxjLengthMismatch: true },
    expectRules: ["cdxj/warc-offsets"],
  },
  {
    name: "cdxj-mainpage-orphan",
    description: "mainPageURL が CDXJ/pages に存在しない URL — warning",
    options: { mainPageUrlOverride: "https://orphan.example/" },
    expectRules: ["cdxj/pages-mainpage"],
  },

  // ── warc/* ────────────────────────────────────────────────────────
  {
    name: "warc-deflate",
    description: "WARC を DEFLATE 格納 (STORE であるべき) — warning",
    options: { warcDeflate: true },
    expectRules: ["warc/storage-store"],
  },
  {
    name: "warc-corrupt-member",
    description: "WARC.gz の deflate stream を 1 byte 破壊 (decode 不能)",
    options: { warcCorruptAt: 30 },
    expectRules: ["warc/members-independent"],
  },
  {
    name: "warc-payload-digest-bad",
    description: "WARC-Payload-Digest header が実体と不一致 — warning",
    options: { payloadDigestBad: true },
    expectRules: ["warc/payload-digest"],
  },

  // ── fuzzy/* ───────────────────────────────────────────────────────
  {
    name: "fuzzy-not-json",
    description: "fuzzy.json が JSON でない — info",
    options: { fuzzyOverride: "not json" },
    expectRules: ["fuzzy/valid-json"],
  },
];
