import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaseResult, type CaseView } from "@skail-agent-with-tools/contracts";
import { App } from "../src/App";

const entry = (kind: string, step: number, text: string) => ({ kind, step, text, at: "2026-01-01T10:00:00.000Z" });

const view = (patch: Partial<CaseView> = {}): CaseView => {
  const a = {
    caseId: "case-1",
    question: "Where is my order 1234?",
    phase: "Thinking" as const,
    step: 0,
    modelCalls: 0,
    planner: "Sample planner",
    timeline: [],
    result: null,
    error: null,
    ...patch,
  };
  return { ...a, active: !["Answered", "Escalated", "Failed"].includes(a.phase) };
};

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  emit(data: CaseView) {
    act(() => this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent));
  }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

let calls: Array<{ url: string; method: string; body?: string }>;
let answers: Record<string, () => Response>;

beforeEach(() => {
  calls = [];
  answers = { "GET /api/config": () => json({ defaultMessage: "Where is my order 1234?", monitorUrl: null }) };
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body as string | undefined });
    const answer = answers[`${method} ${url}`];
    if (!answer) throw new Error(`unexpected ${method} ${url}`);
    return answer();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const ask = () => screen.getByRole("button", { name: /^(Ask|Working…)$/ });

async function started(patch: Partial<CaseView> = {}) {
  answers["POST /api/cases"] = () => json(view());
  render(<App />);
  await userEvent.click(ask());
  await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
  if (Object.keys(patch).length) FakeEventSource.instances[0]!.emit(view(patch));
}

describe("App", () => {
  it("starts idle with the default message and Ask enabled", () => {
    render(<App />);
    expect(ask()).toBeEnabled();
    expect(screen.getByLabelText("Customer message")).toHaveValue("Where is my order 1234?");
    expect(screen.getByText("Idle")).toBeInTheDocument();
  });

  it("click sends the message; field and button get disabled, the id is remembered and the stream opens", async () => {
    answers["POST /api/cases"] = () => json(view());
    render(<App />);
    await userEvent.clear(screen.getByLabelText("Customer message"));
    await userEvent.type(screen.getByLabelText("Customer message"), "What about order 5678?");
    await userEvent.click(ask());

    await waitFor(() => expect(ask()).toHaveTextContent("Working…"));
    expect(JSON.parse(calls.find((c) => c.method === "POST")!.body!)).toEqual({ message: "What about order 5678?" });
    expect(ask()).toBeDisabled();
    expect(screen.getByLabelText("Customer message")).toBeDisabled();
    expect(localStorage.getItem("agent-with-tools.caseId")).toBe("case-1");
    expect(FakeEventSource.instances[0]!.url).toBe("/api/cases/case-1/stream");
  });

  it("shows the planner in use", async () => {
    await started({ planner: "OpenAI" });
    expect(screen.getByLabelText("Planner")).toHaveTextContent("OpenAI");
  });

  it("shows the state label for each phase", async () => {
    await started({ phase: "Thinking" });
    expect(screen.getByText("Thinking")).toBeInTheDocument();
    FakeEventSource.instances[0]!.emit(view({ phase: "UsingTool" }));
    expect(screen.getByText("Using tool")).toBeInTheDocument();
  });

  it("the timeline shows one item per step with a distinct kind, step n/6 and the model call counter", async () => {
    await started({
      phase: "Thinking",
      step: 2,
      modelCalls: 2,
      timeline: [
        entry("Started", 0, "Customer asked: Where is my order 1234?"),
        entry("ModelTool", 1, 'Step 1: model chose LookUpOrder("1234")'),
        entry("ToolResult", 1, "Step 1: tool result: shipped"),
        entry("Invalid", 2, "Step 2: invalid model decision, asking again"),
      ],
    });
    const items = within(screen.getByRole("list", { name: "Agent timeline" })).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(items.map((i) => i.getAttribute("data-kind"))).toEqual(["Started", "ModelTool", "ToolResult", "Invalid"]);
    expect(items[1]).toHaveTextContent('Step 1: model chose LookUpOrder("1234")');
    expect(screen.getByLabelText("Step")).toHaveTextContent("Step 2/6");
    expect(screen.getByLabelText("Model calls")).toHaveTextContent("2");
  });

  it("Answered shows the answer given to the customer and enables Ask again", async () => {
    await started({
      phase: "Answered",
      result: CaseResult.answered("case-1", "Your delivery arrives tomorrow.", 3),
      step: 3,
    });
    expect(screen.getByRole("status", { name: "Result" })).toHaveTextContent("Answered");
    expect(screen.getByRole("status", { name: "Result" })).toHaveTextContent("Your delivery arrives tomorrow.");
    expect(ask()).toBeEnabled();
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
    expect(localStorage.getItem("agent-with-tools.caseId")).toBeNull();
  });

  it("Escalated shows the handoff record with the conversation", async () => {
    await started({
      phase: "Escalated",
      result: CaseResult.escalated("case-1", ["customer: complaint", "system: invalid decision."]),
    });
    const banner = screen.getByRole("status", { name: "Result" });
    expect(banner).toHaveTextContent("Escalated to a human");
    expect(banner).toHaveTextContent("customer: complaint");
    expect(screen.getByText("Escalated to a human", { selector: ".badge" })).toBeInTheDocument();
    expect(ask()).toBeEnabled();
  });

  it("Failed shows the error and enables Ask", async () => {
    await started({ phase: "Failed", error: "boom" });
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(ask()).toBeEnabled();
  });

  it("reload with an id in localStorage restores the state and reconnects", async () => {
    localStorage.setItem("agent-with-tools.caseId", "case-1");
    answers["GET /api/cases/case-1"] = () => json(view({ phase: "UsingTool", step: 1, modelCalls: 1 }));
    render(<App />);
    await waitFor(() => expect(ask()).toHaveTextContent("Working…"));
    expect(screen.getByLabelText("Step")).toHaveTextContent("Step 1/6");
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
  });

  it("reload with an unknown or finished id forgets it", async () => {
    localStorage.setItem("agent-with-tools.caseId", "gone");
    answers["GET /api/cases/gone"] = () => json({}, 404);
    render(<App />);
    await waitFor(() => expect(localStorage.getItem("agent-with-tools.caseId")).toBeNull());
    expect(ask()).toBeEnabled();
  });

  it("shows the error when the trigger fails and keeps Ask enabled", async () => {
    answers["POST /api/cases"] = () => json({ error: "skail down" }, 502);
    render(<App />);
    await userEvent.click(ask());
    expect(await screen.findByText(/skail down/)).toBeInTheDocument();
    expect(ask()).toBeEnabled();
  });

  it("shows the Monitor link when configured and the default message from the server", async () => {
    answers["GET /api/config"] = () => json({ defaultMessage: "Another question?", monitorUrl: "http://monitor" });
    render(<App />);
    expect(await screen.findByRole("link", { name: /Monitor/ })).toHaveAttribute("href", "http://monitor");
    await waitFor(() => expect(screen.getByLabelText("Customer message")).toHaveValue("Another question?"));
  });
});
