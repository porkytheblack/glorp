/**
 * Per-agent activation + roster switching.
 *
 * A session hosts a roster of conversational agents; exactly one is "active"
 * (its transcript is shown, input routes to it). Activating an agent builds a
 * live Glove bound to that agent's own store + persona — the same teardown /
 * re-assemble path proven by swapProfile, keyed by agent identity instead of
 * model profile. Switching tears down the current live agent and activates the
 * target, then re-hydrates the UI from the target's transcript.
 */

import type { DisplayManagerAdapter } from "glove-core/display-manager";
import type { IGloveRunnable } from "glove-core/glove";
import type { Context } from "glove-core/core";
import type { ResourceFsAdapter } from "glove-memory";
import { GlorpStore } from "../store.ts";
import type { TaskSink } from "../task-sink.ts";
import type { TaskContext } from "../task-deliverable.ts";
import { VerificationTracker } from "./verification-tracker.ts";
import { createSessionResources } from "./resources.ts";
import { createRefreshers } from "./refresh.ts";
import { makeInboxContext } from "./context.ts";
import { createTitleScheduler } from "./title-scheduler.ts";
import { assembleAgent } from "./assemble.ts";
import { buildAgentSystemPrompt } from "../persona.ts";
import { teardownAgentMesh, type FileMeshAdapter } from "../../orchestrator/mesh-setup.ts";
import { hydrateUiSession } from "./hydrate.ts";
import {
  MAIN_AGENT_ID, newAgentSpec, saveRoster,
  type AgentSpec, type RosterFile,
} from "./agent-roster.ts";
import { agentStoreFile, agentResourcesFile, type SessionPaths } from "../session-paths.ts";
import type { Orchestrator } from "../../orchestrator/orchestrator.ts";
import type { ExtensionsBundle } from "../extensions-loader.ts";
import type { McpManager } from "../mcp/manager.ts";
import type { PickedModel } from "../model-picker.ts";
import type { getBridge } from "../../shared/bridge.ts";
import type { AgentInfo } from "../../shared/events.ts";
import * as fs from "node:fs";
import * as path from "node:path";

type Bridge = ReturnType<typeof getBridge>;

export interface ActivationDeps {
  workspace: string;
  dataDir: string;
  /** Resolved on-disk paths for this session (folder or legacy layout). */
  paths: SessionPaths;
  bridge: Bridge;
  orchestrator: Orchestrator;
  displayManager: DisplayManagerAdapter;
  diskExtensions: ExtensionsBundle;
  /** Shared session resources (also used by the orchestrator); reused by the main agent. */
  sessionResources: ResourceFsAdapter;
  titleTimeoutMs: number;
  /** Per-session env injected into bash spawns (e.g. GLORP_SESSION_ID). */
  sessionEnv?: Record<string, string>;
  /** Task context (task mode) — applied to the MAIN agent only. */
  task?: TaskContext;
  taskSink?: TaskSink;
  /** Session MCP runtime — re-mounted onto every (re)assembled agent. */
  mcp?: McpManager;
}

export interface ActiveAgent {
  spec: AgentSpec;
  store: GlorpStore;
  agent: IGloveRunnable;
  meshAdapter: FileMeshAdapter;
  resources: ResourceFsAdapter;
  refresh: ReturnType<typeof createRefreshers>;
  titleScheduler: ReturnType<typeof createTitleScheduler>;
  verification: VerificationTracker;
  inboxContext: Context;
  ctxRef: { current: Context | null };
}

/** Mutable holder threaded through the roster operations. */
export interface RosterState {
  roster: RosterFile;
  active: ActiveAgent;
  picked: PickedModel;
  contextLimit: number;
  modelLabel: string;
}

export async function activateAgent(
  deps: ActivationDeps,
  spec: AgentSpec,
  picked: PickedModel,
  contextLimit: number,
): Promise<ActiveAgent> {
  const isMain = spec.id === MAIN_AGENT_ID;
  const storeFile = isMain ? deps.paths.storeFile : agentStoreFile(deps.paths, spec.id);
  const store = new GlorpStore(spec.storeId, deps.dataDir, { workspace: deps.workspace, filePath: storeFile });
  // Attribute this agent's token deltas to the picked model (with its catalog
  // price) so the per-model usage ledger reflects the model actually running —
  // including mid-session profile swaps, which re-run this path.
  store.setActiveModel({
    providerId: picked.providerId,
    model: picked.model,
    label: picked.label,
    cost: picked.modelInfo?.cost,
  });
  const resources = isMain
    ? deps.sessionResources
    : createSessionResources(deps.dataDir, spec.storeId, agentResourcesFile(deps.paths, spec.id));
  const verification = new VerificationTracker();
  store.setVerificationTracker(verification);
  const refresh = createRefreshers(store, deps.bridge, () => contextLimit);
  const inboxContext = makeInboxContext(store);
  const ctxRef = { current: inboxContext as Context | null };
  const titleScheduler = createTitleScheduler({
    store, bridge: deps.bridge, model: picked.titleAdapter,
    initialTitle: await store.getTitle(), timeoutMs: deps.titleTimeoutMs,
  });
  const systemPrompt = buildAgentSystemPrompt(spec.role, {
    workspace: deps.workspace, contextLimit, extensions: deps.diskExtensions,
  });
  const assembled = await assembleAgent({
    picked, contextLimit, workspace: deps.workspace, dataDir: deps.dataDir, meshDir: deps.paths.meshDir,
    store, resources, orchestrator: deps.orchestrator, bridge: deps.bridge,
    displayManager: deps.displayManager, diskExtensions: deps.diskExtensions,
    refresh, ctxRef, inboxContext, verification, systemPrompt, meshName: spec.id,
    sessionEnv: deps.sessionEnv,
    // Task self-knowledge + toolkit go to the MAIN worker only, not spawned agents.
    task: isMain ? deps.task : undefined,
    taskSink: isMain ? deps.taskSink : undefined,
    mcp: deps.mcp,
  });
  return {
    spec, store, agent: assembled.agent, meshAdapter: assembled.meshAdapter,
    resources, refresh, titleScheduler, verification, inboxContext, ctxRef,
  };
}

/** Tear down the live agent and activate `spec`. Optionally re-hydrate the UI. */
export async function setActiveSpec(
  deps: ActivationDeps, state: RosterState, spec: AgentSpec, hydrate: boolean,
): Promise<void> {
  await state.active.titleScheduler.cancel();
  // Persist the outgoing agent's transcript before we drop its store, so a
  // later switch back reads its latest messages from disk (not a stale copy).
  await state.active.store.flush().catch(() => {});
  await teardownAgentMesh(state.active.meshAdapter).catch(() => {});
  state.active = await activateAgent(deps, spec, state.picked, state.contextLimit);
  state.roster.activeId = spec.id;
  spec.lastActiveAt = Date.now();
  saveRoster(deps.paths.rosterFile, state.roster);
  if (hydrate) await hydrateUiSession(state.active.store, deps.bridge, state.contextLimit);
  emitRoster(deps, state, false);
  void state.active.refresh.all();
}

export async function switchAgent(deps: ActivationDeps, state: RosterState, id: string): Promise<void> {
  if (id === state.roster.activeId) return;
  const spec = state.roster.specs.find((s) => s.id === id);
  if (!spec) return;
  await setActiveSpec(deps, state, spec, true);
}

export async function addAgent(
  deps: ActivationDeps, state: RosterState, opts: { role: string; label?: string },
): Promise<string> {
  const spec = newAgentSpec(deps.paths.sessionId, opts.role, opts.label);
  state.roster.specs.push(spec);
  saveRoster(deps.paths.rosterFile, state.roster);
  await setActiveSpec(deps, state, spec, true);
  return spec.id;
}

export async function removeAgent(deps: ActivationDeps, state: RosterState, id: string): Promise<void> {
  if (id === MAIN_AGENT_ID) return;
  const spec = state.roster.specs.find((s) => s.id === id);
  if (!spec) return;
  if (id === state.roster.activeId) {
    const main = state.roster.specs.find((s) => s.id === MAIN_AGENT_ID)!;
    await setActiveSpec(deps, state, main, true);
  }
  state.roster.specs = state.roster.specs.filter((s) => s.id !== id);
  saveRoster(deps.paths.rosterFile, state.roster);
  // Delete the removed agent's storage: its whole folder (folder layout) or
  // its flat transcript + resources files (legacy layout).
  try {
    const storeFile = agentStoreFile(deps.paths, id);
    if (deps.paths.legacy) {
      fs.rmSync(storeFile, { force: true });
      fs.rmSync(agentResourcesFile(deps.paths, id), { force: true });
    } else {
      fs.rmSync(path.dirname(storeFile), { recursive: true, force: true });
    }
  } catch { /* best effort */ }
  emitRoster(deps, state, false);
}

export function buildAgentInfos(state: RosterState, busy: boolean): AgentInfo[] {
  return state.roster.specs.map((s) => ({
    id: s.id,
    label: s.label,
    role: s.role,
    active: s.id === state.roster.activeId,
    busy: s.id === state.roster.activeId ? busy : false,
    createdAt: s.createdAt,
    lastActiveAt: s.lastActiveAt,
    turnCount: s.turnCount,
  }));
}

export function emitRoster(deps: ActivationDeps, state: RosterState, busy: boolean): void {
  deps.bridge.emit({ type: "agent_roster", agents: buildAgentInfos(state, busy), activeId: state.roster.activeId });
}
