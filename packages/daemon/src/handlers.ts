/**
 * daemon のハンドラ — core を所有する stateless な検証ロジック。
 *
 * 各ハンドラは source URI を開いて操作し、必ず close する(状態を残さない)。
 * `WaczReader` は range read なので、毎回 open しても全体を読み直さず安い。
 * i18n は `renderJson(report, locale)` で解決して {@link WireReport} を返す。
 */
import { fileURLToPath } from "node:url";
import {
  DEFAULT_RULES,
  WaczReader,
  fileTransport,
  parseReportSource,
  renderJson,
  resolveLocale,
  runValidation,
  s3Transport,
  type RuleProfile,
} from "@waxlens/core";
import type {
  ReadEntryParams,
  ReadEntryResult,
  RpcErrorCode,
  ValidateParams,
  WireReport,
} from "@waxlens/protocol";

const VERSION = "0.0.0";
/** content プレビューの上限(byte 相当)。これを超えたら truncated。 */
const PREVIEW_CAP = 64 * 1024;
const PROFILES: readonly string[] = ["spec", "browserhive", "lenient"];

/** RpcError に map できる、コード付きの daemon エラー。 */
export class DaemonError extends Error {
  readonly code: RpcErrorCode;
  constructor(code: RpcErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "DaemonError";
  }
}

/** source URI から WaczReader を開く。失敗は openFailed の DaemonError に正規化。 */
const openFromUri = async (uri: string, s3ForcePathStyle: boolean): Promise<WaczReader> => {
  try {
    // file:// は絶対パスへ。s3:// / 絶対パスはそのまま parseReportSource に渡し、
    // ブランド付き AbsolutePath / ResolvedS3Source を得る。
    const input = uri.startsWith("file://") ? fileURLToPath(uri) : uri;
    const parsed = parseReportSource(input);
    if (!parsed.ok) throw new DaemonError("openFailed", parsed.error.kind);
    const src = parsed.value;
    return src.kind === "s3"
      ? await WaczReader.open(s3Transport({ ...src, forcePathStyle: s3ForcePathStyle }))
      : await WaczReader.open(fileTransport(src.path));
  } catch (cause) {
    if (cause instanceof DaemonError) throw cause;
    throw new DaemonError("openFailed", cause instanceof Error ? cause.message : String(cause));
  }
};

const toProfile = (profile: string | undefined): RuleProfile | undefined =>
  profile !== undefined && PROFILES.includes(profile) ? (profile as RuleProfile) : undefined;

/** WACZ を検証し、解決済みの WireReport を返す(stateless)。 */
export const validate = async (params: ValidateParams): Promise<WireReport> => {
  const locale = resolveLocale(params.locale);
  const profile = toProfile(params.profile);
  const reader = await openFromUri(params.source.uri, params.s3ForcePathStyle ?? false);
  try {
    const result = await runValidation(reader, {
      waxlensVersion: VERSION,
      rules: DEFAULT_RULES,
      ...(profile !== undefined && { profile }),
    });
    if (!result.ok) throw new DaemonError("engineFailed", "validation engine failed");
    return JSON.parse(renderJson(result.value, locale)) as WireReport;
  } finally {
    await reader.close();
  }
};

/** 拡張子で内容を整形する(.json は pretty-print)。 */
const formatBody = (path: string, text: string): string => {
  if (path.endsWith(".json")) {
    try {
      return JSON.stringify(JSON.parse(text) as unknown, null, 2);
    } catch {
      return text;
    }
  }
  return text;
};

/** 1 エントリの内容を上限つきで返す(stateless・range read)。 */
export const readEntry = async (params: ReadEntryParams): Promise<ReadEntryResult> => {
  const reader = await openFromUri(params.source.uri, false);
  try {
    const buf = await reader.readEntry(params.path);
    if (!buf) return { content: "", truncated: false };
    const raw = buf.toString("utf-8");
    const truncated = raw.length > PREVIEW_CAP;
    return {
      content: formatBody(params.path, truncated ? raw.slice(0, PREVIEW_CAP) : raw),
      truncated,
    };
  } finally {
    await reader.close();
  }
};
