import {
  isTerminalPhase,
  type CaseEvent,
  type CaseResult,
  type CaseState,
  type Decision,
} from "@skail-agent-with-tools/contracts";

interface Subscriber {
  onState: (state: CaseState) => void;
  onClose: () => void;
}

/**
 * In-memory state of the cases. The durable state lives in skail; this is only the UI view.
 * A step event is applied once (same case, stage and step), so a retried command does not count
 * a second model call.
 */
export class CaseStore {
  readonly #cases = new Map<string, CaseState>();
  readonly #seen = new Map<string, Set<string>>();
  readonly #subscribers = new Map<string, Set<Subscriber>>();

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  create(caseId: string, question: string): CaseState {
    const state: CaseState = {
      caseId,
      question,
      phase: "Starting",
      step: 0,
      modelCalls: 0,
      planner: null,
      timeline: [],
      result: null,
      error: null,
    };
    this.#cases.set(caseId, state);
    this.#seen.set(caseId, new Set());
    return state;
  }

  get(caseId: string): CaseState | undefined {
    return this.#cases.get(caseId);
  }

  remove(caseId: string): void {
    this.#cases.delete(caseId);
    this.#seen.delete(caseId);
    this.#close(caseId);
  }

  /** @returns true when the event changed the case; false when ignored (unknown or finished, duplicate). */
  apply(evt: CaseEvent): boolean {
    const state = this.#cases.get(evt.caseId);
    if (!state || isTerminalPhase(state.phase)) return false;
    const seen = this.#seen.get(evt.caseId)!;
    const key = `${evt.stage}:${evt.step}`;
    if (seen.has(key)) return false;

    let next: CaseState | null = null;
    switch (evt.stage) {
      case "Started":
        if (state.phase === "Starting")
          next = this.#add(
            { ...state, phase: "Thinking", planner: evt.planner },
            "Started",
            0,
            `Customer asked: ${state.question}`,
          );
        break;
      case "ModelDecided":
        if (evt.decision) next = this.#decided(state, evt.step, evt.decision);
        break;
      case "ToolUsed":
        next = this.#add(
          { ...state, phase: "Thinking" },
          "ToolResult",
          evt.step,
          `Step ${evt.step}: tool result: ${evt.text}`,
        );
        break;
      case "Answered":
        if (evt.result) next = this.#answered(state, evt.step, evt.result);
        break;
      case "Escalated":
        if (evt.result)
          next = this.#add(
            { ...state, phase: "Escalated", result: evt.result },
            "Handoff",
            evt.step,
            `No answer in ${evt.result.steps} steps: escalated to a human`,
          );
        break;
      case "Failed": {
        const error = evt.error ?? "unknown error";
        next = this.#add({ ...state, phase: "Failed", error }, "Failed", 0, error);
        break;
      }
    }
    if (!next) return false;
    seen.add(key);
    this.#publish(next);
    return true;
  }

  /** @returns the unsubscribe function. `onClose` is called when the case ends or is removed. */
  subscribe(caseId: string, onState: (state: CaseState) => void, onClose: () => void): () => void {
    const subscriber: Subscriber = { onState, onClose };
    let set = this.#subscribers.get(caseId);
    if (!set) this.#subscribers.set(caseId, (set = new Set()));
    set.add(subscriber);
    return () => void this.#subscribers.get(caseId)?.delete(subscriber);
  }

  #decided(state: CaseState, step: number, d: Decision): CaseState {
    const next = { ...state, step, modelCalls: state.modelCalls + 1 };
    if (d.answer?.trim())
      return this.#add(
        { ...next, phase: "Thinking" },
        "ModelAnswer",
        step,
        `Step ${step}: model answered: ${d.answer}`,
      );
    if (d.tool?.trim())
      return this.#add(
        { ...next, phase: "UsingTool" },
        "ModelTool",
        step,
        `Step ${step}: model chose ${d.tool}("${d.argument ?? ""}")`,
      );
    return this.#add(
      { ...next, phase: "Thinking" },
      "Invalid",
      step,
      `Step ${step}: invalid model decision, asking again`,
    );
  }

  #answered(state: CaseState, step: number, r: CaseResult): CaseState {
    return this.#add(
      { ...state, phase: "Answered", result: r },
      "Answer",
      step,
      `Step ${step}: answered the customer: ${r.text}`,
    );
  }

  #add(state: CaseState, kind: string, step: number, text: string): CaseState {
    return { ...state, timeline: [...state.timeline, { kind, step, text, at: this.now() }] };
  }

  #publish(state: CaseState): void {
    this.#cases.set(state.caseId, state);
    for (const subscriber of [...(this.#subscribers.get(state.caseId) ?? [])]) subscriber.onState(state);
    if (isTerminalPhase(state.phase)) this.#close(state.caseId);
  }

  #close(caseId: string): void {
    const set = this.#subscribers.get(caseId);
    if (!set) return;
    this.#subscribers.delete(caseId);
    for (const subscriber of set) subscriber.onClose();
  }
}
