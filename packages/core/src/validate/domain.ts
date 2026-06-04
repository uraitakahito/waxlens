/**
 * Validation ドメイン型。
 *
 * 各 rule は `Issue[]` を生成する。engine は rule ごとの出力を 1 つの
 * `Report` にマージする。HTTP / CLI / TUI の rendering 層は `Report`
 * しか消費しないので、新しい rule を加える際は `ValidationRule` を
 * export して registry に追加するだけでよく、他の層に変更は要らない。
 *
 * wire format (`Report`) は `--json` が出力するもので、`docs/json-schema.md`
 * が公開 schema として pin している (0.x line 中安定)。future-proofing
 * のための note:
 *   - `waxlensVersion` によって downstream consumer が schema の drift
 *     を検出できる。
 *   - `summary.durationMs` を最初から入れることで、CI dashboard が
 *     コストの regression を trend として追える。
 *   - `Issue.details` は意図的に `unknown` — rule が hash diff、hex
 *     dump などを付ける。renderer は rule ごとに整形し、JSON schema
 *     としては "serialise 可能なら何でも"。
 */
import { isAbsolute, resolve as resolvePath } from "node:path";
import type { MsgParams } from "../i18n/translate.js";
import { err, ok, type Result } from "../result.js";
import type { WaczReader } from "../wacz/reader.js";

export type Severity = "error" | "warning" | "info";

/**
 * Rule セットの selector。profile を選ぶと producer 固有な rule
 * (例: `cdxj/index-not-gzipped`) の severity が組み替えられるが、
 * spec が要求する check を silent にすることはない。デフォルトは
 * `spec`。
 *
 * - `spec` — WACZ spec + wabac.js loader 互換。デフォルトで、
 *   ほとんどの consumer が望む形。
 * - `browserhive` — `spec` の上に BrowserHive の producer 慣習を
 *   重ねる (例: plain な `indexes/index.cdxj` を要求、`.idx` と
 *   ペアでも `index.cdxj.gz` は許さない、など)。
 * - `lenient` — producer 固有 / 様式的な findings をすべて `info` に
 *   降格させる。legacy archive をトリアージしていて "replay 破損"
 *   系の hard error だけを見たいときに便利。
 */
export const ALL_PROFILES = ["spec", "browserhive", "lenient"] as const;

export type RuleProfile = (typeof ALL_PROFILES)[number];

/**
 * 各 rule が profile にどう反応するか。`severityByProfile` を使うと、
 * registry には 1 度だけ rule を置きつつ severity を調整できる。
 * `excludeProfiles` はその profile で rule を完全に silence する (まれ
 * — ある producer の慣習を離れると意味を持たない check で使う)。
 */
export interface RuleApplicability {
  /** profile 別の severity override。指定なしの profile は `ValidationRule.severity` に fallback する。 */
  severityByProfile?: Partial<Record<RuleProfile, Severity>>;
  /** その profile で rule を完全に skip する (issue を 1 件も出さない)。 */
  excludeProfiles?: readonly RuleProfile[];
}

export interface IssueLocation {
  /** 問題が見つかった zip entry 名 (該当する場合)。 */
  entry?: string;
  /** text entry (CDXJ、pages.jsonl) 内の 1-based 行番号。 */
  line?: number;
  /** binary entry (WARC) 内の byte offset。 */
  offset?: number;
}

export interface Issue {
  /**
   * `<area>/<short-name>` 形式の安定した rule identifier。 将来の
   * `--rule` filter や log を grep する人が使う。localise しない;
   * version 間で書式を変えない。
   */
  rule: string;
  severity: Severity;
  /**
   * メッセージの i18n キー(`<rule>/<short>`)。renderer が locale 別の
   * ICU カタログで解決する。human-readable な prose は core に持たない。
   */
  messageKey: string;
  /** メッセージに差し込むランタイム値(path・行番号・理由など)。 */
  params?: MsgParams;
  location?: IssueLocation;
  /**
   * renderer が必要に応じて expand できる structured payload。
   * JSON-serialisable に保つ (number、string、plain object、array)。
   * TUI (M2+) は "expand" キーでこれを描画し、JSON renderer は
   * そのまま round-trip する。
   */
  details?: unknown;
}

export interface ValidationRule {
  /** `Issue.rule` に入るのと同じ値。 */
  name: string;
  /** rationale の i18n キー(`<rule>/desc`)。locale 別カタログで解決。 */
  descriptionKey: string;
  /**
   * baseline の severity。profile 固有の override が無いときに使う。
   * profile 固有の override が無くても engine は profile logic を通すので、
   * baseline `error` の rule は `lenient` profile 下で
   * `applicability.severityByProfile` 経由で `warning` に降格しうる。
   */
  severity: Severity;
  /**
   * profile 別の override。省略時は、rule が全 profile で baseline
   * severity のまま適用される。
   */
  applicability?: RuleApplicability;
  run: (wacz: WaczReader) => Promise<Result<Issue[], never>>;
}

export interface ReportSummary {
  passed: number;
  failed: number;
  warnings: number;
  info: number;
  durationMs: number;
}

/**
 * WACZ に関する人向けには有用だが issue モデルには馴染まない
 * informational な metadata — record 数、distinct な host 数など。
 * Renderer は summary 行の下にこれを表示する。engine が best-effort
 * で計算するため optional: WARC が壊れていても stats を取りに行く
 * ために report を block することはしない。
 */
export interface ReportStats {
  /** WARC iterator が yield した独立 gzip member 数。 */
  warcRecordCount: number;
  /** `archive/data.warc.gz` の byte 長 (zip 解凍後)。 */
  warcArchiveBytes: number;
  /** CDXJ entry の `url` field に現れる distinct な host。 */
  hosts: string[];
}

/**
 * 検証対象 WACZ の identity。`Report.source` および `WaczReader.source`
 * の wire format。
 *
 * `kind: "file"` は絶対パス、`kind: "s3"` は `s3://bucket/key` URI を
 * 表す。Brand 型 `AbsolutePath` / `S3Uri` を経由しないと構築できない
 * ので、relative path や malformed URI を Report に embed することは
 * compile / runtime のどちらでも防げる。
 */
declare const AbsolutePathBrand: unique symbol;
export type AbsolutePath = string & { readonly [AbsolutePathBrand]: true };

/**
 * parseReportSource / parseAbsolutePath / parseS3Uri が err variant
 * として返す失敗の集合。 caller (cli.ts) は kind で switch して
 * 種別ごとに message を組み立てる。 新しい transport (例: HTTP) を
 * 加えるときは ここに variant を 1 つ追加し、 formatParseSourceError
 * の switch が網羅性 chk で未対応に倒れる仕組みを利用する。
 */
export type ParseSourceError =
  | { kind: "invalid-s3-uri"; raw: string }
  | { kind: "not-absolute-path"; raw: string };

export const parseAbsolutePath = (
  raw: string,
): Result<AbsolutePath, ParseSourceError> => {
  const absolute = resolvePath(raw);
  if (!isAbsolute(absolute)) {
    return err({ kind: "not-absolute-path", raw });
  }
  return ok(absolute as AbsolutePath);
};

declare const S3UriBrand: unique symbol;
export type S3Uri = string & { readonly [S3UriBrand]: true };

const S3_URI_RE = /^s3:\/\/([^/]+)\/(.+)$/;

export const parseS3Uri = (raw: string): Result<S3Uri, ParseSourceError> => {
  if (!S3_URI_RE.test(raw)) {
    return err({ kind: "invalid-s3-uri", raw });
  }
  return ok(raw as S3Uri);
};

export const s3UriToBucketKey = (uri: S3Uri): { bucket: string; key: string } => {
  const m = S3_URI_RE.exec(uri);
  // parseS3Uri を通過しているので必ず match する。
  if (!m?.[1] || !m[2]) throw new Error("unreachable: malformed S3Uri reached s3UriToBucketKey");
  return { bucket: m[1], key: m[2] };
};

/** Local file の WACZ source。`path` は絶対パス (AbsolutePath brand 済)。 */
export interface FileSource {
  kind: "file";
  path: AbsolutePath;
}

/** S3 上の WACZ source。`uri` は `s3://bucket/key` (S3Uri brand 済)。 */
export interface S3Source {
  kind: "s3";
  uri: S3Uri;
}

/**
 * 検証対象 WACZ の identity。`Report.source` / `WaczReader.source` の
 * wire format。transport ごとの variant は {@link FileSource} / {@link S3Source}。
 */
export type ReportSource = FileSource | S3Source;

export const parseReportSource = (
  raw: string,
): Result<ReportSource, ParseSourceError> => {
  if (raw.startsWith("s3://")) {
    const u = parseS3Uri(raw);
    if (!u.ok) return u;
    return ok({ kind: "s3", uri: u.value });
  }
  const p = parseAbsolutePath(raw);
  if (!p.ok) return p;
  return ok({ kind: "file", path: p.value });
};

/**
 * `ParseSourceError` を 1 行 message に変換する。 cli.ts (core / tui
 * 両方) が `CliOutcome.openFailed` の cause 用に呼ぶ。 switch が
 * exhaustive chk を発火するので、 `ParseSourceError` union に variant
 * を加えると ここで compile error が出て対応漏れを catch できる。
 */
export const formatParseSourceError = (e: ParseSourceError): string => {
  switch (e.kind) {
    case "invalid-s3-uri":
      return `invalid s3:// URI: ${e.raw}`;
    case "not-absolute-path":
      return `expected absolute path, got: ${e.raw}`;
  }
};

/**
 * WACZ 内の 1 ファイル(zip エントリ)の一覧用レコード。renderer は
 * これを §5.1 風のディレクトリツリーに組み直し、issue を file に重ねて
 * 表示する。flat に持つことで JSON consumer がそのまま扱える。
 *
 * `present: false` は「期待されるが zip に実在しない」file を表す。
 * 「なぜ期待されるか」は {@link ReportEntry.expectedBy} が持つ — datapackage の
 * 宣言由来か、WACZ §5.2 の MUST 由来か。その場合 size / 圧縮は無い。
 */

/**
 * ReportEntry が「あるべき」とされる理由。
 *   - `"datapackage"`: datapackage.json の `resources[].path` に宣言されている。
 *   - `"wacz-spec"`: WACZ §5.2 が MUST とする(datapackage.json / pages/pages.jsonl /
 *     archive/ の WARC / indexes/ の index)。
 * 両方に該当することもある。空配列 = zip に実在するだけで、特に「期待」はされていない。
 */
export type ExpectedBy = "datapackage" | "wacz-spec";

export interface ReportEntry {
  /** zip エントリ path。例: `archive/data.warc.gz`。 */
  path: string;
  /** zip に実在するか。false = 期待されるが実在しない(欠落)。 */
  present: boolean;
  /** 解凍後のバイト数(present のみ)。 */
  uncompressedSize?: number;
  /** zip の圧縮方式(0=STORE / 8=DEFLATE)(present のみ)。 */
  compressionMethod?: number;
  /** なぜ「あるべき」か。{@link ExpectedBy} を参照。空 = 実在するだけ。 */
  expectedBy: ExpectedBy[];
  /** この path を `location.entry` に持つ issue(rule + severity)。 */
  issues: { rule: string; severity: Severity }[];
}

export interface Report {
  waxlensVersion: string;
  /** report を評価する際に使った rule profile。{@link RuleProfile} を参照。 */
  profile: RuleProfile;
  /** validate された WACZ の identity。{@link ReportSource} を参照。 */
  source: ReportSource;
  /** `summary.failed === 0` のときだけ `true`。JSON consumer が再計算しなくていいように cache してある。 */
  valid: boolean;
  summary: ReportSummary;
  issues: Issue[];
  /** WACZ 内のファイル一覧 + 検証の紐付け。{@link ReportEntry} を参照。 */
  entries: ReportEntry[];
  /** best-effort な metadata — {@link ReportStats} を参照。 */
  stats?: ReportStats;
}
