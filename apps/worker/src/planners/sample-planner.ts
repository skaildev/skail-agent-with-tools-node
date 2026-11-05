import { Decision, Tools } from "@skail-agent-with-tools/contracts";
import type { Planner } from "./planner.js";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The planner used without an OpenAI key: deterministic and offline. An optional delay per decision
 * gives time to stop the worker in the middle of a case.
 */
export class SamplePlanner implements Planner {
  readonly name = "Sample planner";

  constructor(readonly delayMs = 0) {}

  async nextStep(conversation: string[]): Promise<Decision> {
    if (this.delayMs > 0) await sleep(this.delayMs);

    const question = conversation.find((l) => l.startsWith("customer: ")) ?? "";

    // a complaint never gets an answer, so the case goes to a person
    if (/complaint/i.test(question)) return Decision.empty;

    const delivery = lastResult(conversation, Tools.TrackDelivery);
    if (delivery !== null) return Decision.answerWith(`Your delivery is ${delivery}.`);

    const order = lastResult(conversation, Tools.LookUpOrder);
    if (order !== null) {
      if (order.includes("not found"))
        return Decision.answerWith(`I could not find order ${findOrderNumber(question)}. Could you check the number?`);
      const code = /BR\d+/.exec(order);
      if (code) return Decision.useTool(Tools.TrackDelivery, code[0]);
      return Decision.answerWith(`Your order is ${order}.`);
    }

    const number = findOrderNumber(question);
    return number
      ? Decision.useTool(Tools.LookUpOrder, number)
      : Decision.answerWith("Could you tell me the order number?");
  }
}

function lastResult(conversation: string[], tool: string): string | null {
  const prefix = `${tool}(`;
  const line = [...conversation].reverse().find((l) => l.startsWith(prefix));
  const i = line?.indexOf(" => ") ?? -1;
  return i < 0 ? null : line!.slice(i + 4);
}

const findOrderNumber = (question: string): string => /\d{3,}/.exec(question)?.[0] ?? "";
