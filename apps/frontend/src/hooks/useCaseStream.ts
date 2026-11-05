import { useEffect } from "react";
import { isTerminalPhase, type CaseView } from "@skail-agent-with-tools/contracts";

/**
 * Follows a case through SSE. EventSource reconnects by itself and the stream starts with the current
 * snapshot, so no update is lost. Closes at a terminal phase.
 */
export function useCaseStream(
  caseId: string | undefined,
  onState: (supportCase: CaseView) => void,
  onTerminal: () => void,
) {
  useEffect(() => {
    if (!caseId) return;
    const source = new EventSource(`/api/cases/${caseId}/stream`);
    source.onmessage = (event) => {
      const supportCase = JSON.parse(event.data) as CaseView;
      onState(supportCase);
      if (isTerminalPhase(supportCase.phase)) {
        source.close();
        onTerminal();
      }
    };
    return () => source.close();
    // callbacks are stable (state setters); the stream only depends on the case id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);
}
