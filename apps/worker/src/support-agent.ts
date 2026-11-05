import { SkailCommand, SkailFunction, SkailNonDeterministicError } from "@skail/runtime";
import {
  AgentLimits,
  CaseEvent,
  Conversation,
  type CaseResult,
  type Decision,
} from "@skail-agent-with-tools/contracts";
import type { AgentOperations } from "./agent-operations.js";

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// The method names are PascalCase on purpose: the skail route is <workload>/<method>, and the web app triggers
// <workload>/AssistCustomer.
export class SupportAgent {
  constructor(private readonly operations: AgentOperations) {}

  /**
   * The agent loop: at each step the model decides to use a tool or to answer the customer. Each decision and each
   * tool call is a recorded step, so after a crash the case resumes without asking the model again for what it
   * already decided. With no answer in 6 steps, the case goes to a person.
   */
  @SkailFunction()
  async AssistCustomer(caseId: string, question: string): Promise<CaseResult> {
    try {
      await this.ReportStatus(CaseEvent.started(caseId, question));
      const conversation: string[] = [Conversation.customer(question)];

      for (let step = 1; step <= AgentLimits.MaxSteps; step++) {
        // A copy: the recorded argument must not change when the conversation grows.
        const decision = await this.DecideNextStep(caseId, step, [...conversation]);
        if (decision.answer != null) return await this.Answer(caseId, step, decision.answer);

        if (decision.tool == null) {
          // Neither a tool nor an answer: the model gets a warning and decides again.
          conversation.push(Conversation.invalidDecision);
          continue;
        }

        const result = await this.UseTool(caseId, step, decision.tool, decision.argument ?? "");
        conversation.push(Conversation.tool(decision.tool, decision.argument, result));
      }

      return await this.EscalateToHuman(caseId, [...conversation]);
    } catch (error) {
      if (!(error instanceof SkailNonDeterministicError))
        await this.ReportStatus(CaseEvent.failed(caseId, errorMessage(error)));
      throw error;
    }
  }

  // The commands only delegate: the logic lives in AgentOperations, which is tested without skail.

  /** Asks the model for the next step. The decision is recorded, so a resumed case does not ask again. */
  @SkailCommand({ retryCount: 3 })
  async DecideNextStep(caseId: string, step: number, conversation: string[]): Promise<Decision> {
    return this.operations.decide(caseId, step, conversation);
  }

  @SkailCommand({ retryCount: 3 })
  async UseTool(caseId: string, step: number, tool: string, argument: string): Promise<string> {
    return this.operations.useTool(caseId, step, tool, argument);
  }

  @SkailCommand({ retryCount: 3 })
  async Answer(caseId: string, step: number, answer: string): Promise<CaseResult> {
    return this.operations.answer(caseId, step, answer);
  }

  @SkailCommand({ retryCount: 3 })
  async EscalateToHuman(caseId: string, conversation: string[]): Promise<CaseResult> {
    return this.operations.escalate(caseId, conversation);
  }

  /** Idempotent: the web app ignores a repeated event (same case, stage and step). */
  @SkailCommand({ retryCount: 3 })
  async ReportStatus(evt: CaseEvent): Promise<void> {
    await this.operations.reportStatus(evt);
  }
}
