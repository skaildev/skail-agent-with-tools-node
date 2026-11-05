/** The data the tools read. Simulated: the demo has no real order system. */
export interface OrderSystem {
  lookUpOrder(number: string): string;
  trackDelivery(trackingCode: string): string;
}

const orders: Record<string, string> = {
  "1234": "shipped, tracking code BR123456789",
  "5678": "being prepared, no tracking code yet",
};

const deliveries: Record<string, string> = {
  BR123456789: "in transit in São Paulo, arriving tomorrow",
};

// not finding the data is a business result the model can act on, never an exception
function lookup(data: Record<string, string>, key: string, notFound: string): string {
  const k = key.trim();
  if (k.length === 0) return "empty argument";
  return Object.hasOwn(data, k) ? data[k]! : notFound;
}

export class SimulatedOrderSystem implements OrderSystem {
  lookUpOrder(number: string): string {
    return lookup(orders, number, "order not found");
  }

  trackDelivery(trackingCode: string): string {
    return lookup(deliveries, trackingCode, "no tracking events");
  }
}
