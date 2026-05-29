import { Displaymanager } from "glove-core/display-manager";
import { pickModel } from "./model-picker.ts";
import { getBridge } from "../shared/bridge.ts";
import { Orchestrator } from "../orchestrator/orchestrator.ts";
import { parseBuildCommand, runOrchestratorBuild } from "./runtime/build-flow.ts";
import { CredentialsStore, effectiveProviderId } from "./credentials.ts";
import { ModelCatalog } from "./model-catalog.ts";
import { loadProjectConfig } from "./project-config.ts";
import { discoverExtensions } from "./extensions-loader.ts";
import { bridgeDisplaySlots } from "./runtime/display-bridge.ts";
import { continueOpenTasks, continueIfIntentOnly } from "./runtime/continuation.ts";
import { hydrateUiSession, hydrateAgentRecords } from "./runtime/hydrate.ts";
import { createGlorpSubscriber } from "./runtime/subscriber.ts";
import { createSessionResources } from "./runtime/resources.ts";
import { buildExtensionCatalogue } from "./runtime/catalogue.ts";
import { generateSessionTitle, cleanSessionTitle } from "./runtime/title.ts";
import { wrapGlorpModel } from "./runtime/model-guards.ts";
import { wireOrchestratorToBridge } from "./runtime/assemble.ts";
import {
  activateAgent, setActiveSpec, switchAgent as switchAgentOp,
  addAgent as addAgentOp, removeAgent as removeAgentOp,
  buildAgentInfos, emitRoster, type ActivationDeps, type RosterState,
} from "./runtime/active-agent.ts";
import { loadRoster, saveRoster } from "./runtime/agent-roster.ts";
import { resolveSessionPaths } from "./session-paths.ts";
import { SessionErrorLog, setActiveErrorLog } from "./runtime/error-log.ts";
import { PermissionDM } from "./runtime/permission-mode.ts";
import { teardownAgentMesh } from "../orchestrator/mesh-setup.ts";
import { agentId as toAgentId } from "../orchestrator/types.ts";
import { discoverWorkspaceContext } from "../orchestrator/workspace-context.ts";
import type { BuildGlorpOptions, GlorpHandle } from "./glorp-types.ts";
import type { ContentPart } from "glove-core/core";
import type { PickedModel } from "./model-picker.ts";
import type { OrchestratorConfig } from "../orchestrator/types.ts";
import * as path from "node:path"; import * as os from "node:os";

export type { BuildGlorpOptions, ExtensionCatalogue, GlorpHandle } from "./glorp-types.ts";
export type { PermissionMode } from "./runtime/permission-mode.ts";
export { cleanSessionTitle, generateSessionTitle };
export { messageHasOpenTaskUpdate, modelResultHasToolCall, modelResultHasVisibleAgentOutput,
  modelResultIsIntentOnly, withEmptyResponseRetry, withIntentOnlyContinuation, withTaskUpdateContinuation } from "./runtime/model-guards.ts";

const TITLE_MODEL_TIMEOUT_MS = 15_000;

export async function buildGlorp(opts: BuildGlorpOptions): Promise<GlorpHandle> {
  const dataDir = opts.dataDir ?? path.join(os.homedir(), ".glorp");
  const paths = resolveSessionPaths(dataDir, opts.sessionId);
  const sessionResources = createSessionResources(dataDir, opts.sessionId, paths.resourcesFile);
  const credentials = opts.credentials ?? new CredentialsStore(dataDir);
  const catalog = new ModelCatalog(dataDir);
  const projectConfig = loadProjectConfig(opts.workspace);
  const picked = await pickModel({ provider: opts.provider, model: opts.model, credentials, catalog, projectConfig });
  const contextLimit = picked.contextLimit;
  const bridge = getBridge();
  const rawDM = new Displaymanager();
  const permissionDM = new PermissionDM(rawDM, opts.permissionMode ?? "normal");
  const labelListeners = new Set<(label: string) => void>();
  const diskExtensions = discoverExtensions(opts.workspace);

  bridgeDisplaySlots(rawDM, bridge);
  const meshDir = paths.meshDir;
  const loopRefresh = { stats: async () => {}, plan: async () => {}, tasks: async () => {}, inbox: async () => {} };
  const wsPrompt = (await discoverWorkspaceContext(opts.workspace)).promptBlock;
  const orchestrator = new Orchestrator(
    { workspace: opts.workspace, dataDir, meshDir, model: wrapGlorpModel(picked.adapter),
      subprocessModel: buildSubprocessModelConfig(picked, credentials),
      contextLimit, resources: sessionResources, loopSubscriberFactory: () => createGlorpSubscriber(bridge, loopRefresh), workspaceContext: wsPrompt },
    rawDM,
  );
  await orchestrator.start(); wireOrchestratorToBridge(orchestrator, bridge);

  const activationDeps: ActivationDeps = {
    workspace: opts.workspace, dataDir, paths,
    bridge, orchestrator, displayManager: permissionDM, diskExtensions,
    sessionResources, titleTimeoutMs: TITLE_MODEL_TIMEOUT_MS,
  };

  const roster = loadRoster(paths.rosterFile, opts.sessionId);
  const initialSpec = roster.specs.find((s) => s.id === roster.activeId) ?? roster.specs[0];
  const state: RosterState = {
    roster, picked, contextLimit, modelLabel: picked.label,
    active: await activateAgent(activationDeps, initialSpec, picked, contextLimit),
  };

  let abortController: AbortController | null = null;
  let busy = false;

  // Per-session error log: persist every error for post-mortem inspection.
  // Captures bridge `error` events (incl. stack via `detail`) and tees
  // console.error while this session is the active one.
  const errorLog = new SessionErrorLog(paths.errorsFile);
  setActiveErrorLog(errorLog);
  const unsubErrorLog = bridge.subscribe((ev) => {
    if (ev.type === "error") {
      errorLog.record({ source: "agent", message: ev.message, detail: ev.detail, agentId: state.roster.activeId });
    }
  });

  void state.active.refresh.all(); void catalog.refresh();

  return {
    get agent() { return state.active.agent; },
    orchestrator,
    get store() { return state.active.store; },
    credentials, catalog, projectConfig,
    sessionId: opts.sessionId,
    get title() { return state.active.titleScheduler.title; },
    get extensions() { return buildExtensionCatalogue(state.active.agent); },
    get modelLabel() { return state.modelLabel; },
    get permissionMode() { return permissionDM.mode; },
    setPermissionMode(mode) { permissionDM.mode = mode; bridge.emit({ type: "permission_mode_changed", mode }); },
    onLabelChange(fn) { labelListeners.add(fn); return () => void labelListeners.delete(fn); },
    get activeAgentId() { return state.roster.activeId; },
    listAgents() { return buildAgentInfos(state, busy); },
    async switchAgent(id) { abortController?.abort(); await switchAgentOp(activationDeps, state, id); },
    async addAgent(o) { abortController?.abort(); return addAgentOp(activationDeps, state, o); },
    async removeAgent(id) { abortController?.abort(); await removeAgentOp(activationDeps, state, id); },
    async hydrateUi() {
      await hydrateUiSession(state.active.store, bridge, state.contextLimit);
      hydrateAgentRecords(await orchestrator.loadPersistedAgents(), bridge);
      await state.active.titleScheduler.refreshTitle();
      state.active.titleScheduler.schedule();
      emitRoster(activationDeps, state, busy);
    },
    resolveSlot(slotId, value) {
      if (orchestrator.hasForwardedSlot(slotId)) { orchestrator.resolveForwardedSlot(slotId, value); bridge.emit({ type: "display_slot_resolved", slotId }); }
      else resolveDisplaySlot(rawDM, bridge, slotId, value);
    },
    rejectSlot(slotId, reason) {
      if (orchestrator.hasForwardedSlot(slotId)) {
        orchestrator.rejectForwardedSlot(slotId, reason);
      } else {
        try { rawDM.reject(slotId, reason); } catch {}
      }
      bridge.emit({ type: "display_slot_resolved", slotId });
    },
    resolvePermission(slotId, allow) {
      if (orchestrator.hasForwardedSlot(slotId)) { orchestrator.resolveForwardedSlot(slotId, allow); bridge.emit({ type: "display_slot_resolved", slotId }); }
      else resolveDisplaySlot(rawDM, bridge, slotId, allow);
    },
    async stopAgent(id, reason) { await orchestrator.stopAgent(toAgentId(id), reason); },
    promoteAgent(id) { return orchestrator.promoteAgent(toAgentId(id)); },
    clearPermission(toolName) { return state.active.store.clearAllPermissionsFor(toolName); },
    clearPermissionKey(key) { return state.active.store.clearPermissionKey(key); },
    listPermissions() { return state.active.store.listPermissions(); },
    async swapProfile(profileId) {
      const next = await pickModel({ profileId, credentials, catalog, projectConfig });
      abortController?.abort();
      state.picked = next;
      state.contextLimit = next.contextLimit;
      state.modelLabel = next.label;
      await setActiveSpec(activationDeps, state, state.active.spec, false);
      credentials.setActive(profileId);
      for (const fn of labelListeners) fn(state.modelLabel);
    },
    async send(text, images) {
      abortController?.abort();
      await state.active.titleScheduler.cancel();
      state.active.verification.onUserTurn();
      abortController = new AbortController();
      busy = true;
      state.active.titleScheduler.setRequestInFlight(true);
      bridge.emit({ type: "busy", busy: true });
      bridge.emit({ type: "turn", turn: userTurn(text, images?.length) });
      try {
        const buildPrompt = parseBuildCommand(text);
        if (buildPrompt) {
          await runOrchestratorBuild(orchestrator, bridge, opts.workspace, buildPrompt, abortController.signal);
        } else {
          const request = buildRequest(text, images);
          await state.active.agent.processRequest(request, abortController.signal);
          await continueIfIntentOnly({ agent: state.active.agent, store: state.active.store, signal: abortController.signal });
          await continueOpenTasks({ agent: state.active.agent, store: state.active.store, signal: abortController.signal });
        }
      } catch (err: any) {
        if (err?.name === "AbortError") bridge.emit({ type: "turn", turn: systemTurn("aborted") });
        else bridge.emit({ type: "error", message: err?.message ?? String(err), detail: err?.stack });
      } finally {
        state.active.titleScheduler.setRequestInFlight(false);
        busy = false;
        bridge.emit({ type: "busy", busy: false });
        void state.active.refresh.all();
        state.active.titleScheduler.schedule();
        state.active.spec.turnCount = await state.active.store.getTurnCount().catch(() => state.active.spec.turnCount);
        state.active.spec.lastActiveAt = Date.now();
        saveRoster(paths.rosterFile, state.roster);
        emitRoster(activationDeps, state, false);
      }
    },
    async planAndBuild(prompt) {
      bridge.emit({ type: "busy", busy: true });
      try { await runOrchestratorBuild(orchestrator, bridge, opts.workspace, prompt); }
      finally { bridge.emit({ type: "busy", busy: false }); }
    },
    abort() { abortController?.abort(); void state.active.titleScheduler.cancel(); state.active.titleScheduler.setRequestInFlight(false); },
    async shutdown() {
      abortController?.abort();
      await state.active.titleScheduler.cancel();
      await teardownAgentMesh(state.active.meshAdapter).catch(() => {});
      await orchestrator.shutdown();
      unsubErrorLog();
      setActiveErrorLog(null);
      await errorLog.flush().catch(() => {});
    },
  };
}

const userTurn = (text: string, n?: number) => ({ id: `u_${Date.now().toString(36)}`, kind: "user" as const, text, createdAt: Date.now(), ...(n ? { meta: { imageCount: n } } : {}) });
const systemTurn = (text: string) => ({ id: `s_${Date.now().toString(36)}`, kind: "system" as const, text, createdAt: Date.now() });

function buildRequest(text: string, images?: Array<{ data: string; media_type: string }>): string | ContentPart[] {
  if (!images?.length) return text;
  const label = images.length === 1 ? "1 image attached" : `${images.length} images attached`;
  const parts: ContentPart[] = [{ type: "text", text: `[${label} — examine before responding]\n\n${text}` }];
  for (const img of images) parts.push({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } });
  return parts;
}

function resolveDisplaySlot(dm: Displaymanager, bridge: ReturnType<typeof getBridge>, slotId: string, value: unknown): void {
  try { dm.resolve(slotId, value); } catch {}
  bridge.emit({ type: "display_slot_resolved", slotId });
}

function buildSubprocessModelConfig(picked: PickedModel, creds: CredentialsStore): OrchestratorConfig["subprocessModel"] {
  const p = creds.getProvider(picked.providerId);
  return { providerId: effectiveProviderId(picked.providerId, p), model: picked.model, baseURL: p?.baseURL, apiKey: p?.apiKey };
}
