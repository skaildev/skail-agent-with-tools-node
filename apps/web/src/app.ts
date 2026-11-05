import { randomUUID } from "node:crypto";
import fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import {
  AgentLimits,
  isTerminalPhase,
  type AppConfig,
  type CaseEvent,
  type CaseState,
  type CaseView,
} from "@skail-agent-with-tools/contracts";
import type { CaseStore } from "./case-store.js";
import type { SkailGateway } from "./gateway.js";

export interface AppOptions {
  store: CaseStore;
  gateway: SkailGateway;
  /** Optional link to the skail Monitor (MONITOR_URL), shown by the page. */
  monitorUrl?: string | null;
  /** Directory with the built front end (index.html + assets). Optional: tests do not need it. */
  staticDir?: string;
}

export function toView(supportCase: CaseState): CaseView {
  return { ...supportCase, active: !isTerminalPhase(supportCase.phase) };
}

export function createApp({ store, gateway, monitorUrl = null, staticDir }: AppOptions): FastifyInstance {
  const app = fastify();

  app.get("/healthz", async () => "ok");

  app.get("/api/config", async (): Promise<AppConfig> => ({
    defaultMessage: AgentLimits.defaultMessage,
    monitorUrl: monitorUrl || null,
  }));

  app.post<{ Body: { message?: unknown } | null }>("/api/cases", async (request, reply) => {
    const raw = request.body?.message;
    const message = typeof raw === "string" && raw.trim() ? raw.trim() : AgentLimits.defaultMessage;
    if (message.length > AgentLimits.maxMessageLength) {
      return reply.code(400).send({ error: `The message can have at most ${AgentLimits.maxMessageLength} characters` });
    }

    const caseId = randomUUID();
    const state = store.create(caseId, message);
    try {
      await gateway.trigger(caseId, message);
    } catch (error) {
      store.remove(caseId);
      return reply.code(502).send({ error: error instanceof Error ? error.message : String(error) });
    }
    return toView(store.get(caseId) ?? state);
  });

  app.get<{ Params: { id: string } }>("/api/cases/:id", async (request, reply) => {
    const supportCase = store.get(request.params.id);
    return supportCase ? toView(supportCase) : reply.code(404).send();
  });

  // called by the worker's commands (ReportStatus, DecideNextStep, UseTool, Answer, EscalateToHuman)
  app.post<{ Params: { id: string }; Body: CaseEvent }>("/internal/cases/:id/events", async (request, reply) => {
    store.apply({ ...request.body, caseId: request.params.id });
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>("/api/cases/:id/stream", (request, reply) => {
    const { id } = request.params;
    const current = store.get(id);
    if (!current) return reply.code(404).send();

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const send = (state: CaseState) => raw.write(`data: ${JSON.stringify(toView(state))}\n\n`);

    // subscribe before sending the snapshot: no update is lost
    const unsubscribe = store.subscribe(id, send, () => raw.end());
    raw.on("close", unsubscribe);
    send(current);
    if (isTerminalPhase(current.phase)) {
      unsubscribe();
      raw.end();
    }
  });

  if (staticDir) app.register(fastifyStatic, { root: staticDir });

  return app;
}
