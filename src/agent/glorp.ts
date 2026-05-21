import { Glove } from "glove-core/glove";
import { Displaymanager } from "glove-core/display-manager";
import type {
  IGloveRunnable,
  GloveFoldArgs,
} from "glove-core/glove";
import type {
  ModelAdapter,
  SubscriberAdapter,
  ToolResultData,
  Tool,
  Context,
} from "glove-core/core";
import { createTaskTool } from "glove-core/tools/task-tool";
import { createInboxTool } from "glove-core/tools/inbox-tool";
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
  askConfirmTool,
  showInfoTool,
  askChoiceTool,
  askTextTool,
} from "./tools/index.ts";
import { plannerSubAgent, researcherSubAgent, reviewerSubAgent } from "./subagents.ts";
import { getBridge } from "../shared/bridge.ts";
import type { TaskItem, InboxEntry, ToolEvent, ChatTurn } from "../shared/events.ts";
import type { GlorpFleet } from "./station-bridge.ts";
import { createFleet } from "./station-bridge.ts";
import { CredentialsStore } from "./credentials.ts";
import * as path from "node:path";
import * as os from "node:os";

export interface GlorpHandle {
  agent: IGloveRunnable;
  fleet: GlorpFleet;
  store: GlorpStore;
  credentials: CredentialsStore;
  /** Active session ID (drives the file path under sessions/). */
  sessionId: string;
  /** Human-readable label for the active model (e.g. "anthropic · sonnet"). */
  modelLabel: string;
  send(text: string): Promise<void>;
  abort(): void;
  shutdown(): Promise<void>;
  /**
   * Hot-swap the active model to the given profile. Updates the agent's
   * adapter, persists it as active in the credentials store, and pushes a
   * fresh status event for the UI.
   */
  swapProfile(profileId: string): Promise<void>;
  /** Resolve any pending display-stack slot with the given value. */
  resolveSlot(slotId: string, value: unknown): void;
  /** Reject any pending display-stack slot with an optional reason. */
  rejectSlot(slotId: string, reason?: string): void;
  /** Convenience: resolve a permission-request slot (true = allow, false = deny). */
  resolvePermission(slotId: string, allow: boolean): void;
  /**
   * Force-clear a stored permission (so the next call re-prompts). Used by
   * the permissions-list overlay to revoke previously granted/denied tools.
   */
  clearPermission(toolName: string): Promise<void>;
  /** Subscribe to model-label changes (for the status bar). */
  onLabelChange(fn: (label: string) => void): () => void;
}

export interface BuildGlorpOptions {
  workspace: string;
  sessionId: string;
  dataDir?: string;
  /** CLI-supplied provider override — takes precedence over credentials. */
  provider?: string;
  /** CLI-supplied model override. */
  model?: string;
  /** Inject a pre-built credentials store (useful for tests). */
  credentials?: CredentialsStore;
}

const CONTEXT_LIMIT = 180_000;

/**
 * Convert a raw `Tool<I>` (from glove-core's factory exports — `createTaskTool`,
 * `createInboxTool`, etc.) into a `GloveFoldArgs<I>` the builder accepts.
 * The two shapes have the same fields with different names (`run` → `do`,
 * `input_schema` → `inputSchema`).
 */
function toolToFoldArgs<I>(tool: Tool<I>): GloveFoldArgs<I> {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.input_schema,
    jsonSchema: tool.jsonSchema,
    requiresPermission: tool.requiresPermission,
    unAbortable: tool.unAbortable,
    do: (input, _display, _glove, signal) => tool.run(input, undefined, signal),
  };
}

export async function buildGlorp(opts: BuildGlorpOptions): Promise<GlorpHandle> {
  const dataDir = opts.dataDir ?? path.join(os.homedir(), ".glorp");
  const store = new GlorpStore(opts.sessionId, dataDir);
  if (process.env.GLORP_DEBUG) console.error("[boot] store ready");
  const credentials = opts.credentials ?? new CredentialsStore(dataDir);
  const picked = await pickModel({
    provider: opts.provider,
    model: opts.model,
    credentials,
  });
  let model: ModelAdapter = picked.adapter;
  let modelLabel = picked.label;
  if (process.env.GLORP_DEBUG) console.error("[boot] model ready:", modelLabel);
  const displayManager = new Displaymanager();
  const bridge = getBridge();
  const labelListeners = new Set<(label: string) => void>();

  // Bridge ALL display-stack pushes into bridge events so the React TUI
  // can render any custom modal — not just permission prompts. Glove's
  // executor pushes `permission_request` slots automatically; the agent
  // (or any tool) can push other renderers via `pushAndWait` to collect
  // input or show information.
  const seenSlots = new Set<string>();
  displayManager.subscribe(async (stack) => {
    for (const slot of stack) {
      if (seenSlots.has(slot.id)) continue;
      seenSlots.add(slot.id);
      bridge.emit({
        type: "display_slot_pushed",
        slot: {
          slotId: slot.id,
          renderer: slot.renderer,
          input: slot.input,
          createdAt: Date.now(),
          isPermissionRequest: slot.renderer === "permission_request",
        },
      });
    }
    // Drop ids of slots no longer in the stack so a re-pushed slot id
    // (after `resolve`) gets re-announced if Glove repeats the prompt.
    const live = new Set(stack.map((s) => s.id));
    for (const id of seenSlots) if (!live.has(id)) seenSlots.delete(id);
  });

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
  let unkIdCounter = 0;
  const synthesizeId = () => `_unk_${++unkIdCounter}`;

  const subscriber: SubscriberAdapter = {
    async record(event_type, data) {
      switch (event_type) {
        case "text_delta": {
          const { text } = data as { text: string };
          streamingTextBuffer += text;
          bridge.emit({ type: "text_delta", text });
          break;
        }
        case "model_response_complete": {
          // Final assistant text from streaming adapters. We prefer this over
          // `model_response` (sync adapters) — emitting both would persist
          // duplicate turns. Streaming adapters emit only `_complete`; sync
          // adapters emit only `model_response`. Handling them separately
          // keeps both paths clean.
          const d = data as { text: string };
          if (streamingTextBuffer || d.text) {
            const finalText = d.text || streamingTextBuffer;
            // Clear the streaming row BEFORE appending the final turn so
            // the UI doesn't briefly render both at once.
            bridge.emit({ type: "text_clear" });
            streamingTextBuffer = "";
            bridge.emit({
              type: "turn",
              turn: {
                id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
                kind: "agent",
                text: finalText,
                createdAt: Date.now(),
              },
            });
          }
          void refreshStats();
          break;
        }
        case "model_response": {
          // Sync (non-streaming) adapter only — emit if streaming buffer is empty.
          const d = data as { text: string };
          if (!streamingTextBuffer && d.text) {
            bridge.emit({
              type: "turn",
              turn: {
                id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
                kind: "agent",
                text: d.text,
                createdAt: Date.now(),
              },
            });
          }
          void refreshStats();
          break;
        }
        case "tool_use": {
          const d = data as { id: string; name: string; input: unknown };
          // Collapse the streaming buffer first so a tool card never appears
          // mid-stream alongside still-rendering text.
          if (streamingTextBuffer) {
            bridge.emit({ type: "text_clear" });
            bridge.emit({
              type: "turn",
              turn: {
                id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
                kind: "agent",
                text: streamingTextBuffer,
                createdAt: Date.now(),
              },
            });
            streamingTextBuffer = "";
          }
          const ev: ToolEvent = {
            id: d.id,
            name: d.name,
            input: d.input,
            status: "running",
            startedAt: Date.now(),
          };
          activeTools.set(d.id, ev);
          bridge.emit({ type: "tool_started", tool: ev });
          break;
        }
        case "tool_use_result": {
          const d = data as {
            tool_name: string;
            call_id?: string;
            result: ToolResultData;
          };
          // If call_id is missing, look up the most recent active tool by
          // name rather than synthesising a fresh id (which would strand
          // the matching `tool_use` event).
          let id = d.call_id;
          if (!id) {
            for (const [k, v] of activeTools) {
              if (v.name === d.tool_name) id = k;
            }
            if (!id) id = synthesizeId();
          }
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
    .fold(fleetDispatchTool(fleet, ctxRef))
    // Modal-style tools — the agent pushes a slot onto the displayManager
    // and the React UI picks up the matching renderer from the slot
    // registry. Block-on-user-input semantics for the first three; the
    // info tool blocks until the user dismisses.
    .fold(askConfirmTool)
    .fold(showInfoTool)
    .fold(askChoiceTool)
    .fold(askTextTool);
  // glove_update_tasks / glove_post_to_inbox aren't auto-registered by
  // Glove — they're factories the caller must fold. We do that below
  // once the Context is built (they need it).

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
  // Fold the task + inbox tools now that the Context exists. createTaskTool /
  // createInboxTool return raw `Tool<I>` objects; convert to GloveFoldArgs
  // (different field names: `input_schema` → `inputSchema`, `run` → `do`).
  agent.fold(toolToFoldArgs(createTaskTool(inboxContext)));
  agent.fold(toolToFoldArgs(createInboxTool(inboxContext)));
  fleet.setInboxResolver(async (itemId, response, status) => {
    // Inbox status enum is "pending" | "resolved" | "consumed". Fleet
    // failures are still "resolved" from the inbox's perspective — the
    // failure text lives in the response payload, prefixed so the agent
    // and UI can see it.
    const payload = status === "error" ? `[fleet error] ${response}` : response;
    await store.updateInboxItem(itemId, {
      status: "resolved",
      response: payload,
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
    credentials,
    sessionId: opts.sessionId,
    get modelLabel() {
      return modelLabel;
    },
    onLabelChange(fn) {
      labelListeners.add(fn);
      return () => {
        labelListeners.delete(fn);
      };
    },
    resolveSlot(slotId: string, value: unknown) {
      try {
        displayManager.resolve(slotId, value);
      } catch {
        // The slot may have already been resolved (e.g. duplicate click);
        // silently ignore.
      }
      bridge.emit({ type: "display_slot_resolved", slotId });
    },
    rejectSlot(slotId: string, reason?: string) {
      try {
        displayManager.reject(slotId, reason);
      } catch {}
      bridge.emit({ type: "display_slot_resolved", slotId });
    },
    resolvePermission(slotId: string, allow: boolean) {
      try {
        displayManager.resolve(slotId, allow);
      } catch {}
      bridge.emit({ type: "display_slot_resolved", slotId });
    },
    async clearPermission(toolName: string) {
      await store.setPermission(toolName, "unset");
    },
    async swapProfile(profileId: string) {
      const next = await pickModel({ profileId, credentials });
      // Hot-swap is only safe when no request is in flight; abort any
      // pending one first so the new model owns the next prompt.
      abortController?.abort();
      agent.setModel(next.adapter);
      model = next.adapter;
      modelLabel = next.label;
      credentials.setActive(profileId);
      for (const fn of labelListeners) {
        try {
          fn(modelLabel);
        } catch {}
      }
    },
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
