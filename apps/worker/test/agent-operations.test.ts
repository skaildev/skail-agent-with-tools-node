import { describe, expect, it } from "vitest";
import { CaseEvent, Decision, type CaseEvent as Evt } from "@skail-agent-with-tools/contracts";
import { AgentOperations } from "../src/agent-operations.js";
import { SimulatedOrderSystem } from "../src/order-system.js";
import type { Planner } from "../src/planners/planner.js";
import type { ProgressNotifier } from "../src/web.js";

function setup(opts: { decision?: Decision; planError?: Error; notifyError?: Error } = {}) {
  const events: Evt[] = [];
  const seen: string[][] = [];
  const planner: Planner = {
    name: "Fake planner",
    nextStep: async (conversation) => {
      seen.push(conversation);
      if (opts.planError) throw opts.planError;
      return opts.decision ?? Decision.answerWith("ok");
    },
  };
  const notifier: ProgressNotifier = {
    notify: async (e) => {
      if (opts.notifyError) throw opts.notifyError;
      events.push(e);
    },
  };
  return { ops: new AgentOperations(async () => planner, new SimulatedOrderSystem(), notifier), events, seen };
}

describe("AgentOperations.decide", () => {
  it("asks the planner, reports the decision and returns it", async () => {
    const decision = Decision.useTool("LookUpOrder", "1234");
    const { ops, events, seen } = setup({ decision });
    expect(await ops.decide("a1", 2, ["customer: x"])).toEqual(decision);
    expect(seen).toEqual([["customer: x"]]);
    expect(events).toEqual([CaseEvent.modelDecided("a1", 2, decision)]);
  });

  it("swallows a network failure of the progress report (it must not make skail call the model again)", async () => {
    const { ops } = setup({ notifyError: new TypeError("fetch failed") });
    await expect(ops.decide("a1", 1, ["customer: x"])).resolves.toEqual(Decision.answerWith("ok"));
  });

  it("lets a planner failure through so skail retries", async () => {
    const { ops } = setup({ planError: new Error("OpenAI answered 503") });
    await expect(ops.decide("a1", 1, [])).rejects.toThrow("503");
  });
});

describe("AgentOperations.useTool", () => {
  it.each([
    ["LookUpOrder", "1234", "shipped, tracking code BR123456789"],
    ["TrackDelivery", "BR123456789", "in transit in São Paulo, arriving tomorrow"],
    ["LookUpOrder", "0000", "order not found"],
    ["DeleteEverything", "x", "unknown tool: DeleteEverything"],
  ])("%s(%s) => %s", async (tool, argument, esperado) => {
    const { ops, events } = setup();
    expect(await ops.useTool("a1", 1, tool, argument)).toBe(esperado);
    expect(events).toEqual([CaseEvent.toolUsed("a1", 1, tool, argument, esperado)]);
  });

  it("swallows a network failure of the progress report", async () => {
    const { ops } = setup({ notifyError: new TypeError("fetch failed") });
    await expect(ops.useTool("a1", 1, "LookUpOrder", "1234")).resolves.toContain("BR123456789");
  });
});

describe("AgentOperations.answer / escalate", () => {
  it("answer returns the Answered result, reports it, and is idempotent", async () => {
    const { ops, events } = setup();
    const first = await ops.answer("a1", 2, "Arrives tomorrow");
    const second = await ops.answer("a1", 2, "Arrives tomorrow");
    expect(first).toEqual(second);
    expect(first).toMatchObject({ end: "Answered", text: "Arrives tomorrow", steps: 2 });
    expect(events[0]).toMatchObject({ stage: "Answered", step: 2 });
  });

  it("escalate returns the Escalated result with the conversation, and is idempotent", async () => {
    const { ops, events } = setup();
    const first = await ops.escalate("a1", ["customer: x"]);
    expect(await ops.escalate("a1", ["customer: x"])).toEqual(first);
    expect(first).toMatchObject({ end: "Escalated", steps: 6, conversation: ["customer: x"] });
    expect(events[0]).toMatchObject({ stage: "Escalated" });
  });

  it("do not swallow a failed report (they are idempotent, so the retry is safe)", async () => {
    const { ops } = setup({ notifyError: new TypeError("fetch failed") });
    await expect(ops.answer("a1", 1, "x")).rejects.toThrow("fetch failed");
    await expect(ops.escalate("a1", [])).rejects.toThrow("fetch failed");
  });
});

describe("AgentOperations.reportStatus", () => {
  it("fills in the planner on Started", async () => {
    const { ops, events } = setup();
    await ops.reportStatus(CaseEvent.started("a1", "hi"));
    expect(events[0]).toMatchObject({ stage: "Started", planner: "Fake planner", text: "hi" });
  });

  it("passes other events through and throws if the delivery fails", async () => {
    const { ops, events } = setup();
    await ops.reportStatus(CaseEvent.failed("a1", "boom"));
    expect(events[0]).toEqual(CaseEvent.failed("a1", "boom"));
    await expect(
      setup({ notifyError: new Error("web down") }).ops.reportStatus(CaseEvent.started("a", "x")),
    ).rejects.toThrow("web down");
  });
});
