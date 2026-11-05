import { describe, expect, it } from "vitest";
import {
  CaseEvent,
  CaseResult,
  Conversation,
  Decision,
  Tools,
  AgentLimits,
  isTerminalPhase,
  startState,
} from "../src/index.js";

describe("Tools", () => {
  it("names the two tools and knows them", () => {
    expect(Tools.LookUpOrder).toBe("LookUpOrder");
    expect(Tools.TrackDelivery).toBe("TrackDelivery");
    expect(Tools.isKnown("LookUpOrder")).toBe(true);
    expect(Tools.isKnown("DeleteOrder")).toBe(false);
    expect(Tools.isKnown(null)).toBe(false);
  });
});

describe("AgentLimits", () => {
  it("allows 6 steps by default", () => {
    expect(AgentLimits.MaxSteps).toBe(6);
    expect(AgentLimits.defaultMessage).toBe("Where is my order 1234?");
  });
});

describe("Decision", () => {
  it("always carries the three fields, null when absent", () => {
    expect(Decision.empty).toEqual({ tool: null, argument: null, answer: null });
    expect(Decision.useTool("LookUpOrder", "1234")).toEqual({ tool: "LookUpOrder", argument: "1234", answer: null });
    expect(Decision.answerWith("hi")).toEqual({ tool: null, argument: null, answer: "hi" });
  });

  it("is empty when it has neither a tool nor an answer", () => {
    expect(Decision.isEmpty(Decision.empty)).toBe(true);
    expect(Decision.isEmpty({ tool: " ", argument: "x", answer: "" })).toBe(true);
    expect(Decision.isEmpty(Decision.answerWith("hi"))).toBe(false);
    expect(Decision.isEmpty(Decision.useTool("X", ""))).toBe(false);
  });

  it("survives a JSON round trip with the null fields", () => {
    const json = JSON.stringify(Decision.answerWith("hi"));
    expect(json).toBe('{"tool":null,"argument":null,"answer":"hi"}');
    expect(JSON.parse(json)).toEqual(Decision.answerWith("hi"));
  });
});

describe("Conversation", () => {
  it("writes the customer line and the warning", () => {
    expect(Conversation.customer("hi")).toBe("customer: hi");
    expect(Conversation.invalidDecision).toBe("system: invalid decision. Use a tool or answer the customer.");
  });

  it("writes a tool line", () => {
    expect(Conversation.tool("LookUpOrder", "1234", "enviado")).toBe("LookUpOrder(1234) => enviado");
  });

  it("truncates a long tool result at 200 characters", () => {
    const line = Conversation.tool("LookUpOrder", "1", "x".repeat(500));
    expect(line).toBe(`LookUpOrder(1) => ${"x".repeat(200)}…`);
    expect(Conversation.tool("A", "1", "y".repeat(200))).toBe(`A(1) => ${"y".repeat(200)}`);
  });

  it("tolerates a missing argument", () => {
    expect(Conversation.tool("A", null, "r")).toBe("A() => r");
  });
});

describe("CaseResult", () => {
  it("answered", () => {
    expect(CaseResult.answered("a1", "Your order has arrived", 2)).toEqual({
      caseId: "a1",
      end: "Answered",
      text: "Your order has arrived",
      steps: 2,
      conversation: [],
    });
  });

  it("escalated keeps the conversation and uses all the steps", () => {
    const r = CaseResult.escalated("a1", ["customer: x"]);
    expect(r).toMatchObject({ end: "Escalated", steps: 6, conversation: ["customer: x"] });
    expect(r.text).toBe("no answer in 6 steps: case escalated to a human");
  });
});

describe("CaseEvent", () => {
  it("builds one event per stage with the expected property names", () => {
    expect(CaseEvent.started("a", "hi")).toEqual({
      caseId: "a",
      stage: "Started",
      step: 0,
      text: "hi",
      decision: null,
      tool: null,
      argument: null,
      planner: null,
      result: null,
      error: null,
    });
    expect(CaseEvent.modelDecided("a", 2, Decision.empty)).toMatchObject({
      stage: "ModelDecided",
      step: 2,
      decision: Decision.empty,
    });
    expect(CaseEvent.toolUsed("a", 1, "LookUpOrder", "1234", "ok")).toMatchObject({
      stage: "ToolUsed",
      step: 1,
      tool: "LookUpOrder",
      argument: "1234",
      text: "ok",
    });
    const r = CaseResult.answered("a", "x", 3);
    expect(CaseEvent.answered("a", r)).toMatchObject({ stage: "Answered", step: 3, result: r });
    const e = CaseResult.escalated("a", []);
    expect(CaseEvent.escalated("a", e)).toMatchObject({ stage: "Escalated", step: 6, result: e });
    expect(CaseEvent.failed("a", "boom")).toMatchObject({ stage: "Failed", error: "boom" });
  });
});

describe("startState", () => {
  it("is enabled with no case or a finished one, disabled while active", () => {
    expect(startState(undefined)).toEqual({ label: "Ask", enabled: true });
    expect(startState({ phase: "Answered" })).toEqual({ label: "Ask", enabled: true });
    expect(startState({ phase: "Escalated" }).enabled).toBe(true);
    expect(startState({ phase: "Failed" }).enabled).toBe(true);
    expect(startState({ phase: "Thinking" })).toEqual({ label: "Working…", enabled: false });
    expect(startState({ phase: "Starting" }).enabled).toBe(false);
  });

  it("knows the terminal phases", () => {
    expect(isTerminalPhase("UsingTool")).toBe(false);
    expect(isTerminalPhase("Escalated")).toBe(true);
  });
});
