/**
 * Ink TUI renderer.
 *
 * Shape:
 *
 *   waxlens 0.0.0  /path/to/file.wacz
 *
 *   ▶ [✗] datapackage/profile-required
 *       datapackage.json is missing the "profile" field
 *       { "expected": "data-package" }              ← shown only when expanded
 *     [✗] cdxj/filename-archive-relative
 *       indexes/index.cdxj:1 — entry "filename" starts with "archive/"
 *
 *   1 passed, 2 failed, 0 warnings  · 12ms
 *   ↑↓ navigate · enter expand · q quit
 *
 * One issue per row, `▶` marks the cursor, `enter` toggles `details`. We
 * deliberately render the same `Issue.details` payload that the JSON
 * renderer emits — so the human and machine views never diverge.
 *
 * Exit code routing: the CLI sets `process.exitCode` *before* calling
 * `render(...)`, then awaits `instance.waitUntilExit()`. The TUI calls
 * `useApp().exit()` on `q`; Node uses `process.exitCode` for the final
 * status. This avoids needing to plumb the code through Ink's
 * `exit(reason?)` argument (which is reserved for error objects).
 */
import { useState, type FC } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { Issue, Report } from "../validate/types.js";

interface AppProps {
  report: Report;
}

export const App: FC<AppProps> = ({ report }) => {
  const { exit } = useApp();
  const [focused, setFocused] = useState(0);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());

  const issues = report.issues;

  useInput((input, key) => {
    if (input === "q" || key.escape) {
      exit();
      return;
    }
    if (key.upArrow && issues.length > 0) {
      setFocused((prev) => Math.max(0, prev - 1));
      return;
    }
    if (key.downArrow && issues.length > 0) {
      setFocused((prev) => Math.min(issues.length - 1, prev + 1));
      return;
    }
    if (key.return && issues.length > 0) {
      // Toggle expansion of the focused issue. The set is rebuilt to keep
      // the reference identity stable for React's diffing.
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(focused)) next.delete(focused);
        else next.add(focused);
        return next;
      });
    }
  });

  return (
    <Box flexDirection="column">
      <Header report={report} />
      <Box marginTop={1} flexDirection="column">
        {issues.length === 0 ? (
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
        )}
      </Box>
      <Summary report={report} />
      <Help />
    </Box>
  );
};

const Header: FC<{ report: Report }> = ({ report }) => (
  <Box>
    <Text bold>waxlens</Text>
    <Text dimColor> {report.waxlensVersion} </Text>
    <Text> {report.file}</Text>
  </Box>
);

const IssueRow: FC<{ issue: Issue; focused: boolean; expanded: boolean }> = ({
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
      </Box>
      <Box marginLeft={6}>
        <Text>
          {location ? <Text dimColor>{`${location} — `}</Text> : null}
          {issue.message}
        </Text>
      </Box>
      {expanded && issue.details !== undefined ? (
        <Box marginLeft={6} flexDirection="column">
          <Text dimColor>{JSON.stringify(issue.details, null, 2)}</Text>
        </Box>
      ) : null}
    </Box>
  );
};

const Summary: FC<{ report: Report }> = ({ report }) => {
  const s = report.summary;
  // exactOptionalPropertyTypes forbids `color={... ? "red" : undefined}` —
  // omitting the prop entirely is the equivalent. Conditionally spread an
  // empty object so the call site stays readable.
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
    <Text dimColor>↑↓ navigate · enter expand · q quit</Text>
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
