import * as path from "node:path";
import * as os from "node:os";
import { Glove } from "glove-core/glove";
import { Displaymanager } from "glove-core/display-manager";
import type { Context, ModelAdapter } from "glove-core/core";
import { createTaskTool } from "glove-core/tools/task-tool";
import { createInboxTool } from "glove-core/tools/inbox-tool";
import { pickModel } from "../model-picker.ts";
import { GlorpStore } from "../store.ts";
import { CredentialsStore } from "../credentials.ts";
import { getBridge } from "../../shared/bridge.ts";
import { loadPrompt } from "../prompts.ts";
import { createFleet } from "../fleet/index.ts";
import { discoverExtensions } from "../skills/loader.ts";
import { registerSkills } from "../skills/registration.ts";
import { buildSkillIndex, renderSkillIndex, skillIndexBudget } from "../skills/budget.ts";
import { buildBuiltInSubAgents, buildDiskSubAgent } from "../agents/index.ts";
import { MAIN_AGENT_TOOLS, registerTools } from "../tools/registry.ts";
import { wrapGlorpModel } from "./wrappers.ts";
import { createSubscriber, createSubscriberState } from "./subscriber.ts";
import { makeRefresh } from "./refresh.ts";
import { wireDisplayStack } from "./display-stack.ts";
import { defineGlorpHooks } from "./hooks.ts";
import { buildCatalogue } from "./extensions.ts";
import { makeInboxContext } from "./inbox-context.ts";
import { toolToFoldArgs, taskToolToFoldArgs } from "./tool-conversion.ts";
import { inboxManageTool } from "../tools/inbox-manage.ts";
import { runSession } from "./session.ts";
import { CONTEXT_LIMIT, type BuildGlorpOptions, type GlorpHandle } from "./types.ts";

/**
 * Top-level builder. Mounts the persisted store, picks a model, wires the
 * display stack and subscriber into the bridge, registers tools/hooks/
 * skills/subagents, and returns a `GlorpHandle` the CLI mounts on the
 * React TUI.
 */
export async function buildGlorp(opts: BuildGlorpOptions): Promise<GlorpHandle> {
  const dataDir = opts.dataDir ?? path.join(os.homedir(), ".glorp");
  const store = new GlorpStore(opts.sessionId, dataDir);
  const credentials = opts.credentials ?? new CredentialsStore(dataDir);
  const picked = await pickModel({ provider: opts.provider, model: opts.model, credentials });
  let model = wrapGlorpModel(picked.adapter);
  let modelLabel = picked.label;
  const displayManager = new Displaymanager();
  const bridge = getBridge();
  const labelListeners = new Set<(label: string) => void>();
  wireDisplayStack(displayManager, bridge);

  const fleet = createFleet({ workspace: opts.workspace, dataDir, provider: opts.provider, model: opts.model });
  fleet.subscribe({
    onStart: (handle) => bridge.emit({
      type: "fleet_job",
      job: { jobId: handle.jobId, kind: handle.kind, itemId: handle.itemId, tag: handle.tag, name: handle.name, startedAt: handle.startedAt, status: "running" },
    }),
    onFinish: (handle, result) => bridge.emit({
      type: "fleet_job",
      job: {
        jobId: handle.jobId, kind: handle.kind, itemId: handle.itemId, tag: handle.tag, name: handle.name,
        startedAt: handle.startedAt, endedAt: result.endedAt,
        status: result.ok ? "success" : "error",
      },
    }),
  });
  await fleet.start();

  const ctxRef: { current: Context | null } = { current: null };
  const state = createSubscriberState();
  const refresh = makeRefresh(store, bridge);
  const subscriber = createSubscriber(state, bridge, refresh);

  const diskExt = discoverExtensions(opts.workspace);
  if (process.env.GLORP_DEBUG) {
    console.error(`[boot] disk extensions: ${diskExt.skills.length} skills, ${diskExt.subagents.length} subagents`);
  }
  const indexEntries = buildSkillIndex(diskExt.skills, skillIndexBudget(CONTEXT_LIMIT));
  const indexText = renderSkillIndex(indexEntries);
  const systemPrompt = indexText ? `${loadPrompt("main")}\n\n${indexText}` : loadPrompt("main");

  const builder = new Glove({
    store,
    model,
    displayManager,
    serverMode: true,
    systemPrompt,
    compaction_config: {
      compaction_instructions: loadPrompt("compaction"),
      compaction_context_limit: CONTEXT_LIMIT,
      max_turns: 200,
    },
    enableToolResultSummary: true,
  });
  builder.addSubscriber(subscriber);
  registerTools(builder, MAIN_AGENT_TOOLS, { workspace: opts.workspace, dataDir, fleet, contextRef: ctxRef });
  defineGlorpHooks(builder);
  for (const def of buildBuiltInSubAgents({ workspace: opts.workspace, dataDir })) {
    builder.defineSubAgent(def);
  }
  for (const sub of diskExt.subagents) {
    builder.defineSubAgent(buildDiskSubAgent(sub, opts.workspace, dataDir));
  }

  const agent = builder.build();
  registerSkills(agent, diskExt.skills, CONTEXT_LIMIT);

  const inboxContext = makeInboxContext(store);
  ctxRef.current = inboxContext;
  fleet.setContext(inboxContext);
  agent.fold(taskToolToFoldArgs(createTaskTool(inboxContext)));
  agent.fold(toolToFoldArgs(createInboxTool(inboxContext)));
  agent.fold(inboxManageTool(inboxContext));
  fleet.setInboxResolver(async (itemId, response, status) => {
    const payload = status === "error" ? `[fleet error] ${response}` : response;
    await store.updateInboxItem(itemId, {
      status: "resolved",
      response: payload,
      resolved_at: new Date().toISOString(),
    });
    void refresh.refreshInbox();
  });

  void refresh.refreshStats();
  void refresh.refreshTasks();
  void refresh.refreshInbox();

  return runSession({
    agent,
    fleet,
    store,
    credentials,
    bridge,
    catalogue: buildCatalogue(agent),
    displayManager,
    labelListeners,
    sessionId: opts.sessionId,
    state,
    refresh,
    initialModel: model,
    initialLabel: modelLabel,
    swapModel(next: ModelAdapter, label: string) {
      model = next;
      modelLabel = label;
    },
  });
}
