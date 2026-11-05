import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSkail } from "@skail/build";

describe("skail build", () => {
  it("accepts the worker (no forbidden imports) and lists the function and commands as <workload>/<method>", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-with-tools-bundle-"));
    try {
      const outfile = join(dir, "skail-functions.mjs");
      const manifest = await buildSkail({
        entryPoint: "src/skail-functions.ts",
        workload: "agent-with-tools:v0.0.1",
        outfile,
        manifestFile: join(dir, "manifest.json"),
      });

      expect(manifest.methods.map((m) => [m.kind, m.uri]).sort()).toEqual([
        ["command", "agent-with-tools:v0.0.1/Answer"],
        ["command", "agent-with-tools:v0.0.1/DecideNextStep"],
        ["command", "agent-with-tools:v0.0.1/EscalateToHuman"],
        ["command", "agent-with-tools:v0.0.1/ReportStatus"],
        ["command", "agent-with-tools:v0.0.1/UseTool"],
        ["function", "agent-with-tools:v0.0.1/AssistCustomer"],
      ]);
      // the secrets are read from process.env at run time, never baked into the bundle
      const bundle = await readFile(outfile, "utf8");
      expect(bundle).not.toMatch(/OPENAI_API_KEY\s*[:=]\s*["']/);
      expect(bundle).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
