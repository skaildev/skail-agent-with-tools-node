// Shared by web, worker and front end. It also goes into the skail bundle, so it holds only pure types,
// constants and functions, with no Node I/O imports. JSON uses camelCase, and enums are strings.

/** Tool names, shared by the model prompt, the planners and the command that runs them. */
export const Tools = {
  LookUpOrder: "LookUpOrder",
  TrackDelivery: "TrackDelivery",
  isKnown: (name: unknown): name is string => name === "LookUpOrder" || name === "TrackDelivery",
} as const;

export const AgentLimits = {
  MaxSteps: 6,
  defaultMessage: "Where is my order 1234?",
  maxMessageLength: 300,
} as const;

/**
 * What the model decided for a step: a tool (with its argument) or an answer to the customer. The three fields
 * are always present (null when absent) so the value survives skail's JSON history. An all-empty decision is an
 * invalid one: the function warns the model and asks again.
 */
export interface Decision {
  tool: string | null;
  argument: string | null;
  answer: string | null;
}

export const Decision = {
  empty: { tool: null, argument: null, answer: null } as Decision,
  useTool: (tool: string, argument: string): Decision => ({ tool, argument, answer: null }),
  answerWith: (answer: string): Decision => ({ tool: null, argument: null, answer }),
  isEmpty: (d: Decision): boolean => !d.tool?.trim() && !d.answer?.trim(),
};

/**
 * How the conversation lines are written. The lines go to skail's history on every model call,
 * so tool results are kept short.
 */
export const Conversation = {
  invalidDecision: "system: invalid decision. Use a tool or answer the customer.",
  maxResult: 200,
  customer: (question: string): string => `customer: ${question}`,
  tool(tool: string, argument: string | null | undefined, result: string): string {
    const clipped = result.length <= Conversation.maxResult ? result : `${result.slice(0, Conversation.maxResult)}…`;
    return `${tool}(${argument ?? ""}) => ${clipped}`;
  },
};

export type CaseEnd = "Answered" | "Escalated";

export interface CaseResult {
  caseId: string;
  end: CaseEnd;
  text: string;
  steps: number;
  conversation: string[];
}

export const CaseResult = {
  answered: (caseId: string, answer: string, steps: number): CaseResult => ({
    caseId,
    end: "Answered",
    text: answer,
    steps,
    conversation: [],
  }),
  escalated: (caseId: string, conversation: string[]): CaseResult => ({
    caseId,
    end: "Escalated",
    text: `no answer in ${AgentLimits.MaxSteps} steps: case escalated to a human`,
    steps: AgentLimits.MaxSteps,
    conversation,
  }),
};

export type CaseStage = "Started" | "ModelDecided" | "ToolUsed" | "Answered" | "Escalated" | "Failed";

/** Progress reported by the worker to the web app (the page is only a view; skail holds the state). */
export interface CaseEvent {
  caseId: string;
  stage: CaseStage;
  step: number;
  text: string | null;
  decision: Decision | null;
  tool: string | null;
  argument: string | null;
  planner: string | null;
  result: CaseResult | null;
  error: string | null;
}

const event = (caseId: string, stage: CaseStage, step: number, rest: Partial<CaseEvent> = {}): CaseEvent => ({
  caseId,
  stage,
  step,
  text: null,
  decision: null,
  tool: null,
  argument: null,
  planner: null,
  result: null,
  error: null,
  ...rest,
});

export const CaseEvent = {
  started: (caseId: string, question: string) => event(caseId, "Started", 0, { text: question }),
  modelDecided: (caseId: string, step: number, decision: Decision) => event(caseId, "ModelDecided", step, { decision }),
  toolUsed: (caseId: string, step: number, tool: string, argument: string, result: string) =>
    event(caseId, "ToolUsed", step, { text: result, tool, argument }),
  answered: (caseId: string, result: CaseResult) => event(caseId, "Answered", result.steps, { result }),
  escalated: (caseId: string, result: CaseResult) => event(caseId, "Escalated", result.steps, { result }),
  failed: (caseId: string, error: string) => event(caseId, "Failed", 0, { error }),
};

// ---- web view (what GET /api/cases/{id} and the SSE stream return) ----

export type CasePhase = "Starting" | "Thinking" | "UsingTool" | "Answered" | "Escalated" | "Failed";

export interface TimelineEntry {
  kind: string;
  step: number;
  text: string;
  at: string;
}

export interface CaseState {
  caseId: string;
  question: string;
  phase: CasePhase;
  step: number;
  modelCalls: number;
  planner: string | null;
  timeline: TimelineEntry[];
  result: CaseResult | null;
  error: string | null;
}

export interface CaseView extends CaseState {
  active: boolean;
}

export interface AppConfig {
  defaultMessage: string;
  monitorUrl: string | null;
}

export function isTerminalPhase(phase: CasePhase): boolean {
  return phase === "Answered" || phase === "Escalated" || phase === "Failed";
}

export interface UiState {
  label: string;
  enabled: boolean;
}

/** The message field and the Ask button are available only when there is no case in progress. */
export function startState(supportCase: Pick<CaseState, "phase"> | undefined): UiState {
  return !supportCase || isTerminalPhase(supportCase.phase)
    ? { label: "Ask", enabled: true }
    : { label: "Working…", enabled: false };
}
