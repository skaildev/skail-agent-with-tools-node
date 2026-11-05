import { describe, expect, it } from "vitest";
import { SimulatedOrderSystem } from "../src/order-system.js";

const orders = new SimulatedOrderSystem();

describe("SimulatedOrderSystem", () => {
  it("finds an order", () => {
    expect(orders.lookUpOrder("1234")).toBe("shipped, tracking code BR123456789");
    expect(orders.lookUpOrder(" 5678 ")).toBe("being prepared, no tracking code yet");
  });

  it("answers 'not found' as text, not as an exception", () => {
    expect(orders.lookUpOrder("9999")).toBe("order not found");
  });

  it("finds a tracking code and reports no events for an unknown one", () => {
    expect(orders.trackDelivery("BR123456789")).toBe("in transit in São Paulo, arriving tomorrow");
    expect(orders.trackDelivery("BR000")).toBe("no tracking events");
  });

  it("reports an empty argument", () => {
    expect(orders.lookUpOrder("  ")).toBe("empty argument");
    expect(orders.trackDelivery("")).toBe("empty argument");
  });
});
