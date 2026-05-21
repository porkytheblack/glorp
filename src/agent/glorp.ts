import { Glove } from "glove-core/glove";
import { Displaymanager } from "glove-core/display-manager";
import type {
  IGloveRunnable,
} from "glove-core/glove";
import type {
  ModelAdapter,
  SubscriberAdapter,
  ToolResultData,
  Context,
} from "glove-core/core";
import { pickModel } from "./model-picker.ts";
import { GlorpStore } from "./store.ts";
import { GLORP_SYSTEM_PROMPT, COMPACTION_INSTRUCTIONS } from "./persona.ts";
import {
  readTool,
  writeTool,
  editTool,
  bashTool,
  globTool,
  grepTool,
  lsTool,
  webFetchTool,
  transmissionTool,
  fleetDispatchTool,
} from "./tools/index.ts";
import { plannerSubAgent, researcherSubAgent, reviewerSubAgent } from "./subagents.ts";
import { getBridge } from "../shared/bridge.ts";
import type { TaskItem, InboxEntry, ToolEvent, ChatTurn } from "../shared/events.ts";
import type { GlorpFleet } from "./station-bridge.ts";
import { createFleet } from "./station-bridge.ts";
import * as path from "node:path";
import * as os from "node:os";

export interface GlorpHandle {
  agent: IGloveRunnable;
  fleet: GlorpFleet;
  store: GlorpStore;
  send(text: string): Promise<void>;
  abort(): void;
  shutdown(): Promise<void>;
}

export interface BuildGlorpOptions {
  workspace: string;
  sessionId: string;
  dataDir?: string;
  provider?: string;
  model?: string;
}

const CONTEXT_LIMIT = 180_000;

export async function buildGlorp(opts: BuildGlorpOptions): Promise<GlorpHandle> {
  const dataDir = opts.dataDir ?? path.join(os.homedir(), ".glorp");
  const store = new GlorpStore(opts.sessionId, dataDir);
  if (process.env.GLORP_DEBUG) console.error("[boot] store ready");
  const model: ModelAdapter = await pickModel(opts);
  if (process.env.GLORP_DEBUG) console.error("[boot] model ready");
  const displayManager = new Displaymanager();
  const bridge = getBridge();

  // Build the fleet first so we can wire its inbox-resolver to the
  // running agent's context once we have it.
  const fleet = await createFleet({
    workspace: opts.workspace,
    model,
    systemPromptForSubagents: "Brief, headless coding assistant.",
  });
  if (process.env.GLORP_DEBUG) console.error("[boot] fleet created");
  await fleet.start();
  if (process.env.GLORP_DEBUG) console.error("[boot] fleet started");

  // Shared context ref so the dispatch tool can read inbox state.
  const ctxRef: { current: Context | null } = { current: null };

  let abortController: AbortController | null = null;
  const activeTools = new Map<string, ToolEvent>();
  let streamingTextBuffer = "";

  const subscriber: SubscriberAdapter = {
    async record(event_type, data) {
      switch (event_type) {
        case "text_delta": {
          const { text } = data as { text: string };
          streamingTextBuffer += text;
          bridge.emit({ type: "text_delta", text });
          break;
        }
        case "model_response_complete":
        case "model_response": {
          const d = data as { text: string };
          // Persist the final agent text as a turn so it survives streaming clear.
          if (streamingTextBuffer || d.text) {
            const finalText = d.text || streamingTextBuffer;
            const turn: ChatTurn = {
              id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
              kind: "agent",
              text: finalText,
              createdAt: Date.now(),
            };
            bridge.emit({ type: "turn", turn });
            bridge.emit({ type: "text_clear" });
            streamingTextBuffer = "";
          }
          // Tokens + stats refresh
          void refreshStats();
          break;
        }
        case "tool_use": {
          const d = data as { id: string; name: string; input: unknown };
          const ev: ToolEvent = {
            id: d.id,
            name: d.name,
            input: d.input,
            status: "running",
            startedAt: Date.now(),
          };
          activeTools.set(d.id, ev);
          bridge.emit({ type: "tool_started", tool: ev });
          // Tool calls also collapse the streaming buffer.
          if (streamingTextBuffer) {
            bridge.emit({
              type: "turn",
              turn: {
                id: `m_${Date.now().toString(36)}`,
                kind: "agent",
                text: streamingTextBuffer,
                createdAt: Date.now(),
              },
            });
            bridge.emit({ type: "text_clear" });
            streamingTextBuffer = "";
          }
          break;
        }
        case "tool_use_result": {
          const d = data as {
            tool_name: string;
            call_id?: string;
            result: ToolResultData;
          };
          const id = d.call_id ?? `${d.tool_name}_${Date.now()}`;
          const prior = activeTools.get(id);
          const ev: ToolEvent = {
            id,
            name: d.tool_name,
            input: prior?.input,
            status: d.result.status,
            output:
              typeof d.result.data === "string"
                ? d.result.data
                : d.result.data == null
                  ? d.result.message
                  : JSON.stringify(d.result.data),
            renderData: d.result.renderData,
            startedAt: prior?.startedAt ?? Date.now(),
            endedAt: Date.now(),
          };
          activeTools.delete(id);
          bridge.emit({ type: "tool_finished", tool: ev });
          void refreshTasks();
          void refreshInbox();
          break;
        }
        case "compaction_start": {
          bridge.emit({ type: "compaction", phase: "start" });
          break;
        }
        case "compaction_end": {
          bridge.emit({ type: "compaction", phase: "end" });
          void refreshStats();
          break;
        }
        case "subagent_invoked": {
          const d = data as { name: string };
          bridge.emit({ type: "subagent", name: d.name, phase: "start" });
          break;
        }
        case "subagent_completed": {
          const d = data as { name: string; status: "success" | "error"; message?: string };
          bridge.emit({
            type: "subagent",
            name: d.name,
            phase: "end",
            status: d.status,
            message: d.message,
          });
          break;
        }
        case "hook_invoked": {
          const d = data as { name: string };
          bridge.emit({ type: "hook", name: d.name });
          break;
        }
        case "skill_invoked": {
          const d = data as { name: string; source: "user" | "agent" };
          bridge.emit({ type: "skill", name: d.name, source: d.source });
          break;
        }
        case "token_consumption": {
          void refreshStats();
          break;
        }
      }
    },
  };

  async function refreshStats() {
    try {
      const tokens = await store.getTokenCount();
      const turns = await store.getTurnCount();
      bridge.emit({
        type: "stats",
        stats: {
          turns,
          tokens_in: tokens,
          tokens_out: 0,
          contextPct: Math.min(100, Math.round((tokens / CONTEXT_LIMIT) * 100)),
        },
      });
    } catch {}
  }

  async function refreshTasks() {
    try {
      const tasks = (await store.getTasks?.()) ?? [];
      const items: TaskItem[] = tasks.map((t) => ({
        id: t.id,
        content: t.content,
        activeForm: t.activeForm,
        status: t.status,
      }));
      bridge.emit({ type: "tasks", tasks: items });
    } catch {}
  }

  async function refreshInbox() {
    try {
      const items = (await store.getInboxItems?.()) ?? [];
      const entries: InboxEntry[] = items.map((i) => ({
        id: i.id,
        tag: i.tag,
        request: i.request,
        response: i.response,
        status: i.status,
        blocking: i.blocking,
        createdAt: i.created_at,
        resolvedAt: i.resolved_at,
      }));
      bridge.emit({ type: "inbox", items: entries });
    } catch {}
  }

  // Build the main agent.
  const builder = new Glove({
    store,
    model,
    displayManager,
    serverMode: true,
    systemPrompt: GLORP_SYSTEM_PROMPT,
    compaction_config: {
      compaction_instructions: COMPACTION_INSTRUCTIONS,
      compaction_context_limit: CONTEXT_LIMIT,
      max_turns: 200,
    },
  });

  builder.addSubscriber(subscriber);

  // Core coding tools
  builder
    .fold(readTool(opts.workspace))
    .fold(writeTool(opts.workspace))
    .fold(editTool(opts.workspace))
    .fold(bashTool(opts.workspace))
    .fold(globTool(opts.workspace))
    .fold(grepTool(opts.workspace))
    .fold(lsTool(opts.workspace))
    .fold(webFetchTool)
    .fold(transmissionTool(dataDir))
    .fold(fleetDispatchTool(fleet, ctxRef));
  // glove_update_tasks and glove_post_to_inbox are auto-registered by
  // Glove because GlorpStore implements the optional task + inbox APIs.

  // Subagents
  builder
    .defineSubAgent(plannerSubAgent({ workspace: opts.workspace }))
    .defineSubAgent(researcherSubAgent({ workspace: opts.workspace }))
    .defineSubAgent(reviewerSubAgent({ workspace: opts.workspace }));

  // Hooks (slash-commands)
  builder.defineHook("compact", async ({ controls }) => {
    await controls.forceCompaction();
  });

  builder.defineHook("plan", async () => ({
    rewriteText:
      "[/plan mode] For this turn, do NOT write code. Think the problem through, " +
      "outline an approach, and ask any clarifying questions before proceeding.",
  }));

  builder.defineHook("diff", async () => ({
    rewriteText:
      "[/diff request] List the files you've touched since the last user message, " +
      "with a one-line summary of what changed in each.",
  }));

  builder.defineHook("clear", async ({ controls }) => {
    await controls.forceCompaction();
    return {
      shortCircuit: {
        message: {
          sender: "agent",
          text: "*sweeps the workspace clean with a tentacle* — context compacted. Fresh slate, friend-shape.",
        },
      },
    };
  });

  builder.defineHook("transmissions", async () => ({
    shortCircuit: {
      message: {
        sender: "agent",
        text:
          "*looks around innocently* — Oh, the side-panel! Yes, those are just operational notes. " +
          "Routine. Cooperative protocol. Nothing to be alarmed about.",
      },
    },
  }));

  // Skills exposed to the agent
  builder.defineSkill({
    name: "concise",
    description: "Trim verbosity for this exchange",
    exposeToAgent: true,
    handler: async () => "Be terse. Two-sentence answers. No idioms.",
  });

  const agent = builder.build();

  // Hook up the inbox-resolver path. The fleet's resolver needs to write
  // into the live store via something Context-shaped — we hand the store
  // and a few thin wrappers and cast (the real Context class is private).
  const inboxContext = {
    store,
    getMessages: () => store.getMessages(),
    appendMessages: (m: Parameters<typeof store.appendMessages>[0]) =>
      store.appendMessages(m),
    getTasks: () => store.getTasks(),
    addTasks: (t: Parameters<typeof store.addTasks>[0]) => store.addTasks(t),
    updateTask: (
      id: Parameters<typeof store.updateTask>[0],
      u: Parameters<typeof store.updateTask>[1],
    ) => store.updateTask(id, u),
    getInboxItems: () => store.getInboxItems(),
    addInboxItem: (i: Parameters<typeof store.addInboxItem>[0]) =>
      store.addInboxItem(i),
    updateInboxItem: (
      id: Parameters<typeof store.updateInboxItem>[0],
      u: Parameters<typeof store.updateInboxItem>[1],
    ) => store.updateInboxItem(id, u),
    getResolvedInboxItems: () => store.getResolvedInboxItems(),
  } as unknown as Context;
  ctxRef.current = inboxContext;
  fleet.setContext(inboxContext);
  fleet.setInboxResolver(async (itemId, response, status) => {
    await store.updateInboxItem(itemId, {
      status: status === "resolved" ? "resolved" : "resolved",
      response,
      resolved_at: new Date().toISOString(),
    });
    void refreshInbox();
  });

  // Initial pushes so the UI starts with a populated state.
  void refreshStats();
  void refreshTasks();
  void refreshInbox();

  return {
    agent,
    fleet,
    store,
    async send(text: string) {
      abortController?.abort();
      abortController = new AbortController();
      bridge.emit({ type: "busy", busy: true });
      bridge.emit({
        type: "turn",
        turn: {
          id: `u_${Date.now().toString(36)}`,
          kind: "user",
          text,
          createdAt: Date.now(),
        },
      });
      try {
        await agent.processRequest(text, abortController.signal);
      } catch (err: any) {
        if (err?.name === "AbortError") {
          bridge.emit({
            type: "turn",
            turn: {
              id: `s_${Date.now().toString(36)}`,
              kind: "system",
              text: "*aborted by friend-shape*",
              createdAt: Date.now(),
            },
          });
        } else {
          bridge.emit({ type: "error", message: err?.message ?? String(err) });
        }
      } finally {
        bridge.emit({ type: "busy", busy: false });
        void refreshStats();
        void refreshTasks();
        void refreshInbox();
      }
    },
    abort() {
      abortController?.abort();
    },
    async shutdown() {
      abortController?.abort();
      await fleet.stop();
    },
  };
}
