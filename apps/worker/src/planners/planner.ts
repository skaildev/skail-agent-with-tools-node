import type { Decision } from "@skail-agent-with-tools/contracts";

/** Decides the next step from the conversation so far. Runs only inside the DecideNextStep command. */
export interface Planner {
  /** Shown on the page. */
  readonly name: string;
  nextStep(conversation: string[]): Promise<Decision>;
}
