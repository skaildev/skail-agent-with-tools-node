import { CaseEvent, CaseResult, Tools, type Decision } from "@skail-agent-with-tools/contracts";
import type { OrderSystem } from "./order-system.js";
import type { Planner } from "./planners/planner.js";
import type { ProgressNotifier } from "./web.js";

/**
 * The I/O behind the commands, as plain async methods. The command wrappers only delegate here, so the
 * logic is unit tested without the skail runtime. The progress report of a model decision or a tool is
 * best effort: if the web app is down it must not make skail retry the command (that would call the model again).
 * The planner is resolved lazily, inside the command, because choosing it reads the environment.
 */
export class AgentOperations {
  constructor(
    private readonly planner: () => Promise<Planner>,
    private readonly orders: OrderSystem,
    private readonly notifier: ProgressNotifier,
  ) {}

  async decide(caseId: string, step: number, conversation: string[]): Promise<Decision> {
    const decision = await (await this.planner()).nextStep(conversation);
    console.log(`Case ${caseId} step ${step}: the model decided ${JSON.stringify(decision)}`);
    await this.#tryNotify(CaseEvent.modelDecided(caseId, step, decision));
    return decision;
  }

  /** Read-only tools: a retry has no side effect. An unknown tool is text for the model, not an exception. */
  async useTool(caseId: string, step: number, tool: string, argument: string): Promise<string> {
    const result =
      tool === Tools.LookUpOrder
        ? this.orders.lookUpOrder(argument)
        : tool === Tools.TrackDelivery
          ? this.orders.trackDelivery(argument)
          : `unknown tool: ${tool}`;
    console.log(`Case ${caseId} step ${step}: ${tool}(${argument}) => ${result}`);
    await this.#tryNotify(CaseEvent.toolUsed(caseId, step, tool, argument, result));
    return result;
  }

  /** Idempotent: the result derives from the arguments, and the web app ignores a repeated stage. */
  async answer(caseId: string, step: number, answer: string): Promise<CaseResult> {
    const result = CaseResult.answered(caseId, answer, step);
    console.log(`Case ${caseId} answered on step ${step}`);
    await this.notifier.notify(CaseEvent.answered(caseId, result));
    return result;
  }

  /** Idempotent, like {@link answer}. */
  async escalate(caseId: string, conversation: string[]): Promise<CaseResult> {
    const result = CaseResult.escalated(caseId, conversation);
    console.warn(`Case ${caseId} escalated to a human`);
    await this.notifier.notify(CaseEvent.escalated(caseId, result));
    return result;
  }

  async reportStatus(evt: CaseEvent): Promise<void> {
    await this.notifier.notify(evt.stage === "Started" ? { ...evt, planner: (await this.planner()).name } : evt);
  }

  async #tryNotify(evt: CaseEvent): Promise<void> {
    try {
      await this.notifier.notify(evt);
    } catch (error) {
      // only a network failure is tolerated; a non-2xx answer from the web app is also an Error from the notifier
      console.warn(
        `Could not report the progress of case ${evt.caseId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}
