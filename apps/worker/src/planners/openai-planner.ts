import { Decision, Tools } from "@skail-agent-with-tools/contracts";
import type { Fetch } from "../web.js";
import type { Planner } from "./planner.js";

const ENDPOINT = "https://api.openai.com/v1/chat/completions";

const PROMPT = `You are a customer support agent. Decide the next step from the conversation.
Tools: ${Tools.LookUpOrder}(order number) and ${Tools.TrackDelivery}(tracking code).
Reply ONLY with JSON: {"tool": string|null, "argument": string|null, "answer": string|null}.
Either use a tool or answer the customer, never both.`;

/**
 * Asks an OpenAI chat model for the next step. The key is only used in the request header: it is never
 * logged, notified or returned. An answer outside the expected format is an empty (invalid) decision, not an error;
 * an HTTP failure throws so skail retries the command.
 */
export class OpenAIPlanner implements Planner {
  readonly name = "OpenAI";

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly fetchImpl: Fetch = (url, init) => fetch(url, init),
  ) {}

  async nextStep(conversation: string[]): Promise<Decision> {
    const response = await this.fetchImpl(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: PROMPT },
          { role: "user", content: conversation.join("\n") },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    // the body is not echoed: an error response must never carry anything but the status
    if (!response.ok) throw new Error(`OpenAI answered ${response.status}`);
    return parse(await response.text());
  }
}

function parse(body: string): Decision {
  try {
    const content = (JSON.parse(body) as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message
      ?.content;
    const root: unknown = JSON.parse(typeof content === "string" ? content : "");
    if (root === null || typeof root !== "object" || Array.isArray(root)) return Decision.empty;
    const r = root as Record<string, unknown>;
    return { tool: text(r.tool), argument: text(r.argument), answer: text(r.answer) };
  } catch {
    return Decision.empty;
  }
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
