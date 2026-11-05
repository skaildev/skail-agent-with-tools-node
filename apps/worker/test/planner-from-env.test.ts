import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Decision } from "@skail-agent-with-tools/contracts";
import { SamplePlanner } from "../src/planners/sample-planner.js";
import { OpenAIPlanner } from "../src/planners/openai-planner.js";
import { plannerFromEnv } from "../src/planners/planner-from-env.js";

const NAMES = ["OPENAI_API_KEY", "OPENAI_MODEL", "SAMPLE_PLANNER_DELAY_MS"];
const saved: Record<string, string | undefined> = {};

// the planner reads process.env at run time, so the tests set it for real and restore it afterwards
beforeEach(() => {
  for (const name of NAMES) {
    saved[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const name of NAMES) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

const setEnv = (values: Record<string, string>) => Object.assign(process.env, values);

describe("plannerFromEnv", () => {
  it("without OPENAI_API_KEY uses the sample planner", async () => {
    const planner = await plannerFromEnv()();
    expect(planner).toBeInstanceOf(SamplePlanner);
    expect(planner.name).toBe("Sample planner");
    expect(await planner.nextStep(["customer: order 1234"])).toEqual(Decision.useTool("LookUpOrder", "1234"));
  });

  it("with OPENAI_API_KEY uses OpenAI, with the configured model and the key from the environment", async () => {
    setEnv({ OPENAI_API_KEY: "sk-run-time", OPENAI_MODEL: "gpt-x" });
    const calls: Array<{ init: RequestInit }> = [];
    const planner = await plannerFromEnv(async (_url, init) => {
      calls.push({ init: init! });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"answer":"hi"}' } }] }));
    })();
    expect(planner).toBeInstanceOf(OpenAIPlanner);
    await planner.nextStep(["customer: hi"]);
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe("Bearer sk-run-time");
    expect(JSON.parse(calls[0]!.init.body as string).model).toBe("gpt-x");
  });

  it("OpenAI model defaults to gpt-4o-mini", async () => {
    setEnv({ OPENAI_API_KEY: "sk-run-time" });
    const calls: Array<{ init: RequestInit }> = [];
    const planner = await plannerFromEnv(async (_u, init) => {
      calls.push({ init: init! });
      return new Response("{}");
    })();
    await planner.nextStep([]);
    expect(JSON.parse(calls[0]!.init.body as string).model).toBe("gpt-4o-mini");
  });

  it("SAMPLE_PLANNER_DELAY_MS sets the delay; an invalid or negative value means no delay", async () => {
    for (const [value, expected] of [
      ["50", 50],
      ["abc", 0],
      ["-5", 0],
      ["", 0],
    ] as const) {
      setEnv({ SAMPLE_PLANNER_DELAY_MS: value });
      const planner = (await plannerFromEnv()()) as SamplePlanner;
      expect(planner.delayMs).toBe(expected);
    }
  });

  it("an empty OPENAI_API_KEY means no key, and an empty OPENAI_MODEL falls back to the default model", async () => {
    setEnv({ OPENAI_API_KEY: "" });
    expect(await plannerFromEnv()()).toBeInstanceOf(SamplePlanner);

    setEnv({ OPENAI_API_KEY: "sk-run-time", OPENAI_MODEL: "" });
    const calls: Array<{ init: RequestInit }> = [];
    const planner = await plannerFromEnv(async (_u, init) => {
      calls.push({ init: init! });
      return new Response("{}");
    })();
    await planner.nextStep([]);
    expect(JSON.parse(calls[0]!.init.body as string).model).toBe("gpt-4o-mini");
  });

  it("resolves once: later calls reuse the same planner even if the environment changed", async () => {
    const resolve = plannerFromEnv();
    const first = await resolve();
    setEnv({ OPENAI_API_KEY: "sk-changed-later" });
    expect(await resolve()).toBe(first);
  });
});
