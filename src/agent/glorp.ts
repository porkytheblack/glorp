import { Displaymanager } from "glove-core/display-manager";
import { pickModel } from "./model-picker.ts";
import { GlorpStore } from "./store.ts";
import { getBridge } from "../shared/bridge.ts";
import { Orchestrator } from "../orchestrator/orchestrator.ts";
import { parseBuildCommand, runOrchestratorBuild } from "./runtime/build-flow.ts";
import { CredentialsStore, effectiveProviderId } from "./credentials.ts";
import { ModelCatalog } from "./model-catalog.ts";
import { loadProjectConfig } from "./project-config.ts";
import { discoverExtensions } from "./extensions-loader.ts";
import { bridgeDisplaySlots } from "./runtime/display-bridge.ts";
import { createRefreshers } from "./runtime/refresh.ts";
import { continueOpenTasks, continueIfIntentOnly } from "./runtime/continuation.ts";
import { makeInboxContext } from "./runtime/context.ts";
import { hydrateUiSession, hydrateAgentRecords } from "./runtime/hydrate.ts";
import { createGlorpSubscriber } from "./runtime/subscriber.ts";
import { createSessionResources } from "./runtime/resources.ts";
import { buildExtensionCatalogue } from "./runtime/catalogue.ts";
import { generateSessionTitle, cleanSessionTitle } from "./runtime/title.ts";
import { createTitleScheduler } from "./runtime/title-scheduler.ts";
import { wrapGlorpModel } from "./runtime/model-guards.ts";
import { VerificationTracker } from "./runtime/verification-tracker.ts";
import { assembleAgent, wireOrchestratorToBridge } from "./runtime/assemble.ts";
import { PermissionDM } from "./runtime/permission-mode.ts";
import { teardownAgentMesh } from "../orchestrator/mesh-setup.ts";
import { agentId as toAgentId } from "../orchestrator/types.ts";
import { discoverWorkspaceContext } from "../orchestrator/workspace-context.ts";
import type { BuildGlorpOptions, GlorpHandle } from "./glorp-types.ts";
import type { ContentPart, Context } from "glove-core/core";
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
  const store = new GlorpStore(opts.sessionId, dataDir, { workspace: opts.workspace });
  const resources = createSessionResources(dataDir, opts.sessionId);
  const credentials = opts.credentials ?? new CredentialsStore(dataDir);
  const catalog = new ModelCatalog(dataDir);
  const projectConfig = loadProjectConfig(opts.workspace);
  let picked = await pickModel({ provider: opts.provider, model: opts.model, credentials, catalog, projectConfig });
  let contextLimit = picked.contextLimit; let modelLabel = picked.label;
  const bridge = getBridge();
  const titleScheduler = createTitleScheduler({ store, bridge, model: picked.titleAdapter, initialTitle: await store.getTitle(), timeoutMs: TITLE_MODEL_TIMEOUT_MS });
  const rawDM = new Displaymanager();
  const permissionDM = new PermissionDM(rawDM, opts.permissionMode ?? "normal");
  const labelListeners = new Set<(label: string) => void>();
  const diskExtensions = discoverExtensions(opts.workspace);

  bridgeDisplaySlots(rawDM, bridge);
  const verification = new VerificationTracker();
  store.setVerificationTracker(verification);
  const refresh = createRefreshers(store, bridge, () => contextLimit);
  const meshDir = path.join(dataDir, "mesh", opts.sessionId);
  const loopRefresh = { stats: async () => {}, plan: async () => {}, tasks: async () => {}, inbox: async () => {} };
  const wsPrompt = (await discoverWorkspaceContext(opts.workspace)).promptBlock;
  const orchestrator = new Orchestrator(
    { workspace: opts.workspace, dataDir, meshDir, model: wrapGlorpModel(picked.adapter),
      subprocessModel: buildSubprocessModelConfig(picked, credentials),
      contextLimit, resources, loopSubscriberFactory: () => createGlorpSubscriber(bridge, loopRefresh), workspaceContext: wsPrompt },
    rawDM,
  );
  await orchestrator.start(); wireOrchestratorToBridge(orchestrator, bridge);

  const ctxRef = { current: null as Context | null };
  const inboxContext = makeInboxContext(store);
  ctxRef.current = inboxContext;

  const assembleArgs = () => ({ picked, contextLimit, workspace: opts.workspace, dataDir, meshDir,
    store, resources, orchestrator, bridge, displayManager: permissionDM,
    diskExtensions, refresh, ctxRef, inboxContext, verification });

  let abortController: AbortController | null = null;
  let assembled = await assembleAgent(assembleArgs());
  let agent = assembled.agent;

  void refresh.all(); void catalog.refresh();

  return {
    get agent() { return agent; },
    orchestrator, store, credentials, catalog, projectConfig,
    sessionId: opts.sessionId,
    get title() { return titleScheduler.title; },
    get extensions() { return buildExtensionCatalogue(agent); },
    get modelLabel() { return modelLabel; },
    get permissionMode() { return permissionDM.mode; },
    setPermissionMode(mode) { permissionDM.mode = mode; bridge.emit({ type: "permission_mode_changed", mode }); },
    onLabelChange(fn) { labelListeners.add(fn); return () => void labelListeners.delete(fn); },
    async hydrateUi() {
      await hydrateUiSession(store, bridge, contextLimit);
      hydrateAgentRecords(await orchestrator.loadPersistedAgents(), bridge);
      await titleScheduler.refreshTitle();
      titleScheduler.schedule();
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
    clearPermission(toolName) { return store.clearAllPermissionsFor(toolName); },
    clearPermissionKey(key) { return store.clearPermissionKey(key); },
    listPermissions() { return store.listPermissions(); },
    async swapProfile(profileId) {
      const next = await pickModel({ profileId, credentials, catalog, projectConfig });
      abortController?.abort();
      await titleScheduler.cancel();
      await teardownAgentMesh(assembled.meshAdapter).catch(() => {});
      titleScheduler.setModel(next.titleAdapter);
      contextLimit = next.contextLimit;
      modelLabel = next.label;
      picked = next;
      assembled = await assembleAgent(assembleArgs());
      agent = assembled.agent;
      credentials.setActive(profileId);
      for (const fn of labelListeners) fn(modelLabel);
    },
    async send(text, images) {
      abortController?.abort();
      await titleScheduler.cancel();
      verification.onUserTurn();
      abortController = new AbortController();
      titleScheduler.setRequestInFlight(true);
      bridge.emit({ type: "busy", busy: true });
      bridge.emit({ type: "turn", turn: userTurn(text, images?.length) });
      try {
        const buildPrompt = parseBuildCommand(text);
        if (buildPrompt) {
          await runOrchestratorBuild(orchestrator, bridge, opts.workspace, buildPrompt, abortController.signal);
        } else {
          const request = buildRequest(text, images);
          await agent.processRequest(request, abortController.signal);
          await continueIfIntentOnly({ agent, store, signal: abortController.signal });
          await continueOpenTasks({ agent, store, signal: abortController.signal });
        }
      } catch (err: any) {
        if (err?.name === "AbortError") bridge.emit({ type: "turn", turn: systemTurn("aborted") });
        else bridge.emit({ type: "error", message: err?.message ?? String(err) });
      } finally {
        titleScheduler.setRequestInFlight(false);
        bridge.emit({ type: "busy", busy: false });
        void refresh.all();
        titleScheduler.schedule();
      }
    },
    async planAndBuild(prompt) {
      bridge.emit({ type: "busy", busy: true });
      try { await runOrchestratorBuild(orchestrator, bridge, opts.workspace, prompt); }
      finally { bridge.emit({ type: "busy", busy: false }); }
    },
    abort() { abortController?.abort(); void titleScheduler.cancel(); titleScheduler.setRequestInFlight(false); },
    async shutdown() {
      abortController?.abort();
      await titleScheduler.cancel();
      await teardownAgentMesh(assembled.meshAdapter).catch(() => {});
      await orchestrator.shutdown();
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
