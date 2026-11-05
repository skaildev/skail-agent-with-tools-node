import type { UiState } from "@skail-agent-with-tools/contracts";

interface Props {
  message: string;
  ui: UiState;
  busy: boolean;
  onMessage: (message: string) => void;
  onAsk: () => void;
}

export function AskForm({ message, ui, busy, onMessage, onAsk }: Props) {
  return (
    <section className="controls">
      <label htmlFor="message">Customer message</label>
      <input
        id="message"
        value={message}
        disabled={!ui.enabled || busy}
        maxLength={300}
        onChange={(e) => onMessage(e.target.value)}
      />
      <button id="ask" type="button" disabled={!ui.enabled || busy} onClick={onAsk}>
        {ui.label}
      </button>
    </section>
  );
}
