/**
 * Agent factory for building Glove runnables from blueprints.
 * In-process agents for the gen-eval loop; continuum agents for background work.
 * Both paths read prompt and tool configuration from the role registry.
 */

import { agent, z } from "glove-continuum-signal";
import type { TriggeredAgent } from "glove-continuum-signal";
import { Glove } from "glove-core/glove";
import type { DisplayManagerAdapter } from "glove-core/display-manager";
import type { IGloveRunnable } from "glove-core/glove";
import type { ModelAdapter, SubscriberAdapter } from "glove-core/core";
import type { ResourceFsAdapter } from "glove-memory";
import { GlorpStore } from "../agent/store.ts";
import { createToolRegistry, registerTools } from "../agent/tools/registry.ts";
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
    model: config.model,
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
      const uid = `${agentName}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      return new GlorpStore(uid, config.dataDir);
    })
    .factory(async (ctx) => {
      const uid = `${ctx.name}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const store = ctx.store ?? new GlorpStore(uid, config.dataDir);
      const display = new NoopDisplayManager();
      const builder = new Glove({
        store,
        model: null as any, // subprocess constructs model from env
        displayManager: display as any,
        serverMode: true,
        systemPrompt: rolePrompt(role),
        compaction_config: {
          compaction_instructions: def.compaction,
          max_turns: def.maxTurns,
        },
      });
      const registry = createToolRegistry({
        workspace: config.workspace,
        dataDir: config.dataDir,
      });
      registerTools(builder, registry, def.tools);
      const runnable = builder.build();
      const meshId = `${ctx.name}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const meshAdapter = await mountAgentMesh(runnable, meshId, config.meshDir, [...def.capabilities]);
      const origProcess = runnable.processRequest.bind(runnable);
      (runnable as any).processRequest = async (prompt: string, signal?: AbortSignal) => {
        try { return await origProcess(prompt, signal); }
        finally { await teardownAgentMesh(meshAdapter).catch(() => {}); }
      };
      return runnable as any;
    });
}

/**
 * Serialize a blueprint into the AgentInputType for background dispatch.
 */
export function blueprintToInput(
  blueprint: AgentBlueprint,
  prompt: string,
  config: { workspace: string; dataDir: string },
): AgentInputType {
  return { prompt, workspace: config.workspace, dataDir: config.dataDir };
}
