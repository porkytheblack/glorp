/**
 * Subprocess-importable agent definitions for the ContinuumRunner bootstrap.
 *
 * The bootstrap loads this file via `import(CONTINUUM_AGENT_FILE)`, finds the
 * exported agent by name, and runs its factory. Config is read from env vars
 * set by the parent runner (GLORP_WORKSPACE, GLORP_DATA_DIR, GLORP_MESH_DIR).
 */

// Node 22's Happy Eyeballs (autoSelectFamily) breaks on endpoints that
// return unreachable IPv6 NAT64 records. Disable before any fetch occurs.
import * as net from "node:net";
net.setDefaultAutoSelectFamily(false);

import { agent, z } from "glove-continuum-signal";
import { Glove } from "glove-core/glove";
import { createAdapter } from "glove-core";
import { GlorpStore } from "../agent/store.ts";
import { createToolRegistry, registerTools } from "../agent/tools/registry.ts";
import { NoopDisplayManager } from "./noop-display.ts";
import { mountAgentMesh, teardownAgentMesh } from "./mesh-setup.ts";
import { roleDef, rolePrompt } from "./role-registry.ts";

const AgentInput = z.object({
  prompt: z.string(),
  workspace: z.string(),
  dataDir: z.string(),
});

function readEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

function buildModel() {
  const provider = process.env.GLORP_MODEL_PROVIDER ?? "openrouter";
  const model = process.env.GLORP_MODEL_NAME;
  const baseURL = process.env.GLORP_MODEL_BASE_URL;
  const apiKey = process.env.GLORP_MODEL_API_KEY;
  return createAdapter({
    provider, stream: true,
    ...(model ? { model } : {}),
    ...(baseURL ? { baseURL } : {}),
    ...(apiKey ? { apiKey } : {}),
  });
}

const DEFAULT_AGENT_TIMEOUT_MS = 600_000;

function makeAgent(role: string) {
  const def = roleDef(role);
  const timeoutMs = Number(process.env.GLORP_AGENT_TIMEOUT) || DEFAULT_AGENT_TIMEOUT_MS;
  return agent(role)
    .input(AgentInput)
    .triggered()
    .timeout(timeoutMs)
    .retries(0)
    .store((name: string) => {
      // Each triggered run needs a unique store to avoid accumulating
      // messages across unrelated sessions. Use run-scoped ID.
      const dataDir = readEnv("GLORP_DATA_DIR");
      const uid = `${name}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      return new GlorpStore(uid, dataDir);
    })
    .factory(async (ctx) => {
      const dataDir = readEnv("GLORP_DATA_DIR");
      const workspace = readEnv("GLORP_WORKSPACE");
      const meshDir = readEnv("GLORP_MESH_DIR");
      const uid = `${ctx.name}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const store = ctx.store ?? new GlorpStore(uid, dataDir);
      const display = new NoopDisplayManager();
      const model = buildModel();

      const builder = new Glove({
        store,
        model,
        displayManager: display as any,
        serverMode: true,
        systemPrompt: rolePrompt(role),
        compaction_config: {
          compaction_instructions: def.compaction,
          max_turns: def.maxTurns,
        },
      });

      const registry = createToolRegistry({ workspace, dataDir });
      registerTools(builder, registry, def.tools);
      if (ctx.subscriber) builder.addSubscriber(ctx.subscriber);
      const runnable = builder.build();

      const meshId = `${ctx.name}_${Date.now().toString(36)}`;
      const caps = [...def.capabilities];
      const meshAdapter = await mountAgentMesh(runnable, meshId, meshDir, caps);
      const orig = runnable.processRequest.bind(runnable);
      (runnable as any).processRequest = async (prompt: string, signal?: AbortSignal) => {
        try { return await orig(prompt, signal); }
        finally { await teardownAgentMesh(meshAdapter).catch(() => {}); }
      };
      return runnable as any;
    });
}

export const generator = makeAgent("generator");
export const evaluator = makeAgent("evaluator");
export const researcher = makeAgent("researcher");
export const builder = makeAgent("builder");
