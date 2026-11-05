import { beforeEach, describe, expect, it } from "vitest";
import { CaseEvent, CaseResult, Decision, AgentLimits } from "@skail-agent-with-tools/contracts";
import { createApp } from "../src/app.js";
import { CaseStore } from "../src/case-store.js";
import { SkailGatewayError, type SkailGateway } from "../src/gateway.js";

class FakeGateway implements SkailGateway {
  triggers: Array<[string, string]> = [];
  failTrigger = false;
  async trigger(id: string, message: string) {
    if (this.failTrigger) throw new SkailGatewayError("skail down");
    this.triggers.push([id, message]);
  }
}

let gw: FakeGateway;
let store: CaseStore;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  gw = new FakeGateway();
  store = new CaseStore();
  app = createApp({ store, gateway: gw, monitorUrl: "http://monitor" });
});

const ask = async (payload?: unknown) => {
  const res = await app.inject({ method: "POST", url: "/api/cases", payload: payload as object });
  return { res, body: res.json() };
};
const event = (id: string, evt: CaseEvent) =>
  app.inject({ method: "POST", url: `/internal/cases/${id}/events`, payload: evt });

describe("web API", () => {
  it("serves config and healthz", async () => {
    expect((await app.inject("/healthz")).body).toBe("ok");
    expect((await app.inject("/api/config")).json()).toEqual({
      defaultMessage: AgentLimits.defaultMessage,
      monitorUrl: "http://monitor",
    });
  });

  it("config without a monitor url returns null", async () => {
    const bare = createApp({ store, gateway: gw });
    expect((await bare.inject("/api/config")).json()).toEqual({
      defaultMessage: AgentLimits.defaultMessage,
      monitorUrl: null,
    });
  });

  it("triggers with the default, informed or blank message", async () => {
    expect((await ask()).body).toMatchObject({ question: AgentLimits.defaultMessage, phase: "Starting", active: true });
    expect((await ask({ message: "  Where is order 5678? " })).body.question).toBe("Where is order 5678?");
    expect((await ask({ message: "   " })).body.question).toBe(AgentLimits.defaultMessage);
    expect(gw.triggers.map((t) => t[1])).toEqual([
      AgentLimits.defaultMessage,
      "Where is order 5678?",
      AgentLimits.defaultMessage,
    ]);
    expect(new Set(gw.triggers.map((t) => t[0])).size).toBe(3); // a new GUID each time
  });

  it("rejects a too long message (400) and reports a trigger failure (502) without keeping the case", async () => {
    const long = await ask({ message: "x".repeat(AgentLimits.maxMessageLength + 1) });
    expect(long.res.statusCode).toBe(400);
    expect(gw.triggers).toHaveLength(0);

    gw.failTrigger = true;
    const failed = await ask({ message: "hi" });
    expect(failed.res.statusCode).toBe(502);
    expect(failed.body.error).toContain("skail down");
  });

  it("returns the state of a case (404 when unknown)", async () => {
    const { body } = await ask();
    const res = await app.inject(`/api/cases/${body.caseId}`);
    expect(res.json()).toMatchObject({ caseId: body.caseId, active: true });
    expect((await app.inject("/api/cases/nope")).statusCode).toBe(404);
  });

  it("applies the worker's events (204) and the view becomes inactive at the end", async () => {
    const { body } = await ask();
    const id = body.caseId as string;
    expect((await event(id, { ...CaseEvent.started(id, "x"), planner: "OpenAI" })).statusCode).toBe(204);
    await event(id, CaseEvent.modelDecided(id, 1, Decision.useTool("LookUpOrder", "1234")));
    let view = (await app.inject(`/api/cases/${id}`)).json();
    expect(view).toMatchObject({ phase: "UsingTool", modelCalls: 1, planner: "OpenAI", active: true });

    await event(id, CaseEvent.answered(id, CaseResult.answered(id, "ok", 2)));
    view = (await app.inject(`/api/cases/${id}`)).json();
    expect(view).toMatchObject({ phase: "Answered", active: false, result: { end: "Answered" } });
  });

  it("the id of the route wins over the one in the event body", async () => {
    const { body } = await ask();
    await event(body.caseId, CaseEvent.started("other", "x"));
    expect((await app.inject(`/api/cases/${body.caseId}`)).json().phase).toBe("Thinking");
  });

  it("streams SSE: the current state first, then each change, closing at the end", async () => {
    const { body } = await ask();
    const id = body.caseId as string;
    await app.listen({ port: 0, host: "127.0.0.1" });
    const port = (app.server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/cases/${id}/stream`);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const phases: string[] = [];
    const pump = (async () => {
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value);
        for (const chunk of buffer.split("\n\n").slice(0, -1))
          phases.push(JSON.parse(chunk.replace(/^data: /, "")).phase);
        buffer = buffer.slice(buffer.lastIndexOf("\n\n") + 2);
      }
    })();

    await new Promise((r) => setTimeout(r, 50));
    await event(id, CaseEvent.started(id, "x"));
    await event(id, CaseEvent.escalated(id, CaseResult.escalated(id, [])));
    await pump; // the stream ends by itself at the terminal state
    expect(phases).toEqual(["Starting", "Thinking", "Escalated"]);
    await app.close();
  });

  it("stream of an unknown case is 404", async () => {
    expect((await app.inject("/api/cases/nope/stream")).statusCode).toBe(404);
  });
});
