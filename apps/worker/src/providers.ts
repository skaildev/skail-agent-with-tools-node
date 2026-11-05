import type { Provider } from "@skail/runtime";
import { AgentOperations } from "./agent-operations.js";
import { buildConfig } from "./build-config.generated.js";
import { SimulatedOrderSystem } from "./order-system.js";
import { plannerFromEnv } from "./planners/planner-from-env.js";
import { SupportAgent } from "./support-agent.js";
import { HttpProgressNotifier } from "./web.js";

// WEB_BASE_URL is fixed at build time (gen-config.mjs). The planner and OPENAI_API_KEY are read from
// process.env inside the commands, when they run.
export const providers: Provider[] = [
  {
    token: SupportAgent,
    useFactory: () =>
      new SupportAgent(
        new AgentOperations(
          plannerFromEnv(),
          new SimulatedOrderSystem(),
          new HttpProgressNotifier(buildConfig.webBaseUrl),
        ),
      ),
  },
];
