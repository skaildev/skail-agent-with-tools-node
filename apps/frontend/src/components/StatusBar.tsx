import { AgentLimits, type CaseView } from "@skail-agent-with-tools/contracts";

export function statusLabel(supportCase: CaseView | undefined): string {
  if (!supportCase) return "Idle";
  switch (supportCase.phase) {
    case "Starting":
      return "Starting…";
    case "Thinking":
      return "Thinking";
    case "UsingTool":
      return "Using tool";
    case "Answered":
      return "Answered";
    case "Escalated":
      return "Escalated to a human";
    case "Failed":
      return "Failed";
  }
}

function badgeKind(supportCase: CaseView | undefined): string {
  const phase = supportCase?.phase;
  if (!phase) return "idle";
  if (phase === "Answered") return "done";
  if (phase === "Escalated") return "warn";
  if (phase === "Failed") return "failed";
  return "active";
}

/** The state of the case, the step counter, the model calls and which planner decides the steps. */
export function StatusBar({
  supportCase,
  monitorUrl,
}: {
  supportCase: CaseView | undefined;
  monitorUrl: string | null;
}) {
  return (
    <section className="status">
      <span className={`badge ${badgeKind(supportCase)}`}>{statusLabel(supportCase)}</span>
      <span aria-label="Step">
        Step <strong>{supportCase?.step ?? 0}</strong>/{AgentLimits.MaxSteps}
      </span>
      <span aria-label="Model calls">
        Model calls <strong>{supportCase?.modelCalls ?? 0}</strong>
      </span>
      <span>
        Planner{" "}
        <span className="pill" aria-label="Planner">
          {supportCase?.planner ?? "-"}
        </span>
      </span>
      {monitorUrl && (
        <a href={monitorUrl} target="_blank" rel="noopener noreferrer">
          Open the skail Monitor
        </a>
      )}
    </section>
  );
}
