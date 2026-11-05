import { useCallback, useEffect, useState } from "react";
import { AgentLimits, isTerminalPhase, startState, type CaseView } from "@skail-agent-with-tools/contracts";
import { getCase, getConfig, startCase } from "./api";
import { AgentTimeline } from "./components/AgentTimeline";
import { AskForm } from "./components/AskForm";
import { ResultBanner } from "./components/ResultBanner";
import { StatusBar } from "./components/StatusBar";
import { useCaseStream } from "./hooks/useCaseStream";

const KEY = "agent-with-tools.caseId";

export function App() {
  const [supportCase, setSupportCase] = useState<CaseView | undefined>();
  const [message, setMessage] = useState<string>(AgentLimits.defaultMessage);
  const [monitorUrl, setMonitorUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const forget = useCallback(() => localStorage.removeItem(KEY), []);
  const active = supportCase && !isTerminalPhase(supportCase.phase) ? supportCase.caseId : undefined;
  useCaseStream(active, setSupportCase, forget);

  useEffect(() => {
    getConfig().then(
      (config) => {
        setMonitorUrl(config.monitorUrl);
        setMessage((current) => (current === AgentLimits.defaultMessage ? config.defaultMessage : current));
      },
      () => {},
    );
  }, []);

  // a reload keeps the page right: the state always comes from the server
  useEffect(() => {
    const saved = localStorage.getItem(KEY);
    if (!saved) return;
    getCase(saved).then((restored) => {
      if (!restored) return forget();
      setSupportCase(restored);
      setMessage(restored.question);
      if (isTerminalPhase(restored.phase)) forget();
    }, forget);
  }, [forget]);

  const ui = startState(supportCase);

  async function onAsk() {
    setBusy(true);
    setError(null);
    try {
      const started = await startCase(message);
      localStorage.setItem(KEY, started.caseId);
      setSupportCase(started);
    } catch (e) {
      setError(`Could not start: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <header>
        <h1>Agent with tools</h1>
        <p className="subtitle">
          A skail function runs a support agent in a loop: at each step the model decides to use a tool (look up the
          order, track the delivery) or to answer the customer. Each decision and each tool call is a recorded step, so
          if the worker stops, the case resumes without asking the model again. With no answer in {AgentLimits.MaxSteps}{" "}
          steps, the case goes to a person.
        </p>
      </header>

      <AskForm message={message} ui={ui} busy={busy} onMessage={setMessage} onAsk={onAsk} />

      <StatusBar supportCase={supportCase} monitorUrl={monitorUrl} />

      {(error ?? supportCase?.error) && <p className="error">{error ?? supportCase?.error}</p>}
      {supportCase && <ResultBanner supportCase={supportCase} />}

      <h2>Agent timeline</h2>
      <AgentTimeline supportCase={supportCase} />

      <footer>
        Case <code>{supportCase?.caseId ?? "-"}</code>
      </footer>
    </main>
  );
}
