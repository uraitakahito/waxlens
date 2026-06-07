/**
 * waxlens daemon protocol — tui / daemon / 将来の browser が共有する契約。
 *
 * 大半は型(`import type` で core を参照するが runtime には残らない)。加えて
 * クライアントが `@waxlens/core` を一切 import せずに済むよう、軽量な CLI 契約
 * (profile/locale 定数・`exitCodeFor`・`CliOutcome`)も持つ — これらは
 * validation engine も i18n カタログも読み込まない純粋な定数 / 関数で、
 * browser でも安全に bundle できる。
 *
 * daemon が validation を所有し、i18n は `renderJson(report, locale)` で解決して
 * {@link WireReport} を返すので、クライアントはカタログ不要の薄い表示器でよい。
 *
 * 案1(URI 参照渡し・stateless): 各リクエストが `source.uri` を運び、
 * daemon は open → validate → close するだけで状態を持たない。
 */
import type { Issue, Report } from "@waxlens/core";

// クライアント(tui / browser)が core を直接 import せずに済むよう、表示用の
// 型を protocol から re-export する(すべて型なので runtime には残らない)。
export type {
  AbsolutePath,
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
  /** zip エントリのパス(例 `datapackage.json`)。 */
  path: string;
}

export interface ReadEntryResult {
  content: string;
  /** サイズ上限で打ち切ったか。 */
  truncated: boolean;
}

/** renderJson が解決した issue(`message` / `specUrl` / `conformance` が inline)。 */
export interface WireIssue extends Issue {
  message: string;
  specUrl?: string;
  conformance?: string;
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
export type RpcMethod = "waxlens/validate" | "waxlens/readEntry";
export interface RpcRequest {
  id: number;
  method: RpcMethod;
  params: ValidateParams | ReadEntryParams;
}
export interface RpcResponse {
  id: number;
  result?: WireReport | ReadEntryResult;
  error?: RpcError;
}

// ── CLI 契約 ───────────────────────────────────────────────────────────
// クライアントが core を import せずに使えるよう protocol が持つ軽量定数 / 関数。

export const ALL_PROFILES = ["spec", "browserhive", "lenient"] as const;
export const DEFAULT_PROFILE = "spec";
export const SUPPORTED_LOCALES = ["en", "ja"] as const;

/** CLI の outcome(exit code に map する前の「何が起きたか」)。 */
export type CliOutcome =
  | { kind: "valid"; report: WireReport }
  | { kind: "invalid"; report: WireReport }
  | { kind: "openFailed"; filePath: string; cause: unknown }
  | { kind: "engineFailed" };

/**
 * outcome → 数値 exit code(0 成功 / 1 検証失敗 / 2 operational 失敗)。
 * core の同名関数と同じ契約だが、クライアントが core を import せずに済むよう
 * protocol 側に置く。
 */
export const exitCodeFor = (outcome: CliOutcome): number => {
  switch (outcome.kind) {
    case "valid":
      return 0;
    case "invalid":
      return 1;
    case "openFailed":
    case "engineFailed":
      return 2;
  }
};
