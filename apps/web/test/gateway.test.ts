import { describe, expect, it } from "vitest";
import { SkailApiGateway, SkailGatewayError, type SkailOptions } from "../src/gateway.js";

const options: SkailOptions = {
  baseUrl: "https://skail.test/",
  namespace: "t/e",
  key: "k",
  workload: "agent-with-tools:v0.0.1",
};

function gateway(answers: Array<number | Error>, opts = options) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const gw = new SkailApiGateway(
    opts,
    async (url, init) => {
      calls.push({ url, init: init! });
      const next = answers.shift() ?? 200;
      if (next instanceof Error) throw next;
      return new Response(null, { status: next });
    },
    () => 0,
  );
  return { gw, calls };
}

describe("SkailApiGateway", () => {
  it("triggers AssistCustomer with [id, message] and the skail headers", async () => {
    const { gw, calls } = gateway([200]);
    await gw.trigger("id 1", "Where is my order 1234?");
    expect(calls[0]!.url).toBe("https://skail.test/api/v1/trigger/agent-with-tools/v0.0.1/AssistCustomer/id%201");
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual(["id 1", "Where is my order 1234?"]);
    expect(calls[0]!.init.headers).toMatchObject({
      accept: "application/json",
      "content-type": "application/json",
      "skail-key": "k",
      authorization: "Bearer k",
      "skail-namespace": "t/e",
    });
  });

  it("retries 429/5xx/network with the same id and body, then gives up", async () => {
    const ok = gateway([503, new Error("reset"), 429, 200]);
    await ok.gw.trigger("a1", "hi");
    expect(ok.calls).toHaveLength(4);
    expect(new Set(ok.calls.map((c) => c.url + c.init.body)).size).toBe(1);

    const down = gateway([500, 500, 500, 500, 500]);
    await expect(down.gw.trigger("a1", "hi")).rejects.toThrow(/giving up after 5/);
    expect(down.calls).toHaveLength(5);
  });

  it.each([401, 403])("does not retry %s and points at the key", async (status) => {
    const { gw, calls } = gateway([status]);
    await expect(gw.trigger("a1", "hi")).rejects.toThrow(/SKAIL_KEY/);
    expect(calls).toHaveLength(1);
  });

  it("does not retry other 4xx", async () => {
    const { gw, calls } = gateway([404]);
    await expect(gw.trigger("a1", "hi")).rejects.toThrow(/404/);
    expect(calls).toHaveLength(1);
  });

  it("fails before calling when SKAIL_BASE_URL or SKAIL_WORKLOAD are wrong", async () => {
    const a = gateway([], { ...options, baseUrl: "" });
    await expect(a.gw.trigger("a1", "hi")).rejects.toBeInstanceOf(SkailGatewayError);
    const b = gateway([], { ...options, workload: "nover" });
    await expect(b.gw.trigger("a1", "hi")).rejects.toThrow(/name:version/);
    expect(a.calls.length + b.calls.length).toBe(0);
  });
});
