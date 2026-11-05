import type { AppConfig, CaseView } from "@skail-agent-with-tools/contracts";

async function failure(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return new Error(body.error ?? `HTTP ${res.status}`);
}

export async function startCase(message: string): Promise<CaseView> {
  const res = await fetch("/api/cases", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw await failure(res);
  return res.json();
}

export async function getCase(caseId: string): Promise<CaseView | null> {
  const res = await fetch(`/api/cases/${caseId}`);
  return res.ok ? res.json() : null;
}

export async function getConfig(): Promise<AppConfig> {
  const res = await fetch("/api/config");
  if (!res.ok) throw await failure(res);
  return res.json();
}
