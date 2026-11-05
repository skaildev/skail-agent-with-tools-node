import type { CaseEvent } from "@skail-agent-with-tools/contracts";

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface ProgressNotifier {
  notify(event: CaseEvent): Promise<void>;
}

/** Reports progress to the web app: POST {web}/internal/cases/{id}/events. */
export class HttpProgressNotifier implements ProgressNotifier {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: Fetch = (url, init) => fetch(url, init),
  ) {}

  async notify(event: CaseEvent): Promise<void> {
    const base = this.baseUrl.endsWith("/") ? this.baseUrl : `${this.baseUrl}/`;
    const response = await this.fetchImpl(`${base}internal/cases/${encodeURIComponent(event.caseId)}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
    if (!response.ok) throw new Error(`Web app answered ${response.status} to the progress event`);
  }
}
