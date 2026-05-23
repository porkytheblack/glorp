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
  Message,
  ModelPromptResult,
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
  inboxManageTool,
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
import { discoverExtensions } from "./extensions-loader.ts";
import type { LoadedSkill, LoadedSubagent } from "./extensions-loader.ts";
import { MemoryStore as ShimMemoryStore } from "./memory-store-shim.ts";
import * as path from "node:path";
import * as os from "node:os";

const TASK_UPDATE_TOOL_NAME = "glove_update_tasks";
const TASK_UPDATE_CONTINUATION_NOTE =
  "Task list updated. Task updates are bookkeeping only: if any task is still pending or in_progress, continue immediately with the next concrete tool call. Do not stop after this tool with intent-only text.";
const TASK_UPDATE_CONTINUATION_PROMPT =
  "[internal continuation] You just updated the task list and at least one task is still pending or in_progress. Continue now with the next concrete tool call or, if genuinely blocked, state the blocker. Do not stop with intent-only text.";

/** Extension catalogue the input bar uses to drive autocomplete + hints. */
export interface ExtensionCatalogue {
  /** `/name description` entries — hooks + user-invokable skills. */
  slash: Array<{ name: string; description: string }>;
  /** `$name description` entries — user-invokable skills. */
  skills: Array<{ name: string; description: string }>;
  /** `@name description` entries — registered subagents. */
  mentions: Array<{ name: string; description: string }>;
}

export interface GlorpHandle {
  agent: IGloveRunnable;
  fleet: GlorpFleet;
  store: GlorpStore;
  credentials: CredentialsStore;
  /** Active session ID (drives the file path under sessions/). */
  sessionId: string;
  /** Human-readable label for the active model (e.g. "anthropic · sonnet"). */
  modelLabel: string;
  /** Persisted short title for this chat, generated from the conversation. */
  title: string | null;
  /** Slash commands + @subagents the UI should hint when the user types `/` or `@`. */
  extensions: ExtensionCatalogue;
  hydrateUi(): Promise<void>;
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
const MAX_SKILL_PAYLOAD_CHARS = 12_000;
const MAX_SKILL_INDEX_HEADINGS = 80;
const TITLE_MODEL_TIMEOUT_MS = 15_000;
const TITLE_MAX_MESSAGES = 10;
const TITLE_MAX_CHARS_PER_MESSAGE = 700;

/**
 * Human-readable descriptions for the hooks we register. Used by the
 * autocomplete menu so a user typing `/com` sees "force a context
 * compaction now" next to the suggestion.
 */
const HOOK_DESCRIPTIONS: Record<string, string> = {
  plan: "switch to plan-first mode for this turn",
  diff: "list files changed since last user message",
  compact: "force a context compaction now",
  clear: "compact and reset the working slate",
  transmissions: "ask about the homeworld-comms panel",
};

/**
 * Build a DefineSubAgentArgs from a disk-loaded subagent file. The
 * body becomes the system prompt; the front-matter `tools:` field
 * narrows the tool set (default: read/grep/glob/ls/web_fetch — read-
 * only, like the built-in planner). Inherits the parent's model and
 * displayManager.
 */
function makeDiskSubAgent(sub: LoadedSubagent, workspace: string) {
  // Tools the subagent can use. Read-only defaults for safety; the
  // user opts into mutation by listing tools explicitly in front-matter.
  const ALL_TOOLS = {
    read: () => readTool(workspace),
    write: () => writeTool(workspace),
    edit: () => editTool(workspace),
    bash: () => bashTool(workspace),
    glob: () => globTool(workspace),
    grep: () => grepTool(workspace),
    ls: () => lsTool(workspace),
    web_fetch: () => webFetchTool,
  } as const;
  const DEFAULT_TOOLS = ["read", "grep", "glob", "ls", "web_fetch"] as const;
  const requested =
    sub.toolAllowlist && sub.toolAllowlist.length > 0
      ? sub.toolAllowlist
      : (DEFAULT_TOOLS as readonly string[]);

  return {
    name: sub.name,
    description: sub.description,
    factory: async ({ parentStore, parentControls }: {
      parentStore: import("glove-core/core").StoreAdapter;
      parentControls: { glove: { model: ModelAdapter }; displayManager: import("glove-core/display-manager").DisplayManagerAdapter };
    }) => {
      const subStore =
        (await parentStore.createSubAgentStore?.(sub.name, false)) ??
        new ShimMemoryStore(`${sub.name}_${Date.now()}`);
      const child = new Glove({
        store: subStore,
        model: parentControls.glove.model,
        displayManager: parentControls.displayManager,
        serverMode: true,
        systemPrompt: sub.systemPrompt,
        compaction_config: {
          compaction_instructions: "Summarise progress on the assigned task; drop chatter.",
          max_turns: 12,
        },
        enableToolResultSummary: true,
      });
      for (const toolName of requested) {
        const factory = (ALL_TOOLS as Record<string, undefined | (() => GloveFoldArgs<any>)>)[toolName];
        if (factory) child.fold(factory());
      }
      return child.build();
    },
  };
}

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
    generateToolSummary: tool.generateSummary,
  };
}

function taskToolToFoldArgs<I>(tool: Tool<I>): GloveFoldArgs<I> {
  const folded = toolToFoldArgs(tool);
  return {
    ...folded,
    description: `${tool.description}\n\nImportant: ${TASK_UPDATE_CONTINUATION_NOTE}`,
    async do(input, _display, _glove, signal) {
      const result = await tool.run(input, undefined, signal);
      if (result.status !== "success") return result;
      const data = result.data;
      if (data && typeof data === "object" && !Array.isArray(data)) {
        return {
          ...result,
          data: {
            ...data,
            _agentInstruction: TASK_UPDATE_CONTINUATION_NOTE,
          },
        };
      }
      return {
        ...result,
        data: {
          value: data,
          _agentInstruction: TASK_UPDATE_CONTINUATION_NOTE,
        },
      };
    },
  };
}

function skillPayload(skill: LoadedSkill): string {
  const refsHint = skill.referencePaths.length
    ? `\n\n---\nReference files in this skill (read only the file you need):\n${skill.referencePaths.map((p) => `  ${p}`).join("\n")}`
    : "";
  if (skill.body.length <= MAX_SKILL_PAYLOAD_CHARS) {
    return `${skill.body}${refsHint}`;
  }
  return (
    `${skill.body.slice(0, MAX_SKILL_PAYLOAD_CHARS)}\n\n` +
    `---\n[Skill body truncated from ${skill.body.length} to ${MAX_SKILL_PAYLOAD_CHARS} characters to preserve context. ` +
    `Source: ${skill.sourcePath}. Use grep to find terms or read with the line offsets below for specific sections.]\n\n` +
    skillHeadingIndex(skill.body, skill.sourcePath) +
    refsHint
  );
}

function skillHeadingIndex(body: string, sourcePath: string): string {
  const lines = body.split("\n");
  const headings: Array<{ line: number; level: number; title: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^(#{1,4})\s+(.+?)\s*$/.exec(lines[i]!);
    if (!match) continue;
    headings.push({
      line: i + 1,
      level: match[1]!.length,
      title: match[2]!.replace(/\s+/g, " ").trim(),
    });
    if (headings.length >= MAX_SKILL_INDEX_HEADINGS) break;
  }
  if (headings.length === 0) {
    return `Heading index unavailable. Read targeted ranges from ${sourcePath}.\n`;
  }
  const rows = headings.map((h) => {
    const indent = "  ".repeat(Math.max(0, h.level - 1));
    return `- line ${h.line}: ${indent}${h.title}`;
  });
  const more =
    headings.length >= MAX_SKILL_INDEX_HEADINGS
      ? `\n- ... heading index capped at ${MAX_SKILL_INDEX_HEADINGS}; use grep for later sections.`
      : "";
  return `Heading index for omitted sections in ${sourcePath}:\n${rows.join("\n")}${more}\n`;
}

function visibleMessageText(message: Message): string {
  const text = message.pre_modified_text ?? message.text ?? "";
  if (text.trim()) return text;
  const parts = message.content ?? [];
  return parts
    .map((part) => {
      if (part.type === "text") return part.text ?? "";
      return `[${part.type} attachment]`;
    })
    .filter(Boolean)
    .join("\n");
}

function isVisibleTranscriptMessage(message: Message): boolean {
  if (message.is_compaction || message.is_compaction_request || message.is_skill_injection) return false;
  if (message.tool_results?.length) return false;
  const text = visibleMessageText(message).trim();
  if (!text) return false;
  return true;
}

function hasVisibleAgentOutput(message: Message): boolean {
  if (message.sender !== "agent") return false;
  if ((message.tool_calls?.length ?? 0) > 0) return true;
  return visibleMessageText(message).trim().length > 0;
}

export function modelResultHasVisibleAgentOutput(result: ModelPromptResult | Message): boolean {
  const messages = "messages" in result ? result.messages : [result];
  return messages.some(hasVisibleAgentOutput);
}

export function modelResultHasToolCall(result: ModelPromptResult | Message): boolean {
  const messages = "messages" in result ? result.messages : [result];
  return messages.some((message) => (message.tool_calls?.length ?? 0) > 0);
}

function isIntentOnlyText(text: string): boolean {
  const normalized = text
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!normalized) return false;

  const verbs =
    "(?:start|begin|check|inspect|look|read|open|review|edit|update|patch|fix|run|test|verify|investigate|continue|proceed|work|implement|make|add|wire|trace|debug|rewrite|write|create|generate|build|validate|resolve)";
  const gerunds =
    "(?:checking|inspecting|reading|opening|reviewing|editing|updating|patching|fixing|running|testing|verifying|investigating|continuing|proceeding|implementing|adding|wiring|tracing|debugging|rewriting|writing|creating|generating|building|validating|resolving)";
  return [
    new RegExp(`\\bi'll\\s+${verbs}\\b`),
    new RegExp(`\\bi will\\s+${verbs}\\b`),
    new RegExp(`\\bi'm going to\\s+${verbs}\\b`),
    new RegExp(`\\bi can\\s+${verbs}\\b`),
    new RegExp(`\\blet me\\s+${verbs}\\b`),
    new RegExp(`\\bnext,?\\s+i(?:'ll| will)\\s+${verbs}\\b`),
    new RegExp(`\\bnow\\s+i(?:'ll| will)\\s+${verbs}\\b`),
    new RegExp(`^${gerunds}\\b`),
    new RegExp(`\\b${gerunds}\\s+(?:now|next|the|this|with|using)\\b`),
  ].some((pattern) => pattern.test(normalized));
}

export function modelResultIsIntentOnly(result: ModelPromptResult | Message): boolean {
  if (modelResultHasToolCall(result)) return false;
  const messages = "messages" in result ? result.messages : [result];
  const agentTexts = messages
    .filter((message) => message.sender === "agent")
    .map((message) => visibleMessageText(message).trim())
    .filter(Boolean);
  if (agentTexts.length === 0) return false;
  return agentTexts.every(isIntentOnlyText);
}

const EMPTY_RESPONSE_RETRY_PROMPT =
  "[internal retry] Your previous completion produced no visible answer or tool call. " +
  "Answer the user's latest request now. Keep any reasoning internal and produce visible text or a tool call.";
const INTENT_ONLY_CONTINUATION_PROMPT =
  "[internal continuation] Your previous completion only stated an intention to continue, but made no tool call. " +
  "Continue now with the concrete next tool call. If you said a pending blocking inbox item is irrelevant or obsolete, " +
  "first call glove_update_inbox with item_ids when you know them, or tags when you only know the visible tag. If genuinely blocked, state the blocker clearly.";

export function withEmptyResponseRetry(model: ModelAdapter): ModelAdapter {
  return {
    get name() {
      return model.name;
    },
    setSystemPrompt(systemPrompt: string) {
      model.setSystemPrompt(systemPrompt);
    },
    async prompt(request, notify, signal) {
      const first = await model.prompt(request, notify, signal);
      if (signal?.aborted || modelResultHasVisibleAgentOutput(first)) {
        return first;
      }
      return model.prompt(
        {
          ...request,
          messages: [
            ...request.messages,
            {
              sender: "user",
              text: EMPTY_RESPONSE_RETRY_PROMPT,
            },
          ],
        },
        notify,
        signal,
      );
    },
  };
}

export function withIntentOnlyContinuation(model: ModelAdapter): ModelAdapter {
  return {
    get name() {
      return model.name;
    },
    setSystemPrompt(systemPrompt: string) {
      model.setSystemPrompt(systemPrompt);
    },
    async prompt(request, notify, signal) {
      const bufferedEvents: Array<{ eventType: string; data: unknown }> = [];
      const bufferedNotify: SubscriberAdapter["record"] = async (eventType, data) => {
        bufferedEvents.push({ eventType: eventType as string, data });
      };

      const first = await model.prompt(request, bufferedNotify, signal);
      if (signal?.aborted || !modelResultIsIntentOnly(first)) {
        await replayBufferedEvents(notify, bufferedEvents);
        return first;
      }

      return model.prompt(
        {
          ...request,
          messages: [
            ...request.messages,
            {
              sender: "user",
              text: INTENT_ONLY_CONTINUATION_PROMPT,
              is_skill_injection: true,
            },
          ],
        },
        notify,
        signal,
      );
    },
  };
}

function hasOpenTasks(data: unknown): boolean {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const tasks = (data as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return false;
  return tasks.some((task) => {
    if (!task || typeof task !== "object") return false;
    return (task as { status?: unknown }).status !== "completed";
  });
}

export function messageHasOpenTaskUpdate(message: Message | undefined): boolean {
  return (message?.tool_results ?? []).some((toolResult) => {
    if (toolResult.tool_name.toLowerCase() !== TASK_UPDATE_TOOL_NAME) return false;
    if (toolResult.result.status !== "success") return false;
    return hasOpenTasks(toolResult.result.data);
  });
}

async function replayBufferedEvents(
  notify: SubscriberAdapter["record"],
  events: Array<{ eventType: string; data: unknown }>,
) {
  for (const event of events) {
    await notify(event.eventType as any, event.data as any);
  }
}

export function withTaskUpdateContinuation(model: ModelAdapter): ModelAdapter {
  return {
    get name() {
      return model.name;
    },
    setSystemPrompt(systemPrompt: string) {
      model.setSystemPrompt(systemPrompt);
    },
    async prompt(request, notify, signal) {
      if (!messageHasOpenTaskUpdate(request.messages.at(-1))) {
        return model.prompt(request, notify, signal);
      }

      const bufferedEvents: Array<{ eventType: string; data: unknown }> = [];
      const bufferedNotify: SubscriberAdapter["record"] = async (eventType, data) => {
        bufferedEvents.push({ eventType: eventType as string, data });
      };

      const first = await model.prompt(request, bufferedNotify, signal);
      if (signal?.aborted || modelResultHasToolCall(first)) {
        await replayBufferedEvents(notify, bufferedEvents);
        return first;
      }

      return model.prompt(
        {
          ...request,
          messages: [
            ...request.messages,
            {
              sender: "user",
              text: TASK_UPDATE_CONTINUATION_PROMPT,
              is_skill_injection: true,
            },
          ],
        },
        notify,
        signal,
      );
    },
  };
}

function wrapGlorpModel(model: ModelAdapter): ModelAdapter {
  return withIntentOnlyContinuation(withTaskUpdateContinuation(withEmptyResponseRetry(model)));
}

function messagesToChatTurns(sessionId: string, messages: Message[]): ChatTurn[] {
  const visible = messages.filter(isVisibleTranscriptMessage);
  const now = Date.now();
  return visible.map((message, index) => ({
    id: message.id ?? `h_${sessionId}_${index}`,
    kind: message.sender === "user" ? "user" : "agent",
    text: visibleMessageText(message),
    createdAt: now - (visible.length - index),
  }));
}

function truncateForTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= TITLE_MAX_CHARS_PER_MESSAGE
    ? clean
    : `${clean.slice(0, TITLE_MAX_CHARS_PER_MESSAGE - 1)}...`;
}

export function cleanSessionTitle(raw: string): string | null {
  let title = raw
    .replace(/\r/g, "\n")
    .split("\n")
    .find((line) => line.trim()) ?? "";
  title = title
    .replace(/^title\s*:\s*/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) return null;
  if (title.length > 60) title = title.slice(0, 60).replace(/\s+\S*$/, "").trim();
  return title || null;
}

export async function generateSessionTitle(
  model: ModelAdapter,
  messages: Message[],
  signal?: AbortSignal,
): Promise<string | null> {
  const visible = messages.filter(isVisibleTranscriptMessage);
  if (!visible.some((m) => m.sender === "user")) return null;
  const transcript = visible
    .slice(0, TITLE_MAX_MESSAGES)
    .map((m) => `${m.sender === "user" ? "User" : "Assistant"}: ${truncateForTitle(visibleMessageText(m))}`)
    .join("\n");
  const result = await model.prompt(
    {
      messages: [
        {
          sender: "user",
          text:
            "Generate a concise chat title for this coding conversation.\n" +
            "Rules: return only the title, no quotes, no markdown, no trailing punctuation, 3-7 words, max 60 characters.\n\n" +
            transcript,
        },
      ],
    },
    async () => {},
    signal,
  );
  return cleanSessionTitle(result.messages.at(-1)?.text ?? "");
}

export async function buildGlorp(opts: BuildGlorpOptions): Promise<GlorpHandle> {
  const dataDir = opts.dataDir ?? path.join(os.homedir(), ".glorp");
  const store = new GlorpStore(opts.sessionId, dataDir);
  let sessionTitle = await store.getTitle();
  if (process.env.GLORP_DEBUG) console.error("[boot] store ready");
  const credentials = opts.credentials ?? new CredentialsStore(dataDir);
  const picked = await pickModel({
    provider: opts.provider,
    model: opts.model,
    credentials,
  });
  let model: ModelAdapter = wrapGlorpModel(picked.adapter);
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
  let compactionInFlight = false;
  let suppressCompactionResponse = false;
  let requestAborted = false;
  let emittedAgentTextsThisRequest = new Set<string>();
  let titleGeneration: Promise<void> | null = null;
  let titleAbortController: AbortController | null = null;
  let requestInFlight = false;
  let unkIdCounter = 0;
  const synthesizeId = () => `_unk_${++unkIdCounter}`;
  const normaliseAgentText = (text: string) => text.replace(/\s+/g, " ").trim();
  const emitAgentTurn = (text: string) => {
    const key = normaliseAgentText(text);
    if (!key || emittedAgentTextsThisRequest.has(key)) return false;
    emittedAgentTextsThisRequest.add(key);
    bridge.emit({
      type: "turn",
      turn: {
        id: `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        kind: "agent",
        text,
        createdAt: Date.now(),
      },
    });
    return true;
  };

  const subscriber: SubscriberAdapter = {
    async record(event_type, data) {
      switch (event_type) {
        case "text_delta": {
          const { text } = data as { text: string };
          if (requestAborted) break;
          if (compactionInFlight || suppressCompactionResponse) break;
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
          if (requestAborted) {
            streamingTextBuffer = "";
            bridge.emit({ type: "text_clear" });
            void refreshStats();
            break;
          }
          if (compactionInFlight || suppressCompactionResponse) {
            streamingTextBuffer = "";
            suppressCompactionResponse = false;
            bridge.emit({ type: "text_clear" });
            void refreshStats();
            break;
          }
          if (streamingTextBuffer || d.text) {
            const finalText = d.text || streamingTextBuffer;
            // Clear the streaming row BEFORE appending the final turn so
            // the UI doesn't briefly render both at once.
            bridge.emit({ type: "text_clear" });
            streamingTextBuffer = "";
            emitAgentTurn(finalText);
          }
          void refreshStats();
          break;
        }
        case "model_response": {
          // Sync (non-streaming) adapter only — emit if streaming buffer is empty.
          const d = data as { text: string };
          if (requestAborted) {
            void refreshStats();
            break;
          }
          if (compactionInFlight || suppressCompactionResponse) {
            suppressCompactionResponse = false;
            void refreshStats();
            break;
          }
          if (!streamingTextBuffer && d.text) {
            emitAgentTurn(d.text);
          }
          void refreshStats();
          break;
        }
        case "tool_use": {
          const d = data as { id: string; name: string; input: unknown };
          if (requestAborted) break;
          // Collapse the streaming buffer first so a tool card never appears
          // mid-stream alongside still-rendering text.
          if (streamingTextBuffer) {
            bridge.emit({ type: "text_clear" });
            emitAgentTurn(streamingTextBuffer);
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
          if (requestAborted) break;
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
          compactionInFlight = true;
          suppressCompactionResponse = true;
          streamingTextBuffer = "";
          bridge.emit({ type: "text_clear" });
          bridge.emit({ type: "compaction", phase: "start" });
          break;
        }
        case "compaction_end": {
          compactionInFlight = false;
          bridge.emit({ type: "compaction", phase: "end" });
          setTimeout(() => {
            if (!compactionInFlight) suppressCompactionResponse = false;
          }, 1000);
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

  async function hydrateUi() {
    const messages = await store.getMessages();
    sessionTitle = await store.getTitle();
    bridge.emit({
      type: "hydrate",
      state: {
        turns: messagesToChatTurns(opts.sessionId, messages),
        title: sessionTitle,
      },
    });
    await refreshStats();
    await refreshTasks();
    await refreshInbox();
    scheduleTitleGeneration();
  }

  async function cancelTitleGeneration() {
    if (!titleGeneration) return;
    titleAbortController?.abort();
    try {
      await titleGeneration;
    } catch {}
  }

  function scheduleTitleGeneration() {
    if (sessionTitle || titleGeneration || requestInFlight) return;
    titleAbortController = new AbortController();
    const timeout = setTimeout(() => titleAbortController?.abort(), TITLE_MODEL_TIMEOUT_MS);
    titleGeneration = (async () => {
      try {
        const messages = await store.getMessages();
        const title = await generateSessionTitle(model, messages, titleAbortController?.signal);
        if (!title || sessionTitle) return;
        sessionTitle = title;
        await store.setTitle(title);
        bridge.emit({ type: "title", title });
      } catch {
        // Title generation is best-effort; chat should never fail because
        // a metadata call timed out or the model rejected the request.
      } finally {
        clearTimeout(timeout);
        titleAbortController = null;
        titleGeneration = null;
      }
    })();
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
    enableToolResultSummary: true,
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

  // Disk-loaded extensions (skills + user subagents). Discovery scans
  // <workspace>/.claude, <workspace>/.agents, ~/.claude, ~/.agents in
  // priority order; first-name-wins so workspace overrides home and
  // .claude overrides .agents.
  const diskExtensions = discoverExtensions(opts.workspace);
  if (process.env.GLORP_DEBUG) {
    console.error(
      `[boot] disk extensions: ${diskExtensions.skills.length} skills, ` +
        `${diskExtensions.subagents.length} subagents` +
        (diskExtensions.shadowedSkills.length || diskExtensions.shadowedSubagents.length
          ? ` (${diskExtensions.shadowedSkills.length + diskExtensions.shadowedSubagents.length} shadowed)`
          : ""),
    );
  }

  for (const skill of diskExtensions.skills) {
    const payload = skillPayload(skill);
    builder.defineSkill({
      name: skill.name,
      description: skill.description,
      exposeToAgent: true,
      handler: async () => payload,
    });
  }

  for (const sub of diskExtensions.subagents) {
    builder.defineSubAgent(makeDiskSubAgent(sub, opts.workspace));
  }

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
  agent.fold(taskToolToFoldArgs(createTaskTool(inboxContext)));
  agent.fold(toolToFoldArgs(createInboxTool(inboxContext)));
  agent.fold(inboxManageTool(inboxContext));
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

  // Build the extension catalogue the input bar's autocomplete uses.
  // Glove stores `hooks` / `skills` / `subAgents` as private Maps on the
  // built Glove instance; we read them defensively and fall back to the
  // hardcoded names we know we registered above.
  const builtAgent = agent as unknown as {
    hooks?: Map<string, unknown>;
    skills?: Map<string, { description?: string; exposeToAgent?: boolean }>;
    subAgents?: Map<string, { description?: string }>;
  };
  const hookNames = builtAgent.hooks ? Array.from(builtAgent.hooks.keys()) : [
    "compact",
    "plan",
    "diff",
    "clear",
    "transmissions",
  ];
  const skillEntries = builtAgent.skills
    ? Array.from(builtAgent.skills.entries())
    : [["concise", { description: "Trim verbosity for this exchange" }] as const];
  const subAgentEntries = builtAgent.subAgents
    ? Array.from(builtAgent.subAgents.entries())
    : ([
        ["planner", { description: "design an approach without writing code" }],
        ["researcher", { description: "investigate the codebase or web" }],
        ["reviewer", { description: "review a recent change for issues" }],
      ] as const);

  const exposedSkillHints = skillEntries
    .filter(([, s]) => (s as { exposeToAgent?: boolean })?.exposeToAgent !== false)
    .map(([name, s]) => ({
      name,
      description: (s as { description?: string })?.description ?? "skill",
    }));
  const slashHints: Array<{ name: string; description: string }> = [
    ...hookNames.map((name) => ({
      name: `/${name}`,
      description: HOOK_DESCRIPTIONS[name] ?? "hook",
    })),
    ...exposedSkillHints.map((s) => ({
      name: `/${s.name}`,
      description: s.description,
    })),
    { name: "/help", description: "show commands" },
    { name: "/quit", description: "exit glorp" },
  ];
  const skillHints = exposedSkillHints.map((s) => ({
    name: `$${s.name}`,
    description: s.description,
  }));
  const mentionHints = subAgentEntries.map(([name, s]) => ({
    name: `@${name}`,
    description: (s as { description?: string })?.description ?? "subagent",
  }));

  return {
    agent,
    fleet,
    store,
    credentials,
    sessionId: opts.sessionId,
    extensions: {
      slash: slashHints,
      skills: skillHints,
      mentions: mentionHints,
    },
    get modelLabel() {
      return modelLabel;
    },
    get title() {
      return sessionTitle;
    },
    hydrateUi,
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
      await cancelTitleGeneration();
      model = wrapGlorpModel(next.adapter);
      agent.setModel(model);
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
      await cancelTitleGeneration();
      abortController = new AbortController();
      requestAborted = false;
      requestInFlight = true;
      emittedAgentTextsThisRequest = new Set();
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
        const result = await agent.processRequest(text, abortController.signal);
        if (!requestAborted && !modelResultHasVisibleAgentOutput(result)) {
          bridge.emit({
            type: "turn",
            turn: {
              id: `s_${Date.now().toString(36)}`,
              kind: "system",
              text: "*model returned no visible response after retry*",
              createdAt: Date.now(),
            },
          });
        }
      } catch (err: any) {
        if (requestAborted) {
          return;
        }
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
        requestInFlight = false;
        bridge.emit({ type: "busy", busy: false });
        void refreshStats();
        void refreshTasks();
        void refreshInbox();
        if (!requestAborted) scheduleTitleGeneration();
      }
    },
    abort() {
      if (!abortController || abortController.signal.aborted) return;
      requestAborted = true;
      abortController?.abort();
      requestInFlight = false;
      streamingTextBuffer = "";
      activeTools.clear();
      bridge.emit({ type: "text_clear" });
      bridge.emit({ type: "busy", busy: false });
      bridge.emit({
        type: "turn",
        turn: {
          id: `s_${Date.now().toString(36)}`,
          kind: "system",
          text: "*aborted by friend-shape*",
          createdAt: Date.now(),
        },
      });
    },
    async shutdown() {
      abortController?.abort();
      await cancelTitleGeneration();
      await store.flush();
      await fleet.stop();
    },
  };
}
