import { beforeEach, describe, expect, it } from "vitest";
import { CaseEvent, CaseResult, Decision, type CaseState } from "@skail-agent-with-tools/contracts";
import { CaseStore } from "../src/case-store.js";

let store: CaseStore;
const get = () => store.get("a1")!;
const texts = () => get().timeline.map((t) => t.text);

beforeEach(() => {
  store = new CaseStore(() => "2026-01-01T10:00:00.000Z");
  store.create("a1", "Where is my order 1234?");
});

const started = (planner = "Sample planner") => ({ ...CaseEvent.started("a1", "x"), planner });

describe("CaseStore", () => {
  it("starts in Starting with no steps", () => {
    expect(get()).toMatchObject({
      question: "Where is my order 1234?",
      phase: "Starting",
      step: 0,
      modelCalls: 0,
      planner: null,
      timeline: [],
      result: null,
    });
  });

  it("Started moves to Thinking and records the planner", () => {
    expect(store.apply(started())).toBe(true);
    expect(get()).toMatchObject({ phase: "Thinking", planner: "Sample planner" });
    expect(texts()).toEqual(["Customer asked: Where is my order 1234?"]);
  });

  it("follows the demo flow in order and counts one model call per decision", () => {
    store.apply(started());
    store.apply(CaseEvent.modelDecided("a1", 1, Decision.useTool("LookUpOrder", "1234")));
    expect(get()).toMatchObject({ phase: "UsingTool", step: 1, modelCalls: 1 });
    store.apply(CaseEvent.toolUsed("a1", 1, "LookUpOrder", "1234", "enviado"));
    expect(get().phase).toBe("Thinking");
    store.apply(CaseEvent.modelDecided("a1", 2, Decision.answerWith("Arrives tomorrow")));
    store.apply(CaseEvent.answered("a1", CaseResult.answered("a1", "Arrives tomorrow", 2)));

    expect(get()).toMatchObject({ phase: "Answered", modelCalls: 2, result: { end: "Answered" } });
    expect(texts()).toEqual([
      "Customer asked: Where is my order 1234?",
      'Step 1: model chose LookUpOrder("1234")',
      "Step 1: tool result: enviado",
      "Step 2: model answered: Arrives tomorrow",
      "Step 2: answered the customer: Arrives tomorrow",
    ]);
    expect(get().timeline.map((t) => t.kind)).toEqual(["Started", "ModelTool", "ToolResult", "ModelAnswer", "Answer"]);
  });

  it("an empty decision is shown as invalid and still counts as a model call", () => {
    store.apply(started());
    store.apply(CaseEvent.modelDecided("a1", 1, Decision.empty));
    expect(texts().at(-1)).toBe("Step 1: invalid model decision, asking again");
    expect(get()).toMatchObject({ phase: "Thinking", modelCalls: 1 });
  });

  it("escalation ends in Escalated with the result", () => {
    store.apply(started());
    store.apply(CaseEvent.escalated("a1", CaseResult.escalated("a1", ["customer: x"])));
    expect(get()).toMatchObject({ phase: "Escalated", result: { end: "Escalated", conversation: ["customer: x"] } });
    expect(texts().at(-1)).toBe("No answer in 6 steps: escalated to a human");
  });

  it("Failed ends in Failed with the error", () => {
    store.apply(started());
    store.apply(CaseEvent.failed("a1", "boom"));
    expect(get()).toMatchObject({ phase: "Failed", error: "boom" });
  });

  it("ignores a duplicate event (same stage and step): a retried command does not count a second model call", () => {
    store.apply(started());
    const decided = CaseEvent.modelDecided("a1", 1, Decision.useTool("LookUpOrder", "1"));
    expect(store.apply(decided)).toBe(true);
    expect(store.apply(decided)).toBe(false);
    expect(store.apply(started())).toBe(false);
    expect(get().modelCalls).toBe(1);
    expect(get().timeline).toHaveLength(2);
  });

  it("ignores events for unknown cases and after a terminal state", () => {
    expect(store.apply({ ...started(), caseId: "nope" })).toBe(false);
    store.apply(started());
    store.apply(CaseEvent.failed("a1", "x"));
    expect(store.apply(CaseEvent.modelDecided("a1", 1, Decision.empty))).toBe(false);
    expect(get().modelCalls).toBe(0);
  });

  it("remove forgets the case", () => {
    store.remove("a1");
    expect(store.get("a1")).toBeUndefined();
  });

  it("subscribers get a snapshot per change and are closed at the terminal state", () => {
    const seen: CaseState[] = [];
    let closed = 0;
    store.subscribe(
      "a1",
      (s) => seen.push(s),
      () => closed++,
    );
    store.apply(started());
    store.apply(CaseEvent.modelDecided("a1", 1, Decision.answerWith("x")));
    expect(seen.map((s) => s.phase)).toEqual(["Thinking", "Thinking"]);
    expect(closed).toBe(0);
    store.apply(CaseEvent.answered("a1", CaseResult.answered("a1", "x", 1)));
    expect(seen.at(-1)!.phase).toBe("Answered");
    expect(closed).toBe(1);
  });

  it("unsubscribe stops the updates", () => {
    const seen: CaseState[] = [];
    const off = store.subscribe(
      "a1",
      (s) => seen.push(s),
      () => {},
    );
    off();
    store.apply(started());
    expect(seen).toHaveLength(0);
  });
});
