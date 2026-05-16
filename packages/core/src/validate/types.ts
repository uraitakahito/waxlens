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
import { isAbsolute } from "node:path";
import type { Result } from "../result.js";
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
  /** Per-profile severity override. Omitted profile falls back to `ValidationRule.severity`. */
  severityByProfile?: Partial<Record<RuleProfile, Severity>>;
  /** Profiles where the rule is skipped entirely (no issues emitted). */
  excludeProfiles?: readonly RuleProfile[];
}

export interface IssueLocation {
  /** zip entry name where the problem was found, when applicable. */
  entry?: string;
  /** 1-based line number inside a text entry (CDXJ, pages.jsonl). */
  line?: number;
  /** Byte offset inside a binary entry (WARC). */
  offset?: number;
}

export interface Issue {
  /**
   * Stable rule identifier in `<area>/<short-name>` form. Used by the
   * future `--rule` filter and by humans grepping logs. Never
   * localised; never reformatted across versions.
   */
  rule: string;
  severity: Severity;
  /** One-line human summary. The renderer may colour by severity. */
  message: string;
  location?: IssueLocation;
  /**
   * Structured payload the renderer can expand on demand. Keep
   * JSON-serialisable (numbers, strings, plain objects, arrays). The TUI
   * (M2+) renders this for the "expand" key; the JSON renderer round-trips.
   */
  details?: unknown;
}

export interface ValidationRule {
  /** Same value that ends up in `Issue.rule`. */
  name: string;
  /** One-sentence rationale. Surfaced by `--help` and docs/rules.md. */
  description: string;
  /**
   * Baseline severity, used when no profile-specific override applies.
   * The engine still routes this through profile logic: a rule with
   * baseline `error` can be demoted to `warning` under the `lenient`
   * profile via `applicability.severityByProfile`.
   */
  severity: Severity;
  /**
   * Per-profile overrides. Omitted = the rule applies in every profile
   * at its baseline severity.
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
  /** Number of independent gzip members the WARC iterator yielded. */
  warcRecordCount: number;
  /** Byte length of `archive/data.warc.gz` (zip-uncompressed). */
  warcArchiveBytes: number;
  /** Distinct hosts mentioned in CDXJ entries' `url` field. */
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

export const asAbsolutePath = (raw: string): AbsolutePath => {
  if (!isAbsolute(raw)) {
    throw new TypeError(`Expected absolute path, got: ${raw}`);
  }
  return raw as AbsolutePath;
};

declare const S3UriBrand: unique symbol;
export type S3Uri = string & { readonly [S3UriBrand]: true };

const S3_URI_RE = /^s3:\/\/([^/]+)\/(.+)$/;

export const parseS3Uri = (raw: string): S3Uri => {
  if (!S3_URI_RE.test(raw)) {
    throw new TypeError(`Invalid s3:// URI: ${raw}`);
  }
  return raw as S3Uri;
};

export const s3UriToBucketKey = (uri: S3Uri): { bucket: string; key: string } => {
  const m = S3_URI_RE.exec(uri);
  // parseS3Uri を通過しているので必ず match する。
  if (!m?.[1] || !m[2]) throw new Error("unreachable: malformed S3Uri reached s3UriToBucketKey");
  return { bucket: m[1], key: m[2] };
};

export type ReportSource =
  | { kind: "file"; path: AbsolutePath }
  | { kind: "s3"; uri: S3Uri };

export interface Report {
  waxlensVersion: string;
  /** Rule profile used to evaluate the report. See {@link RuleProfile}. */
  profile: RuleProfile;
  /** Identity of the validated WACZ. See {@link ReportSource}. */
  source: ReportSource;
  /** `true` iff `summary.failed === 0`. Cached so the JSON consumer doesn't recompute. */
  valid: boolean;
  summary: ReportSummary;
  issues: Issue[];
  /** Best-effort metadata — see {@link ReportStats}. */
  stats?: ReportStats;
}
