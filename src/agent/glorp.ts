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
import { createTaskSink } from "./task-sink.ts";
import { SessionErrorLog, setActiveErrorLog } from "./runtime/error-log.ts";
import { PermissionDM } from "./runtime/permission-mode.ts";
import { classifyModelError } from "../shared/error-classify.ts";
import { estimateContextPressure } from "./runtime/context-pressure.ts";
import { teardownAgentMesh } from "../orchestrator/mesh-setup.ts";
import { agentId as toAgentId } from "../orchestrator/types.ts";
import { discoverWorkspaceContext } from "../orchestrator/workspace-context.ts";
import type { BuildGlorpOptions, GlorpHandle } from "./glorp-types.ts";
import type { ContentPart } from "glove-core/core";
import type { DisplaySlotEvent } from "../shared/events.ts";
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
  const bridge = opts.bridge ?? getBridge();
  const rawDM = new Displaymanager();
  const permissionDM = new PermissionDM(rawDM, opts.permissionMode ?? "normal");
  const labelListeners = new Set<(label: string) => void>();
  const diskExtensions = discoverExtensions(opts.workspace);

  const slotBridge = bridgeDisplaySlots(rawDM, bridge);
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

  // Task mode: the agent declares its deliverable through this sink (small JSON
  // files in the session folder), which the Garage Task API reads back.
  const taskSink = opts.task
    ? createTaskSink({
        resultFile: paths.taskResultFile,
        progressFile: paths.taskProgressFile,
        workspace: opts.workspace,
        deliverable: opts.task.deliverable ?? null,
      })
    : undefined;

  const activationDeps: ActivationDeps = {
    workspace: opts.workspace, dataDir, paths,
    bridge, orchestrator, displayManager: permissionDM, diskExtensions,
    sessionResources, titleTimeoutMs: TITLE_MODEL_TIMEOUT_MS,
    // Workspace processes can self-identify (PR markers, event callbacks):
    // a GitHub webhook carrying this id routes straight back to this session.
    // In task mode the agent (and its subprocesses) also learn the task.
    sessionEnv: {
      GLORP_SESSION_ID: opts.sessionId,
      GLORP_WORKSPACE: opts.workspace,
      // Sourced before every bash command. When an authed GitHub repo was
      // cloned, the engine wrote this script and it exports a fresh GH_TOKEN so
      // `gh`/GitHub API calls just work — no token handling by the agent. Bash
      // silently skips a missing BASH_ENV file, so this is a no-op otherwise.
      BASH_ENV: path.join(opts.workspace, ".glorp", "gh-env.sh"),
      ...(opts.task ? { GLORP_GARAGE: "1", GLORP_TASK_ID: opts.sessionId, GLORP_TASK_TYPE: opts.task.type } : {}),
      // Marks a disposable sandbox container; the shell guard reads this to skip
      // workspace-path confinement (the container is the real boundary).
      ...(opts.sandboxed ? { GLORP_SANDBOX: "1" } : {}),
    },
    task: opts.task,
    taskSink,
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

  // Open display slots = the agent's own (display-manager) plus any the
  // orchestrator forwarded up from a sub-agent, projected to one shape. Both
  // hydrate replay and the REST `openSlots()` read from this.
  const collectOpenSlots = (): DisplaySlotEvent[] => [
    ...slotBridge.openSlots(),
    ...orchestrator.openForwardedSlots().map((f) => ({
      slotId: f.slotId, renderer: f.renderer, input: f.input,
      createdAt: f.createdAt, isPermissionRequest: f.renderer === "permission_request",
    })),
  ];

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
      // Tell (re)connecting clients the CURRENT busy state: busy events only
      // fire at turn boundaries, so a client that joins mid-turn would render
      // "idle" — no Stop button, composer armed — while the agent is working.
      bridge.emit({ type: "busy", busy });
      // Replay pending display slots (permission prompts, pickers): they live
      // only in the display manager, so a client that connected after the push
      // — or is resyncing — would otherwise never see them and the agent would
      // hang on pushAndWait forever. Reducers upsert by slotId, so this is
      // idempotent for clients that already have the slot.
      for (const slot of collectOpenSlots()) {
        bridge.emit({ type: "display_slot_pushed", slot });
      }
      hydrateAgentRecords(await orchestrator.loadPersistedAgents(), bridge);
      await state.active.titleScheduler.refreshTitle();
      state.active.titleScheduler.schedule();
      emitRoster(activationDeps, state, busy);
    },
    openSlots: collectOpenSlots,
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
      // An aborted/errored previous turn can leave dangling tool calls (or
      // late results out of position) — strict providers reject the replay.
      // Heal the history before the new turn touches the model.
      state.active.store.repairToolFlow();
      state.active.verification.onUserTurn();
      abortController = new AbortController();
      busy = true;
      state.active.titleScheduler.setRequestInFlight(true);
      bridge.emit({ type: "busy", busy: true });
      bridge.emit({ type: "turn", turn: userTurn(text, images?.length) });
      // Honest-status watchdog: the model call can sit silent for minutes
      // (provider-side retry sleeps on 429, cold queues). Tick a model_status
      // event whenever nothing has streamed for ~10s so UIs can say "waiting
      // on the model" instead of looking frozen.
      let lastActivity = Date.now();
      let wasWaiting = false;
      const unsubWatch = bridge.subscribe((ev) => {
        if (ev.type === "text_delta" || ev.type === "tool_started" || ev.type === "turn") {
          lastActivity = Date.now();
          if (wasWaiting) {
            wasWaiting = false;
            bridge.emit({ type: "model_status", state: "active" });
          }
        }
      });
      const watchTimer = setInterval(() => {
        const silentSec = Math.round((Date.now() - lastActivity) / 1000);
        if (silentSec >= 10) {
          wasWaiting = true;
          bridge.emit({ type: "model_status", state: "waiting", elapsedSec: silentSec });
        }
      }, 5_000);
      try {
        const buildPrompt = parseBuildCommand(text);
        if (buildPrompt) {
          await runOrchestratorBuild(orchestrator, bridge, opts.workspace, buildPrompt, abortController.signal);
        } else {
          // Early compaction: when the projected request is heavy (long live
          // window, attached images), run glove's /compact hook FIRST in the
          // same turn — the hook force-compacts, then the message proceeds
          // against the fresh window. Waiting for glove's own threshold has
          // been observed to let quality collapse before it fires.
          let outgoing = text;
          if (!/(^|\s)\/compact(\s|$)/.test(text)) {
            const pressure = estimateContextPressure(
              await state.active.store.getDisplayMessages(),
              state.contextLimit,
              images?.length ?? 0,
            );
            if (pressure.pressured) {
              outgoing = `/compact ${text}`;
              bridge.emit({ type: "turn", turn: systemTurn("context compacted automatically before this turn") });
            }
          }
          const request = buildRequest(outgoing, images);
          await state.active.agent.processRequest(request, abortController.signal);
          await continueIfIntentOnly({ agent: state.active.agent, store: state.active.store, signal: abortController.signal });
          await continueOpenTasks({ agent: state.active.agent, store: state.active.store, signal: abortController.signal });
        }
      } catch (err: any) {
        if (err?.name === "AbortError") bridge.emit({ type: "turn", turn: systemTurn("aborted") });
        else {
          // Human headline + recovery hint up front; the raw error and stack
          // stay on `detail` for the collapsed technical view and error log.
          const c = classifyModelError(err);
          bridge.emit({
            type: "error",
            message: c.title,
            detail: [err?.message ?? String(err), err?.stack].filter(Boolean).join("\n"),
            kind: c.kind,
            hint: c.hint,
            ...(c.retryAfterSec ? { retryAfterSec: c.retryAfterSec } : {}),
          });
        }
      } finally {
        clearInterval(watchTimer);
        unsubWatch();
        if (wasWaiting) bridge.emit({ type: "model_status", state: "active" });
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
