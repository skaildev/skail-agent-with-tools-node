import { afterEach, describe, expect, it, vi } from "vitest";
import { Decision } from "@skail-agent-with-tools/contracts";
import { SamplePlanner } from "../src/planners/sample-planner.js";

const planner = new SamplePlanner();

afterEach(() => vi.useRealTimers());

describe("SamplePlanner", () => {
  it("is named for the page", () => {
    expect(planner.name).toBe("Sample planner");
  });

  it("question with an order number: uses LookUpOrder", async () => {
    expect(await planner.nextStep(["customer: Where is my order 1234?"])).toEqual(
      Decision.useTool("LookUpOrder", "1234"),
    );
  });

  it("order result with a tracking code: uses TrackDelivery", async () => {
    const conversation = [
      "customer: Where is my order 1234?",
      "LookUpOrder(1234) => shipped, tracking code BR123456789",
    ];
    expect(await planner.nextStep(conversation)).toEqual(Decision.useTool("TrackDelivery", "BR123456789"));
  });

  it("tracking result: answers", async () => {
    const conversation = [
      "customer: Where is my order 1234?",
      "LookUpOrder(1234) => shipped, tracking code BR123456789",
      "TrackDelivery(BR123456789) => in transit in São Paulo",
    ];
    expect(await planner.nextStep(conversation)).toEqual(
      Decision.answerWith("Your delivery is in transit in São Paulo."),
    );
  });

  it("order without tracking code: answers with the order status", async () => {
    const conversation = ["customer: order 5678?", "LookUpOrder(5678) => being prepared, no tracking code yet"];
    expect(await planner.nextStep(conversation)).toEqual(
      Decision.answerWith("Your order is being prepared, no tracking code yet."),
    );
  });

  it("order not found: asks the customer to check the number", async () => {
    const conversation = ["customer: order 9999?", "LookUpOrder(9999) => order not found"];
    expect(await planner.nextStep(conversation)).toEqual(
      Decision.answerWith("I could not find order 9999. Could you check the number?"),
    );
  });

  it("question without an order number: asks for it", async () => {
    expect(await planner.nextStep(["customer: hi"])).toEqual(
      Decision.answerWith("Could you tell me the order number?"),
    );
  });

  it.each(["I want to file a complaint 1234", "COMPLAINT", "a complaint about order 1234"])(
    "complaint '%s' never answers",
    async (q) => {
      expect(await planner.nextStep([`customer: ${q}`])).toEqual(Decision.empty);
    },
  );

  it("is deterministic", async () => {
    const conversation = ["customer: order 1234"];
    expect(await planner.nextStep(conversation)).toEqual(await planner.nextStep(conversation));
  });

  it("waits the configured delay before deciding", async () => {
    vi.useFakeTimers();
    const slow = new SamplePlanner(3000);
    let done = false;
    const pending = slow.nextStep(["customer: order 1234"]).then((d) => {
      done = true;
      return d;
    });
    await vi.advanceTimersByTimeAsync(2999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual(Decision.useTool("LookUpOrder", "1234"));
  });
});
