import { Glove } from "glove-core/glove";
import { Displaymanager } from "glove-core/display-manager";
import { pickModel } from "./model-picker.ts";
import { GlorpStore } from "./store.ts";
import { buildGlorpSystemPrompt, COMPACTION_INSTRUCTIONS } from "./persona.ts";
import { MAIN_AGENT_TOOLS, createToolRegistry, registerTools } from "./tools/registry.ts";
import { plannerSubAgent, researcherSubAgent, reviewerSubAgent } from "./subagents.ts";
import { makeDiskSubAgent } from "./agents/disk-subagent.ts";
import { getBridge } from "../shared/bridge.ts";
import type { GlorpFleet } from "./station-bridge.ts";
import { createFleet } from "./station-bridge.ts";
import { CredentialsStore } from "./credentials.ts";
import { discoverExtensions } from "./extensions-loader.ts";
import { bridgeDisplaySlots } from "./runtime/display-bridge.ts";
import { createRefreshers } from "./runtime/refresh.ts";
import { createGlorpSubscriber } from "./runtime/subscriber.ts";
import { continueOpenTasks } from "./runtime/continuation.ts";
import { makeInboxContext } from "./runtime/context.ts";
import { foldContextTools } from "./runtime/glove-tools.ts";
import { hydrateUiSession } from "./runtime/hydrate.ts";
import { registerHooks } from "./runtime/hooks.ts";
import { createSessionResources, foldResourceTools } from "./runtime/resources.ts";
import { registerBuiltInSkills, registerDiskSkills } from "./runtime/skills.ts";
import { buildExtensionCatalogue } from "./runtime/catalogue.ts";
import type { BuildGlorpOptions, GlorpHandle } from "./glorp-types.ts";
import * as path from "node:path";
import * as os from "node:os";

export type { BuildGlorpOptions, ExtensionCatalogue, GlorpHandle } from "./glorp-types.ts";

const CONTEXT_LIMIT = 180_000;

export async function buildGlorp(opts: BuildGlorpOptions): Promise<GlorpHandle> {
  const dataDir = opts.dataDir ?? path.join(os.homedir(), ".glorp");
  const store = new GlorpStore(opts.sessionId, dataDir);
  const resources = createSessionResources(dataDir, opts.sessionId);
  const credentials = opts.credentials ?? new CredentialsStore(dataDir);
  const picked = await pickModel({ provider: opts.provider, model: opts.model, credentials });
  let modelLabel = picked.label;
  const displayManager = new Displaymanager();
  const bridge = getBridge();
  const labelListeners = new Set<(label: string) => void>();
  const diskExtensions = discoverExtensions(opts.workspace);

  bridgeDisplaySlots(displayManager, bridge);
  const refresh = createRefreshers(store, bridge, CONTEXT_LIMIT);
  const fleet = await createFleet({
    workspace: opts.workspace,
    model: picked.adapter,
    dataDir,
    provider: opts.provider,
    selectedModel: opts.provider ? picked.model : undefined,
    profileId: picked.profile?.id,
    onJobUpdate: (job) => bridge.emit({ type: "fleet", job }),
  });
  await fleet.start();

  const ctxRef = { current: null as import("glove-core/core").Context | null };
  let abortController: AbortController | null = null;
  const builder = new Glove({
    store,
    model: picked.adapter,
    displayManager,
    serverMode: true,
    systemPrompt: buildGlorpSystemPrompt({
      workspace: opts.workspace,
      contextLimit: CONTEXT_LIMIT,
      extensions: diskExtensions,
    }),
    compaction_config: {
      compaction_instructions: COMPACTION_INSTRUCTIONS,
      compaction_context_limit: CONTEXT_LIMIT,
      max_turns: 200,
    },
  });

  builder.addSubscriber(createGlorpSubscriber(bridge, refresh));
  registerTools(
    builder,
    createToolRegistry({ workspace: opts.workspace, dataDir, store, resources, fleet, contextRef: ctxRef }),
    MAIN_AGENT_TOOLS,
  );
  foldResourceTools(builder, resources);
  builder
    .defineSubAgent(plannerSubAgent({ workspace: opts.workspace, dataDir }))
    .defineSubAgent(researcherSubAgent({ workspace: opts.workspace, dataDir }))
    .defineSubAgent(reviewerSubAgent({ workspace: opts.workspace, dataDir }));
  for (const sub of diskExtensions.subagents) {
    builder.defineSubAgent(makeDiskSubAgent(sub, { workspace: opts.workspace, dataDir }));
  }
  registerHooks(builder);
  registerBuiltInSkills(builder);
  registerDiskSkills(builder, diskExtensions.skills);

  const agent = builder.build();
  const inboxContext = makeInboxContext(store);
  ctxRef.current = inboxContext;
  fleet.setContext(inboxContext);
  foldContextTools(agent, inboxContext);
  fleet.setInboxResolver(async (itemId, response, status) => {
    const payload = status === "error" ? `[fleet error] ${response}` : response;
    await store.updateInboxItem(itemId, {
      status: "resolved",
      response: payload,
      resolved_at: new Date().toISOString(),
    });
    void refresh.inbox();
  });
  void refresh.all();

  return {
    agent,
    fleet,
    store,
    credentials,
    sessionId: opts.sessionId,
    extensions: buildExtensionCatalogue(agent),
    get modelLabel() {
      return modelLabel;
    },
    onLabelChange(fn) {
      labelListeners.add(fn);
      return () => void labelListeners.delete(fn);
    },
    hydrateUi() {
      return hydrateUiSession(store, bridge, CONTEXT_LIMIT);
    },
    resolveSlot(slotId, value) {
      resolveDisplaySlot(displayManager, bridge, slotId, value);
    },
    rejectSlot(slotId, reason) {
      try {
        displayManager.reject(slotId, reason);
      } catch {}
      bridge.emit({ type: "display_slot_resolved", slotId });
    },
    resolvePermission(slotId, allow) {
      resolveDisplaySlot(displayManager, bridge, slotId, allow);
    },
    clearPermission(toolName) {
      return store.setPermission(toolName, "unset");
    },
    async swapProfile(profileId) {
      const next = await pickModel({ profileId, credentials });
      abortController?.abort();
      agent.setModel(next.adapter);
      modelLabel = next.label;
      fleet.setModelConfig({
        profileId: next.profile?.id,
        provider: next.profile ? undefined : next.providerId,
        model: next.profile ? undefined : next.model,
      });
      credentials.setActive(profileId);
      for (const fn of labelListeners) fn(modelLabel);
    },
    async send(text) {
      abortController?.abort();
      abortController = new AbortController();
      bridge.emit({ type: "busy", busy: true });
      bridge.emit({ type: "turn", turn: userTurn(text) });
      try {
        await agent.processRequest(text, abortController.signal);
        await continueOpenTasks({ agent, store, signal: abortController.signal });
      } catch (err: any) {
        if (err?.name === "AbortError") bridge.emit({ type: "turn", turn: systemTurn("aborted") });
        else bridge.emit({ type: "error", message: err?.message ?? String(err) });
      } finally {
        bridge.emit({ type: "busy", busy: false });
        void refresh.all();
      }
    },
    abort() {
      abortController?.abort();
      void fleet.cancelAll();
    },
    async shutdown() {
      abortController?.abort();
      await fleet.stop();
    },
  };
}

function userTurn(text: string) {
  return { id: `u_${Date.now().toString(36)}`, kind: "user" as const, text, createdAt: Date.now() };
}

function systemTurn(text: string) {
  return { id: `s_${Date.now().toString(36)}`, kind: "system" as const, text, createdAt: Date.now() };
}

function resolveDisplaySlot(displayManager: Displaymanager, bridge: ReturnType<typeof getBridge>, slotId: string, value: unknown): void {
  try {
    displayManager.resolve(slotId, value);
  } catch {}
  bridge.emit({ type: "display_slot_resolved", slotId });
}
