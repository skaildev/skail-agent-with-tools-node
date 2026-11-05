import { describe, expect, it } from "vitest";
import { Decision } from "@skail-agent-with-tools/contracts";
import { OpenAIPlanner } from "../src/planners/openai-planner.js";

const KEY = "sk-secret-key-123";
const completion = (content: string) => JSON.stringify({ choices: [{ message: { content } }] });

function planner(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const p = new OpenAIPlanner(KEY, "gpt-4o-mini", async (url, init) => {
    calls.push({ url, init: init! });
    return respond(url, init!);
  });
  return { p, calls };
}

describe("OpenAIPlanner", () => {
  it("is named for the page", () => {
    expect(planner(() => new Response()).p.name).toBe("OpenAI");
  });

  it("posts the conversation to chat completions with the key, the model and temperature 0", async () => {
    const { p, calls } = planner(
      () => new Response(completion('{"tool":"LookUpOrder","argument":"1234","answer":null}')),
    );
    const decision = await p.nextStep(["customer: hi", "LookUpOrder(1) => x"]);

    expect(calls[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toMatchObject({ model: "gpt-4o-mini", temperature: 0, response_format: { type: "json_object" } });
    expect(body.messages[0]).toMatchObject({ role: "system" });
    expect(body.messages[0].content).toContain("LookUpOrder");
    expect(body.messages[0].content).toContain("TrackDelivery");
    expect(body.messages[1]).toEqual({ role: "user", content: "customer: hi\nLookUpOrder(1) => x" });
    expect(decision).toEqual(Decision.useTool("LookUpOrder", "1234"));
  });

  it("reads an answer", async () => {
    const { p } = planner(() => new Response(completion('{"tool":null,"argument":null,"answer":"Arrives tomorrow"}')));
    expect(await p.nextStep(["customer: x"])).toEqual(Decision.answerWith("Arrives tomorrow"));
  });

  it.each([
    ["not JSON", completion("blah")],
    ["empty object", completion("{}")],
    ["blank strings", completion('{"tool":" ","argument":"","answer":""}')],
    ["no choices", JSON.stringify({ choices: [] })],
    ["garbage body", "<html>"],
    ["JSON array", completion("[1]")],
  ])("a reply outside the format (%s) is an empty decision, not an error", async (_name, body) => {
    const { p } = planner(() => new Response(body));
    expect(await p.nextStep(["customer: x"])).toEqual(Decision.empty);
  });

  it.each([429, 500, 503, 401])("HTTP %s throws so skail retries the command", async (status) => {
    const { p } = planner(() => new Response("nope", { status }));
    await expect(p.nextStep(["customer: x"])).rejects.toThrow(String(status));
  });

  it("never leaks the key in an error message", async () => {
    const { p } = planner(() => new Response(`bad key ${KEY}`, { status: 401 }));
    const error = await p.nextStep(["customer: x"]).catch((e: Error) => e);
    expect((error as Error).message).not.toContain(KEY);
  });
});
