/**
 * waxlens daemon protocol — tui / daemon / 将来の browser が共有する契約。
 *
 * 大半は型(`import type` で core を参照するが runtime には残らない)。加えて
 * クライアントが validation engine を引き込まずに済むよう、軽量な CLI 契約
 * (profile/locale 定数・`exitCodeFor`・`CliOutcome`)も通す — 実体は
 * `@waxlens/contract` に在り、あちらは何も import しない葉 package なので
 * browser でも安全に bundle できる。
 *
 * daemon が validation を所有し、i18n は `renderJson(report, locale)` で解決して
 * {@link WireReport} を返すので、クライアントはカタログ不要の薄い表示器でよい。
 *
 * 案1(URI 参照渡し・stateless): 各リクエストが `source.uri` を運び、
 * daemon は open → validate → close するだけで状態を持たない。
 */
import type { DocLink, Issue, Report } from "@waxlens/core";

// クライアント(tui / browser)が core を直接 import せずに済むよう、表示用の
// 型を protocol から re-export する(すべて型なので runtime には残らない)。
export type {
  AbsolutePath,
  DocLink,
  ExpectedBy,
  IssueLocation,
  Locale,
  ReportEntry,
  ReportSource,
  ReportStats,
  ReportSummary,
  RuleProfile,
  Severity,
} from "@waxlens/core";

/** WACZ の在り処。案1 では URI のみ(`file://` / `s3://` / `https://`)。 */
export interface SourceRef {
  kind: "uri";
  uri: string;
}

export interface ValidateParams {
  source: SourceRef;
  /** rule profile(`spec` / `browserhive` / `lenient`)。未指定は daemon の既定。 */
  profile?: string;
  /** 表示 locale。daemon が renderJson でこの locale に解決する。 */
  locale: string;
  /** s3:// source 用の path-style addressing(SeaweedFS / MinIO 等)。 */
  s3ForcePathStyle?: boolean;
}

export interface ReadEntryParams {
  source: SourceRef;
  /** ZIP エントリのパス(例 `datapackage.json`)。 */
  path: string;
}

/**
 * readEntry の結果。テキストはプレビュー文字列、非テキスト(画像・展開不能な
 * バイナリ等)はサイズだけを返す判別 union。文字化けを構造的に防ぐ。
 */
export type ReadEntryResult =
  | { kind: "text"; content: string; truncated: boolean; gunzipped: boolean }
  | { kind: "binary"; byteLength: number };

/** renderJson が解決した issue(`message` / `specUrl` / `conformance` が inline)。 */
export interface WireIssue extends Issue {
  message: string;
  specUrl?: string;
  conformance?: string;
  /** rule の出典(公式ドキュメント)リンク群。renderJson が rule 名で解決。 */
  docs?: readonly DocLink[];
}

/** daemon が返す解決済み Report(renderJson 出力に対応)。 */
export interface WireReport extends Omit<Report, "issues"> {
  issues: WireIssue[];
}

export type RpcErrorCode = "openFailed" | "engineFailed" | "badRequest";
export interface RpcError {
  code: RpcErrorCode;
  message: string;
}

/** WS のメッセージ枠(相関 id つき request/response。セッション状態は持たない)。 */
export type RpcMethod = "waxlens/validate" | "waxlens/readEntry" | "waxlens/ping";

/** waxlens/ping は引数を取らない。 */
export type PingParams = Record<string, never>;

/** /healthz と waxlens/ping が返す生存ステータス。 */
export interface HealthStatus {
  status: "ok";
  version: string;
  /** 短い git SHA(未コミット変更があれば `-dirty` 付き)。ビルド時に焼き込み。 */
  gitSha: string;
  /** ビルド時刻(ISO8601)。 */
  builtAt: string;
  uptimeSec: number;
}

export interface RpcRequest {
  id: number;
  method: RpcMethod;
  params: ValidateParams | ReadEntryParams | PingParams;
}
export interface RpcResponse {
  id: number;
  result?: WireReport | ReadEntryResult | HealthStatus;
  error?: RpcError;
}

// ── CLI 契約 ───────────────────────────────────────────────────────────
// 持ち主は @waxlens/contract。あちらは何も import しない葉 package なので、
// ここを経由してもクライアントに validation engine は付いてこない。
//
// 以前はこの節が同じ定義を手で複製していた。型 (`RuleProfile`) は core から
// re-export しつつ値 (`ALL_PROFILES`) だけ複製していたので、core に profile を
// 足しても何もエラーにならず、waxlens-validate は受理するのに waxlens は
// 拒否する、という食い違いが型検査も全 test も緑のまま成立していた。

export {
  ALL_PROFILES,
  DEFAULT_PROFILE,
  DEFAULT_SELECTOR,
  SUPPORTED_LOCALES,
  exitCodeFor,
  formatProfileSelector,
  parseProfileSelector,
} from "@waxlens/contract";
export type { CliOutcome, ProfileSelector, SemVer } from "@waxlens/contract";
