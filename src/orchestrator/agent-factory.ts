/**
 * Agent factory for building Glove runnables from blueprints.
 * In-process agents for the gen-eval loop; continuum agents for background work.
 * Both paths read prompt and tool configuration from the role registry.
 *
 * The subprocess factory (defineOrchestratorAgent) is the SINGLE source of truth
 * for agent construction — agent-entrypoint.ts re-exports these definitions.
 */

import { agent, z } from "glove-continuum-signal";
import type { TriggeredAgent } from "glove-continuum-signal";
import { Glove } from "glove-core/glove";
import { createAdapter } from "glove-core";
import type { DisplayManagerAdapter } from "glove-core/display-manager";
import type { IGloveRunnable } from "glove-core/glove";
import type { ModelAdapter, SubscriberAdapter } from "glove-core/core";
import type { ResourceFsAdapter } from "glove-memory";
import { GlorpStore } from "../agent/store.ts";
import { createToolRegistry, registerTools } from "../agent/tools/registry.ts";
import { withImageToolResults } from "../agent/runtime/image-tool-results.ts";
import { NoopDisplayManager } from "./noop-display.ts";
import { mountAgentMesh, teardownAgentMesh, type FileMeshAdapter } from "./mesh-setup.ts";
import { roleDef, rolePrompt } from "./role-registry.ts";
import type { AgentBlueprint } from "./types.ts";

/** Return value of buildAgentFromBlueprint — includes the mesh adapter for cleanup. */
export interface BuiltAgent {
  runnable: IGloveRunnable;
  meshAdapter: FileMeshAdapter | null;
}

/** Zod schema for triggered background agent input. */
export const AgentInput = z.object({
  prompt: z.string(),
  workspace: z.string(),
  dataDir: z.string(),
});

export type AgentInputType = z.infer<typeof AgentInput>;

// --- Subprocess helpers (called inside factory, read from env set by runner) ---

function buildSubprocessModel(): ModelAdapter {
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

function enrichWithContext(prompt: string): string {
  const ctx = process.env.GLORP_WORKSPACE_CONTEXT;
  return ctx ? `${prompt}\n\n${ctx}` : prompt;
}

/**
 * Build a Glove runnable in-process from a blueprint.
 * Used by the gen-eval loop for fast, same-process agent execution.
 * When meshDir is provided, mounts glove-mesh so the agent can communicate
 * with other agents. The caller is responsible for teardown via the returned
 * meshAdapter.
 */
export async function buildAgentFromBlueprint(
  blueprint: AgentBlueprint,
  config: {
    workspace: string;
    dataDir: string;
    model: ModelAdapter;
    /** Inherited context window size — drives compaction_context_limit. */
    contextLimit?: number;
    display: DisplayManagerAdapter;
    meshDir?: string;
    subscriber?: SubscriberAdapter;
    resources?: ResourceFsAdapter;
    /** Pre-created store for conversation persistence. Falls back to a fresh GlorpStore. */
    store?: GlorpStore;
  },
): Promise<BuiltAgent> {
  const store = config.store ?? new GlorpStore(`orch_${blueprint.id}`, config.dataDir);
  const def = roleDef(blueprint.role === "autonomous" ? "builder" : blueprint.role);

  const builder = new Glove({
    store,
    model: withImageToolResults(config.model),
    displayManager: config.display as any,
    serverMode: true,
    systemPrompt: blueprint.systemPrompt,
    compaction_config: {
      compaction_instructions: def.compaction,
      compaction_context_limit: config.contextLimit,
      max_turns: def.maxTurns,
    },
  });

  const registry = createToolRegistry({
    workspace: config.workspace, dataDir: config.dataDir, store, resources: config.resources,
  });
  registerTools(builder, registry, blueprint.tools);
  if (config.subscriber) builder.addSubscriber(config.subscriber);

  const runnable = builder.build();
  let meshAdapter: FileMeshAdapter | null = null;
  if (config.meshDir) {
    const caps = [...(blueprint.capabilities ?? [])];
    meshAdapter = await mountAgentMesh(runnable, blueprint.id, config.meshDir, caps);
  }
  return { runnable, meshAdapter };
}

/**
 * Define a continuum triggered agent for a specific role.
 * The role registry determines the system prompt, tool set, and compaction config.
 * Used for subprocess-isolated background work.
 */
const DEFAULT_AGENT_TIMEOUT_MS = 600_000;

export function defineOrchestratorAgent(
  role: string,
  config: { dataDir: string; workspace: string; meshDir: string; agentTimeoutMs?: number },
): TriggeredAgent<AgentInputType, void> {
  const def = roleDef(role);
  const timeoutMs = config.agentTimeoutMs ?? DEFAULT_AGENT_TIMEOUT_MS;
  return agent(role)
    .input(AgentInput)
    .triggered()
    .timeout(timeoutMs)
    .retries(0)
    .store((agentName: string) => {
      const dd = process.env.GLORP_DATA_DIR ?? config.dataDir;
      const uid = `${agentName}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      return new GlorpStore(uid, dd);
    })
    .factory(async (ctx) => {
      const dataDir = process.env.GLORP_DATA_DIR ?? config.dataDir;
      const workspace = process.env.GLORP_WORKSPACE ?? config.workspace;
      const meshDir = process.env.GLORP_MESH_DIR ?? config.meshDir;
      const uid = `${ctx.name}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      // ctx.store is typed as the generic StoreAdapter, but the `.store()`
      // factory above always returns a GlorpStore — narrow it so store-backed
      // tools (the plan tool) get the concrete type they require.
      const store = (ctx.store as GlorpStore | undefined) ?? new GlorpStore(uid, dataDir);
      const model = withImageToolResults(buildSubprocessModel());

      const builder = new Glove({
        store, model,
        displayManager: new NoopDisplayManager() as any,
        serverMode: true,
        systemPrompt: enrichWithContext(rolePrompt(role)),
        compaction_config: { compaction_instructions: def.compaction, max_turns: def.maxTurns },
      });
      // Pass the agent's own store so store-backed tools (e.g. the planner's
      // glorp_update_plan) construct correctly. Without it the generator role
      // — the only built-in role with the plan tool — threw "Tool registry
      // missing store" and the subprocess died ("exited unexpectedly").
      const registry = createToolRegistry({ workspace, dataDir, store, meshDir });
      registerTools(builder, registry, def.tools);
      if (ctx.subscriber) builder.addSubscriber(ctx.subscriber);
      const runnable = builder.build();
      const meshId = `${ctx.name}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const meshAdapter = await mountAgentMesh(runnable, meshId, meshDir, [...def.capabilities]);
      const orig = runnable.processRequest.bind(runnable);
      (runnable as any).processRequest = async (prompt: string, signal?: AbortSignal) => {
        try { return await orig(prompt, signal); }
        finally { await teardownAgentMesh(meshAdapter).catch(() => {}); }
      };
      return runnable as any;
    });
}

/**
 * Serialize a blueprint into the AgentInputType for background dispatch.
 * When the blueprint has customContext (user-provided system_prompt via
 * spawn_agent), it is prepended to the prompt since subprocess factories
 * determine the base system prompt from the role registry at build time.
 */
export function blueprintToInput(
  blueprint: AgentBlueprint,
  prompt: string,
  config: { workspace: string; dataDir: string },
): AgentInputType {
  const effectivePrompt = blueprint.customContext
    ? `[Custom context for this task]\n${blueprint.customContext}\n\n${prompt}`
    : prompt;
  return { prompt: effectivePrompt, workspace: config.workspace, dataDir: config.dataDir };
}
