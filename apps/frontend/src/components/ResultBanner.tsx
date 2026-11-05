import type { CaseView } from "@skail-agent-with-tools/contracts";

export function ResultBanner({ supportCase }: { supportCase: CaseView }) {
  const r = supportCase.result;
  if (!r) return null;

  if (r.end === "Answered") {
    return (
      <div role="status" aria-label="Result" className="result ok">
        <strong>Answered</strong> · {r.text}
      </div>
    );
  }
  return (
    <div role="status" aria-label="Result" className="result warn">
      <strong>Escalated to a human</strong> · {r.text}
      <pre className="conversation">{r.conversation.join("\n")}</pre>
    </div>
  );
}
