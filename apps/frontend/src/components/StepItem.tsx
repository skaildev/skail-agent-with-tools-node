import type { TimelineEntry } from "@skail-agent-with-tools/contracts";

const ICONS: Record<string, string> = {
  Started: "💬",
  ModelTool: "🧠",
  ModelAnswer: "🧠",
  ToolResult: "🔧",
  Invalid: "⚠️",
  Answer: "✅",
  Handoff: "🙋",
  Failed: "❌",
};

const LABELS: Record<string, string> = {
  Started: "customer",
  ModelTool: "model decision",
  ModelAnswer: "model decision",
  ToolResult: "tool result",
  Invalid: "invalid decision",
  Answer: "answer",
  Handoff: "handoff",
  Failed: "failure",
};

export function StepItem({ entry }: { entry: TimelineEntry }) {
  return (
    <li data-kind={entry.kind} className={`step ${entry.kind}`}>
      <span className="icon" role="img" aria-label={LABELS[entry.kind] ?? entry.kind}>
        {ICONS[entry.kind] ?? "•"}
      </span>
      <time>{new Date(entry.at).toLocaleTimeString("en-US")}</time> {entry.text}
    </li>
  );
}
