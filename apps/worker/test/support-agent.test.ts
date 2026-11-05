import { beforeEach, describe, expect, it } from "vitest";
import { EventType, type Provider } from "@skail/runtime";
import { createSkailWorker, type SkailWorker } from "@skail/runtime/testing";
import { InMemorySkailPlatform } from "@skail/testing";
import { CaseEvent, Conversation, Decision, type CaseResult } from "@skail-agent-with-tools/contracts";
import { SupportAgent } from "../src/support-agent.js";
import { AgentOperations } from "../src/agent-operations.js";
import { SimulatedOrderSystem } from "../src/order-system.js";
import type { Planner } from "../src/planners/planner.js";
import type { ProgressNotifier } from "../src/web.js";

const WORKLOAD = "agent-with-tools:v0.0.1";
const ID = "case-1";

class Harness {
  readonly events: CaseEvent[] = [];
  readonly seen: string[][] = []; // the conversation each model call received (snapshot)
  readonly refs: string[][] = []; // the very arrays the model calls received (to see later mutation)
  script: Decision[] = [];
  failPlanner = 0; // transient planner failures before succeeding
  alwaysFailPlanner = false;
  readonly platform = new InMemorySkailPlatform();
  readonly worker: SkailWorker;

  constructor() {
    const planner: Planner = {
      name: "Scripted planner",
      nextStep: async (conversation) => {
        if (this.alwaysFailPlanner) throw new Error("model down");
        if (this.failPlanner > 0) {
          this.failPlanner--;
          throw new Error("transient");
        }
        this.seen.push([...conversation]);
        this.refs.push(conversation);
        return this.script[this.seen.length - 1] ?? Decision.empty;
      },
    };
    const notifier: ProgressNotifier = { notify: async (e) => void this.events.push(e) };
    const providers: Provider[] = [
      {
        token: SupportAgent,
        useFactory: () =>
          new SupportAgent(new AgentOperations(async () => planner, new SimulatedOrderSystem(), notifier)),
      },
    ];
    this.worker = createSkailWorker({ workload: WORKLOAD, types: [SupportAgent], providers, sidecar: this.platform });
  }

  start(question = "Where is my order 1234?") {
    this.platform.start(`${WORKLOAD}/AssistCustomer`, [ID, question], ID);
  }

  async run() {
    return this.worker.runActivation((await this.platform.consume())!);
  }

  stages(stage: CaseEvent["stage"]) {
    return this.events.filter((e) => e.stage === stage);
  }

  commandCalls(method: string) {
    return this.platform
      .history(ID)
      .filter((f) => f.eventType === EventType.Command && JSON.stringify(f).includes(`/${method}`)).length;
  }
}

let h: Harness;
beforeEach(() => {
  h = new Harness();
});

const result = (outcome: Awaited<ReturnType<Harness["run"]>>) => (outcome as { result: CaseResult }).result;

describe("AssistCustomer", () => {
  it("answers on step 1 without using a tool", async () => {
    h.script = [Decision.answerWith("Could you tell me the order number?")];
    h.start("hi");
    const outcome = await h.run();

    expect(outcome.status).toBe("completed");
    expect(result(outcome)).toMatchObject({ end: "Answered", text: "Could you tell me the order number?", steps: 1 });
    expect(h.stages("Started")).toEqual([expect.objectContaining({ text: "hi", planner: "Scripted planner" })]);
    expect(h.stages("ToolUsed")).toHaveLength(0);
    expect(h.seen).toEqual([["customer: hi"]]);
  });

  it("tool then answer: the tool line goes into the conversation of the next step", async () => {
    h.script = [Decision.useTool("LookUpOrder", "5678"), Decision.answerWith("Being prepared")];
    h.start("order 5678");
    const outcome = await h.run();

    expect(result(outcome)).toMatchObject({ end: "Answered", steps: 2 });
    expect(h.seen[1]).toEqual(["customer: order 5678", "LookUpOrder(5678) => being prepared, no tracking code yet"]);
    expect(h.stages("ToolUsed")).toHaveLength(1);
  });

  it("demo flow: LookUpOrder, TrackDelivery, answer, with the conversation growing in order", async () => {
    h.script = [
      Decision.useTool("LookUpOrder", "1234"),
      Decision.useTool("TrackDelivery", "BR123456789"),
      Decision.answerWith("Arrives tomorrow"),
    ];
    h.start();
    const outcome = await h.run();

    expect(result(outcome)).toMatchObject({ end: "Answered", steps: 3 });
    expect(h.seen.map((c) => c.length)).toEqual([1, 2, 3]);
    expect(h.seen[2]![2]).toBe("TrackDelivery(BR123456789) => in transit in São Paulo, arriving tomorrow");
    expect(h.stages("ModelDecided")).toHaveLength(3);
    expect(h.stages("Answered")).toHaveLength(1);
  });

  it("an invalid decision adds the warning, consumes a step and the model decides again", async () => {
    h.script = [Decision.empty, Decision.answerWith("desculpe")];
    h.start("hi");
    const outcome = await h.run();

    expect(result(outcome)).toMatchObject({ end: "Answered", steps: 2 });
    expect(h.seen[1]).toEqual(["customer: hi", Conversation.invalidDecision]);
  });

  it("an unknown tool goes to UseTool (it is not an invalid decision)", async () => {
    h.script = [Decision.useTool("DeleteOrder", "1"), Decision.answerWith("ok")];
    h.start();
    await h.run();

    expect(h.seen[1]).toEqual(["customer: Where is my order 1234?", "DeleteOrder(1) => unknown tool: DeleteOrder"]);
  });

  it("an answer together with a tool: the answer wins", async () => {
    h.script = [{ tool: "LookUpOrder", argument: "1234", answer: "I know" }];
    h.start();
    const outcome = await h.run();

    expect(result(outcome)).toMatchObject({ end: "Answered", text: "I know", steps: 1 });
    expect(h.stages("ToolUsed")).toHaveLength(0);
  });

  it("a tool without argument is called with an empty one", async () => {
    h.script = [{ tool: "LookUpOrder", argument: null, answer: null }, Decision.answerWith("ok")];
    h.start();
    await h.run();
    expect(h.seen[1]![1]).toBe("LookUpOrder() => empty argument");
  });

  it("exhausting the steps escalates to a person with the whole conversation", async () => {
    h.script = [];
    h.start("complaint");
    const outcome = await h.run();

    expect(outcome.status).toBe("completed");
    const r = result(outcome);
    expect(r).toMatchObject({ end: "Escalated", steps: 6 });
    expect(r.conversation).toEqual(["customer: complaint", ...Array<string>(6).fill(Conversation.invalidDecision)]);
    expect(h.seen).toHaveLength(6);
    expect(h.stages("Escalated")).toHaveLength(1);
    expect(h.stages("Answered")).toHaveLength(0);
  });

  it("calls the model exactly once per step, even after resuming from hibernation", async () => {
    h.script = [
      Decision.useTool("LookUpOrder", "1234"),
      Decision.useTool("TrackDelivery", "BR123456789"),
      Decision.answerWith("ok"),
    ];
    h.start();
    await h.run();
    expect(h.seen).toHaveLength(3);

    // replay the same task again (as after a crash): the recorded decisions must not call the model again
    h.platform.enqueue(ID);
    const again = await h.platform.consume();
    if (again) await h.worker.runActivation(again);
    expect(h.seen).toHaveLength(3);
    expect(h.stages("Started")).toHaveLength(1);
  });

  it("passes each step its own copy of the conversation (the recorded argument does not change as it grows)", async () => {
    h.script = [Decision.useTool("LookUpOrder", "1234"), Decision.answerWith("ok")];
    h.start();
    await h.run();
    expect(h.refs[0]).toEqual(["customer: Where is my order 1234?"]);
    expect(h.refs[1]).toHaveLength(2);
    expect(h.refs[0]).not.toBe(h.refs[1]);
  });

  it("a transient planner failure is retried and the step is not lost", async () => {
    h.script = [Decision.answerWith("ok")];
    h.failPlanner = 1;
    h.start();
    let outcome = await h.run();
    for (let i = 0; i < 5 && outcome.status !== "completed"; i++) {
      h.platform.enqueue(ID);
      outcome = await h.run();
    }
    expect(result(outcome)).toMatchObject({ end: "Answered", steps: 1 });
  });

  it("a planner that keeps failing ends in Failed (notified) and the error is rethrown", async () => {
    h.alwaysFailPlanner = true;
    h.start();
    let outcome = await h.run();
    for (let i = 0; i < 10 && outcome.status === "hibernated"; i++) {
      h.platform.enqueue(ID);
      const next = await h.platform.consume();
      if (!next) break;
      outcome = await h.worker.runActivation(next);
    }
    expect(outcome.status).not.toBe("completed");
    expect(h.stages("Failed")).toHaveLength(1);
    expect(h.stages("Failed")[0]!.error).toContain("model down");
  });
});
