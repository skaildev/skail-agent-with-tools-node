import type { CaseView } from "@skail-agent-with-tools/contracts";
import { StepItem } from "./StepItem";

export function AgentTimeline({ supportCase }: { supportCase: CaseView | undefined }) {
  return (
    <ol aria-label="Agent timeline" className="timeline">
      {(supportCase?.timeline ?? []).map((entry, i) => (
        <StepItem key={i} entry={entry} />
      ))}
    </ol>
  );
}
