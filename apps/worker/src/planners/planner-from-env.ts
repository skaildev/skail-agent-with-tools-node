import type { Fetch } from "../web.js";
import type { Planner } from "./planner.js";
import { SamplePlanner } from "./sample-planner.js";
import { OpenAIPlanner } from "./openai-planner.js";

/**
 * Picks the planner from process.env at run time: OPENAI_API_KEY set means OpenAI (OPENAI_MODEL, default
 * gpt-4o-mini), otherwise the offline sample planner (SAMPLE_PLANNER_DELAY_MS). Resolved once and reused by the
 * later calls of the activation. It reads process.env, so it only runs inside a command.
 */
export function plannerFromEnv(fetchImpl?: Fetch): () => Promise<Planner> {
  let resolved: Promise<Planner> | undefined;

  const resolve = async (): Promise<Planner> => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) return new OpenAIPlanner(apiKey, process.env.OPENAI_MODEL || "gpt-4o-mini", fetchImpl);

    const delay = Number(process.env.SAMPLE_PLANNER_DELAY_MS || 0);
    return new SamplePlanner(Number.isFinite(delay) && delay > 0 ? delay : 0);
  };

  return () => (resolved ??= resolve());
}
