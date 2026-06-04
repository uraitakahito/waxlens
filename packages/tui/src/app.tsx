/**
 * Ink TUI renderer。
 *
 * レイアウト:
 *
 *   waxlens 0.0.0  /path/to/file.wacz
 *
 *   ▶ [✗] datapackage/profile-required
 *       datapackage.json is missing the "profile" field
 *       { "expected": "data-package" }              ← expanded のときだけ表示
 *     [✗] cdxj/filename-archive-relative
 *       indexes/index.cdxj:1 — entry "filename" starts with "archive/"
 *
 *   1 passed, 2 failed, 0 warnings  · 12ms
 *   ↑↓ navigate · enter expand · q quit
 *
 * 1 行 1 issue、`▶` がカーソル、`enter` で `details` をトグル。JSON
 * renderer が emit するのと同じ `Issue.details` payload を意図的に
 * render する — human view と machine view が乖離しないため。
 *
 * Exit code の経路: CLI は `render(...)` を呼ぶ *前* に
 * `process.exitCode` をセットし、その後 `instance.waitUntilExit()`
 * を await する。TUI は `q` のときに `useApp().exit()` を呼び、Node
 * は最終的なステータスとして `process.exitCode` を使う。これによって
 * Ink の `exit(reason?)` 引数 (error object 用に予約されている) に
 * code を通さずに済む。
 */
import { createContext, useContext, useMemo, useState, type FC } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { t, type Issue, type Locale, type Report, type ReportEntry } from "@waxlens/core";
import { buildEntryTree, entryMarker, flattenTree, type TreeRow } from "./render/tree.js";
import { codecName, entryIssues, expectedLabel } from "./render/detail.js";

/** 表示 locale。App が provide し、issue メッセージを描く子が consume する。 */
const LocaleContext = createContext<Locale>("en");

interface AppProps {
  report: Report;
  locale: Locale;
}

type View = "issues" | "layout";

export const App: FC<AppProps> = ({ report, locale }) => {
  const { exit } = useApp();
  const [view, setView] = useState<View>("issues");
  const [focused, setFocused] = useState(0);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());

  const issues = report.issues;
  // §5.1 風ツリーの行(report が変わらない限り再計算しない)。
  const layoutRows = useMemo(() => flattenTree(buildEntryTree(report.entries)), [report.entries]);
  const rowCount = view === "issues" ? issues.length : layoutRows.length;

  useInput((input, key) => {
    if (input === "q" || key.escape) {
      exit();
      return;
    }
    // Tab で Issues ⇄ Layout を切替。cursor は先頭へ戻す。
    if (key.tab) {
      setView((prev) => (prev === "issues" ? "layout" : "issues"));
      setFocused(0);
      return;
    }
    if (key.upArrow && rowCount > 0) {
      setFocused((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow && rowCount > 0) {
      setFocused((prev) => Math.min(rowCount - 1, prev + 1));
      return;
    }
    if (key.return && view === "issues" && issues.length > 0) {
      // focused な issue の expansion をトグルする。set を作り直して
      // いるのは、React の diff のために参照の同一性を安定させたいため。
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(focused)) next.delete(focused);
        else next.add(focused);
        return next;
      });
    }
  });

  return (
    <LocaleContext.Provider value={locale}>
      <Box flexDirection="column">
        <Header report={report} view={view} />
        <Box marginTop={1} flexDirection="column">
          {view === "issues" ? (
            issues.length === 0 ? (
              <Text color="green">All rules passed.</Text>
            ) : (
              issues.map((issue, i) => (
                <IssueRow
                  key={`${issue.rule}-${String(i)}`}
                  issue={issue}
                  focused={i === focused}
                  expanded={expanded.has(i)}
                />
              ))
            )
          ) : (
            <LayoutView rows={layoutRows} focused={focused} report={report} />
          )}
        </Box>
        <Summary report={report} />
        {report.stats ? <Stats stats={report.stats} /> : null}
        <Help />
      </Box>
    </LocaleContext.Provider>
  );
};

/**
 * Layout ビュー: 左に §5.1 風ツリー(状態アイコン ✗/⚠ + size)、右に
 * 選択行(focused)の詳細ペイン。理由・rule 名・message は冗長なので
 * ツリーには出さず、すべてペインに一本化する(ツリー=概要、ペイン=詳細)。
 * 中身(bytes)は読まず Report だけで描く。
 */
const LayoutView: FC<{ rows: TreeRow[]; focused: number; report: Report }> = ({
  rows,
  focused,
  report,
}) => {
  if (rows.length === 0) return <Text dimColor>(no entries)</Text>;
  const selected = rows[focused]?.entry;
  return (
    <Box>
      {/* 左: 既存ツリー。flexShrink={0} で自然幅を保ち、右ペインに場所を空ける。 */}
      <Box flexDirection="column" flexShrink={0}>
        {rows.map((row, i) => {
          const mk = entryMarker(row.entry);
          // ツリーは状態アイコンだけ(error/missing → ✗、warning → ⚠)。理由・
          // rule 名・message は DetailPane が持つ。glyph があるときだけ描画する
          // ので color は常に具体値(undefined は exactOptionalPropertyTypes に弾かれる)。
          const glyph = mk.tone === "error" ? "✗" : mk.tone === "warning" ? "⚠" : "";
          const color = mk.tone === "warning" ? "yellow" : "red";
          const size =
            row.entry?.present === true && row.entry.uncompressedSize !== undefined
              ? `  ${formatBytes(row.entry.uncompressedSize)}`
              : "";
          return (
            <Text key={row.path} inverse={i === focused}>
              {row.connector}
              {row.name}
              <Text dimColor>{size}</Text>
              {glyph ? <Text color={color}>{`  ${glyph}`}</Text> : null}
            </Text>
          );
        })}
      </Box>
      {/* 右: 選択ファイルの詳細。 */}
      <Box
        flexDirection="column"
        flexGrow={1}
        marginLeft={2}
        borderStyle="round"
        borderDimColor
        paddingX={1}
      >
        <DetailPane entry={selected} report={report} />
      </Box>
    </Box>
  );
};

/** 右ペイン: 選択 entry のメタ情報(path/status/size/expected)+ 紐づく issue 全文。 */
const DetailPane: FC<{ entry: ReportEntry | undefined; report: Report }> = ({ entry, report }) => {
  if (!entry) return <Text dimColor>(select a file)</Text>;
  return (
    <Box flexDirection="column">
      <Text bold>{entry.path}</Text>
      <Box>
        <Text dimColor>status </Text>
        {entry.present ? <Text color="green">present</Text> : <Text color="red">MISSING</Text>}
      </Box>
      {entry.present && entry.uncompressedSize !== undefined ? (
        <Box>
          <Text dimColor>size </Text>
          <Text>{`${formatBytes(entry.uncompressedSize)}  (${codecName(entry.compressionMethod)})`}</Text>
        </Box>
      ) : null}
      <Box>
        <Text dimColor>expected </Text>
        <Text>{expectedLabel(entry.expectedBy)}</Text>
      </Box>
      <IssueList entry={entry} report={report} />
    </Box>
  );
};

/** 選択 file に紐づく issue を全文(icon + rule + message + location)で列挙。 */
const IssueList: FC<{ entry: ReportEntry; report: Report }> = ({ entry, report }) => {
  const issues = entryIssues(report, entry.path);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>issues</Text>
      {issues.length === 0 ? (
        <Text color="green">  none</Text>
      ) : (
        issues.map((issue, n) => <IssueLine key={`${issue.rule}-${String(n)}`} issue={issue} />)
      )}
    </Box>
  );
};

const IssueLine: FC<{ issue: Issue }> = ({ issue }) => {
  const locale = useContext(LocaleContext);
  const tone = toneFor(issue.severity);
  const loc = formatLocation(issue);
  return (
    <Box flexDirection="column">
      <Text color={tone}>{`${iconFor(issue.severity)} ${issue.rule}`}</Text>
      <Box marginLeft={2}>
        <Text>
          {loc ? <Text dimColor>{`${loc} — `}</Text> : null}
          {t(issue.messageKey, issue.params ?? {}, locale)}
        </Text>
      </Box>
    </Box>
  );
};

const Stats: FC<{ stats: NonNullable<Report["stats"]> }> = ({ stats }) => {
  const recordsLabel = `${String(stats.warcRecordCount)} record${stats.warcRecordCount === 1 ? "" : "s"}`;
  const hostsLabel = `${String(stats.hosts.length)} host${stats.hosts.length === 1 ? "" : "s"}`;
  return (
    <Box>
      <Text
        dimColor
      >{`${recordsLabel}  ·  ${formatBytes(stats.warcArchiveBytes)}  ·  ${hostsLabel}`}</Text>
    </Box>
  );
};

const formatBytes = (n: number): string => {
  if (n < 1024) return `${String(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
};

const Header: FC<{ report: Report; view: View }> = ({ report, view }) => {
  const sourceLabel =
    report.source.kind === "file" ? report.source.path : report.source.uri;
  return (
    <Box>
      <Text bold>waxlens</Text>
      <Text dimColor> {report.waxlensVersion} </Text>
      <Text> {sourceLabel} </Text>
      <Text inverse={view === "issues"}> Issues </Text>
      <Text> </Text>
      <Text inverse={view === "layout"}> Layout </Text>
    </Box>
  );
};

const IssueRow: FC<{ issue: Issue; focused: boolean; expanded: boolean }> = ({
  issue,
  focused,
  expanded,
}) => {
  const locale = useContext(LocaleContext);
  const tone = toneFor(issue.severity);
  const icon = iconFor(issue.severity);
  const location = formatLocation(issue);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={tone}>{focused ? "▶ " : "  "}</Text>
        <Text color={tone}>{`[${icon}] `}</Text>
        <Text bold>{issue.rule}</Text>
      </Box>
      <Box marginLeft={6}>
        <Text>
          {location ? <Text dimColor>{`${location} — `}</Text> : null}
          {t(issue.messageKey, issue.params ?? {}, locale)}
        </Text>
      </Box>
      {expanded && issue.details !== undefined ? (
        <Box marginLeft={6} flexDirection="column">
          <ExpandedDetails details={issue.details} />
        </Box>
      ) : null}
    </Box>
  );
};

/**
 * `details` payload を、当てはまる shape 専用 view で render し、
 * それ以外は JSON pretty に fallback する。dispatch 順序が重要:
 * `expected/actual` と `hexPreview` の両方を持つ issue (例:
 * payload-digest mismatch) は diff と hex dump がこの順で積まれる。
 */
const ExpandedDetails: FC<{ details: unknown }> = ({ details }) => {
  if (typeof details !== "object" || details === null) {
    return <Text dimColor>{JSON.stringify(details, null, 2)}</Text>;
  }
  const d = details as Record<string, unknown>;

  const hasDiff = "expected" in d && "actual" in d;
  const warcHeader = Array.isArray(d["warcHeader"]) ? (d["warcHeader"] as unknown[]) : null;
  const hexPreview = Array.isArray(d["hexPreview"]) ? (d["hexPreview"] as unknown[]) : null;
  const candidates = Array.isArray(d["candidates"]) ? (d["candidates"] as unknown[]) : null;

  // 実際に発火した specialised view だけが field を消費するので、
  // pair の無い `expected` 単独 (`actual` 無し) は silent に drop
  // されず JSON-pretty の末尾 fallback に流れる。これが無いと、
  // `details: { expected: "data-package" }` の issue を expanded
  // view で開いたときに *何も* 表示されない。
  const consumed = new Set<string>();
  if (hasDiff) {
    consumed.add("expected");
    consumed.add("actual");
  }
  if (warcHeader) consumed.add("warcHeader");
  if (hexPreview) consumed.add("hexPreview");
  if (candidates) consumed.add("candidates");

  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    if (!consumed.has(k)) rest[k] = v;
  }

  return (
    <Box flexDirection="column">
      {hasDiff ? <DiffView expected={d["expected"]} actual={d["actual"]} /> : null}
      {candidates ? <CandidatesView candidates={candidates} /> : null}
      {warcHeader ? <WarcHeaderView lines={warcHeader} /> : null}
      {hexPreview ? <HexView lines={hexPreview} /> : null}
      {Object.keys(rest).length > 0 ? <Text dimColor>{JSON.stringify(rest, null, 2)}</Text> : null}
    </Box>
  );
};

const DiffView: FC<{ expected: unknown; actual: unknown }> = ({ expected, actual }) => (
  <Box flexDirection="column">
    <Box>
      <Text color="green">expected: </Text>
      <Text>{formatValue(expected)}</Text>
    </Box>
    <Box>
      <Text color="red">actual: </Text>
      <Text>{formatValue(actual)}</Text>
    </Box>
  </Box>
);

const WarcHeaderView: FC<{ lines: unknown[] }> = ({ lines }) => (
  <Box flexDirection="column" marginTop={1}>
    <Text dimColor>WARC record header:</Text>
    {lines.map((l, i) => (
      <Text key={`hdr-${String(i)}`}>
        {"  "}
        {String(l)}
      </Text>
    ))}
  </Box>
);

const HexView: FC<{ lines: unknown[] }> = ({ lines }) => (
  <Box flexDirection="column" marginTop={1}>
    <Text dimColor>Payload preview (hex):</Text>
    {lines.map((l, i) => (
      <Text key={`hex-${String(i)}`}>{String(l)}</Text>
    ))}
  </Box>
);

const CandidatesView: FC<{ candidates: unknown[] }> = ({ candidates }) => (
  <Box flexDirection="column" marginTop={1}>
    <Text dimColor>Nearby WARC members:</Text>
    {candidates.map((c, i) => (
      <Text key={`cand-${String(i)}`}>
        {"  "}
        {JSON.stringify(c)}
      </Text>
    ))}
  </Box>
);

const formatValue = (v: unknown): string => {
  if (typeof v === "string") return v;
  return JSON.stringify(v);
};

const Summary: FC<{ report: Report }> = ({ report }) => {
  const s = report.summary;
  // exactOptionalPropertyTypes は `color={... ? "red" : undefined}` を
  // 禁じる — prop 自体を省くのが等価。call site の見通しを保つため
  // 空オブジェクトを条件付きで spread する。
  const failedColor = s.failed > 0 ? { color: "red" as const } : {};
  const warningsColor = s.warnings > 0 ? { color: "yellow" as const } : {};
  return (
    <Box marginTop={1}>
      <Text color="green">{`${String(s.passed)} passed`}</Text>
      <Text>, </Text>
      <Text {...failedColor}>{`${String(s.failed)} failed`}</Text>
      <Text>, </Text>
      <Text {...warningsColor}>{`${String(s.warnings)} warnings`}</Text>
      <Text dimColor>{`  · ${String(s.durationMs)}ms`}</Text>
    </Box>
  );
};

const Help: FC = () => (
  <Box marginTop={1}>
    <Text dimColor>↑↓ navigate · enter expand · tab issues/layout · q quit</Text>
  </Box>
);

const toneFor = (severity: Issue["severity"]): "red" | "yellow" | "cyan" => {
  switch (severity) {
    case "error":
      return "red";
    case "warning":
      return "yellow";
    case "info":
      return "cyan";
  }
};

const iconFor = (severity: Issue["severity"]): string => {
  switch (severity) {
    case "error":
      return "✗";
    case "warning":
      return "!";
    case "info":
      return "i";
  }
};

const formatLocation = (issue: Issue): string => {
  const loc = issue.location;
  if (!loc) return "";
  let result = loc.entry ?? "";
  if (loc.line !== undefined) result += `:${String(loc.line)}`;
  if (loc.offset !== undefined) result += `@${String(loc.offset)}`;
  return result;
};
