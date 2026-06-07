/**
 * Ink TUI renderer(daemon クライアント側の薄い表示器)。
 *
 * validation は daemon が行い、message / specUrl / conformance まで解決済みの
 * {@link WireReport} を受け取るので、ここでは core の i18n も lookup も呼ばず
 * 解決済みフィールドをそのまま描く(`@waxlens/core` を import しない)。
 *
 * Layout ビューでファイルを選んで `enter` を押すと、`requestContent`(daemon の
 * `waxlens/readEntry` への薄いブリッジ)でそのファイルの内容を取得し、右ペインに
 * 表示する。`requestContent` 未指定(テスト等)なら no-op。
 *
 * Exit code の経路: CLI は `render(...)` の後に `instance.waitUntilExit()` を
 * await し、その後 `process.exitCode` をセットする。
 */
import { useMemo, useState, type FC } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { ReportEntry, WireIssue, WireReport } from "@waxlens/protocol";
import { buildEntryTree, entryMarker, flattenTree, type TreeRow } from "./render/tree.js";
import { codecName, entryIssues, expectedLabel } from "./render/detail.js";

interface AppProps {
  report: WireReport;
  /** Layout で enter 時に呼ぶ内容取得ブリッジ(daemon の readEntry)。省略可。 */
  requestContent?: (path: string) => Promise<string>;
}

type View = "issues" | "layout";

/** 右ペインに出す content の表示上限(行)。daemon 側で byte 上限も掛かっている。 */
const CONTENT_MAX_LINES = 40;

export const App: FC<AppProps> = ({ report, requestContent }) => {
  const { exit } = useApp();
  const [view, setView] = useState<View>("issues");
  const [focused, setFocused] = useState(0);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  // Layout で enter したファイルの内容(ナビゲーションで都度クリア)。
  const [content, setContent] = useState<string | null>(null);

  const issues = report.issues;
  // §5.1 風ツリーの行(report が変わらない限り再計算しない)。
  const layoutRows = useMemo(() => flattenTree(buildEntryTree(report.entries)), [report.entries]);
  const rowCount = view === "issues" ? issues.length : layoutRows.length;

  useInput((input, key) => {
    if (input === "q" || key.escape) {
      exit();
      return;
    }
    if (key.tab) {
      setView((prev) => (prev === "issues" ? "layout" : "issues"));
      setFocused(0);
      setContent(null);
      return;
    }
    if (key.upArrow && rowCount > 0) {
      setFocused((prev) => Math.max(0, prev - 1));
      setContent(null);
      return;
    }
    if (key.downArrow && rowCount > 0) {
      setFocused((prev) => Math.min(rowCount - 1, prev + 1));
      setContent(null);
      return;
    }
    if (key.return && view === "issues" && issues.length > 0) {
      // focused な issue の expansion をトグル(参照同一性のため set を作り直す)。
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(focused)) next.delete(focused);
        else next.add(focused);
        return next;
      });
      return;
    }
    if (key.return && view === "layout" && requestContent) {
      // focused 行のファイル内容を daemon から取得して右ペインに出す。
      const entry = layoutRows[focused]?.entry;
      if (entry?.present === true) {
        void requestContent(entry.path).then(setContent, () => {
          setContent("(content unavailable)");
        });
      }
    }
  });

  return (
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
          <LayoutView rows={layoutRows} focused={focused} report={report} content={content} />
        )}
      </Box>
      <Summary report={report} />
      {report.stats ? <Stats stats={report.stats} /> : null}
      <Help />
    </Box>
  );
};

/**
 * Layout ビュー: 左に §5.1 風ツリー(状態アイコン ✗/⚠ + size)、右に
 * 選択行(focused)の詳細ペイン。enter で取得した内容(`content`)も右ペインに出す。
 */
const LayoutView: FC<{
  rows: TreeRow[];
  focused: number;
  report: WireReport;
  content: string | null;
}> = ({ rows, focused, report, content }) => {
  if (rows.length === 0) return <Text dimColor>(no entries)</Text>;
  const selected = rows[focused]?.entry;
  return (
    <Box>
      <Box flexDirection="column" flexShrink={0}>
        {rows.map((row, i) => {
          const mk = entryMarker(row.entry);
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
      <Box
        flexDirection="column"
        flexGrow={1}
        marginLeft={2}
        borderStyle="round"
        borderDimColor
        paddingX={1}
      >
        <DetailPane entry={selected} report={report} content={content} />
      </Box>
    </Box>
  );
};

/** 右ペイン: 選択 entry のメタ情報 + 紐づく issue + enter で取得した内容。 */
const DetailPane: FC<{
  entry: ReportEntry | undefined;
  report: WireReport;
  content: string | null;
}> = ({ entry, report, content }) => {
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
      {content !== null ? <ContentView content={content} /> : null}
      {content === null && entry.present ? (
        <Box marginTop={1}>
          <Text dimColor>enter で内容を表示</Text>
        </Box>
      ) : null}
    </Box>
  );
};

/** enter で取得したファイル内容を表示(行数上限で打ち切り)。 */
const ContentView: FC<{ content: string }> = ({ content }) => {
  const lines = content.split("\n");
  const shown = lines.slice(0, CONTENT_MAX_LINES);
  const truncated = lines.length > CONTENT_MAX_LINES;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>content</Text>
      {shown.map((line, i) => (
        <Text key={`content-${String(i)}`}>{line}</Text>
      ))}
      {truncated ? <Text dimColor>{`… (+${String(lines.length - CONTENT_MAX_LINES)} more lines)`}</Text> : null}
    </Box>
  );
};

/** 選択 file に紐づく issue を全文(icon + rule + message + location)で列挙。 */
const IssueList: FC<{ entry: ReportEntry; report: WireReport }> = ({ entry, report }) => {
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

/** daemon が解決した specUrl があれば spec への直リンク行を出す(dimmed)。 */
const SpecLink: FC<{ issue: WireIssue; indent: number }> = ({ issue, indent }) => {
  if (issue.specUrl === undefined) return null;
  return (
    <Box marginLeft={indent}>
      <Text dimColor>{`spec ${issue.specUrl}`}</Text>
    </Box>
  );
};

/** spec の規範レベル(MUST/SHOULD/MAY)を rule 名の後に併記。severity とは別軸。 */
const ConfBadge: FC<{ conformance: string | undefined }> = ({ conformance }) => {
  if (conformance === undefined) return null;
  return <Text color="magenta">{` ${conformance}`}</Text>;
};

const IssueLine: FC<{ issue: WireIssue }> = ({ issue }) => {
  const tone = toneFor(issue.severity);
  const loc = formatLocation(issue);
  return (
    <Box flexDirection="column">
      <Box>
        <Text color={tone}>{`${iconFor(issue.severity)} ${issue.rule}`}</Text>
        <ConfBadge conformance={issue.conformance} />
      </Box>
      <Box marginLeft={2}>
        <Text>
          {loc ? <Text dimColor>{`${loc} — `}</Text> : null}
          {issue.message}
        </Text>
      </Box>
      <SpecLink issue={issue} indent={2} />
    </Box>
  );
};

const Stats: FC<{ stats: NonNullable<WireReport["stats"]> }> = ({ stats }) => {
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

const Header: FC<{ report: WireReport; view: View }> = ({ report, view }) => {
  const sourceLabel = report.source.kind === "file" ? report.source.path : report.source.uri;
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

const IssueRow: FC<{ issue: WireIssue; focused: boolean; expanded: boolean }> = ({
  issue,
  focused,
  expanded,
}) => {
  const tone = toneFor(issue.severity);
  const icon = iconFor(issue.severity);
  const location = formatLocation(issue);

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={tone}>{focused ? "▶ " : "  "}</Text>
        <Text color={tone}>{`[${icon}] `}</Text>
        <Text bold>{issue.rule}</Text>
        <ConfBadge conformance={issue.conformance} />
      </Box>
      <Box marginLeft={6}>
        <Text>
          {location ? <Text dimColor>{`${location} — `}</Text> : null}
          {issue.message}
        </Text>
      </Box>
      <SpecLink issue={issue} indent={6} />
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
 * それ以外は JSON pretty に fallback する。
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

const Summary: FC<{ report: WireReport }> = ({ report }) => {
  const s = report.summary;
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
    <Text dimColor>↑↓ navigate · enter expand/show · tab issues/layout · q quit</Text>
  </Box>
);

const toneFor = (severity: WireIssue["severity"]): "red" | "yellow" | "cyan" => {
  switch (severity) {
    case "error":
      return "red";
    case "warning":
      return "yellow";
    default:
      return "cyan";
  }
};

const iconFor = (severity: WireIssue["severity"]): string => {
  switch (severity) {
    case "error":
      return "✗";
    case "warning":
      return "!";
    default:
      return "i";
  }
};

const formatLocation = (issue: WireIssue): string => {
  const loc = issue.location;
  if (!loc) return "";
  let result = loc.entry ?? "";
  if (loc.line !== undefined) result += `:${String(loc.line)}`;
  if (loc.offset !== undefined) result += `@${String(loc.offset)}`;
  return result;
};
