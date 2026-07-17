/**
 * Session-scoped MCP runtime: connects the configured servers, bridges their
 * tools onto the live agent (as `<id>__<tool>`), registers the `discovermcp`
 * discovery subagent, and reports per-server status over the bridge so the
 * TUI can render an MCP panel.
 *
 * Active state is persisted per session (McpActiveStore); tokens come from
 * config (already `{env:}`/`{file:}`-interpolated). Toggling a server from the
 * UI rebuilds the live agent, which re-runs `mount()` against the new set —
 * that is how deactivation actually unloads tools (glove-mcp v1 can't unfold).
 */

import {
  bearer, bridgeMcpTool, connectMcp, discoverySubAgent,
  type McpAdapter, type McpCatalogueEntry, type McpServerConnection,
} from "glove-mcp";
import type { GloveFoldArgs, IGloveRunnable } from "glove-core/glove";
import type { DefineSubAgentArgs } from "glove-core/extensions";
import type { Bridge } from "../../shared/bridge.ts";
import type { McpServerStatus } from "../../shared/events.ts";
import { GLORP_VERSION } from "../../shared/version.ts";
import { McpActiveStore } from "./active-store.ts";
import { autoConnectIds, mcpCatalogue, mcpToken, type McpSection } from "./config.ts";

const CONNECT_TIMEOUT_MS = 10_000;
const MAX_TOOL_NAMES = 24;
const CLIENT_INFO = { name: "glorp", version: GLORP_VERSION };

export class McpManager {
  readonly adapter: McpAdapter;
  private readonly entries: McpCatalogueEntry[];
  private readonly activeStore: McpActiveStore;
  private readonly statuses = new Map<string, McpServerStatus>();
  private conns: McpServerConnection[] = [];

  constructor(
    private readonly cfg: McpSection,
    activeFile: string,
    private readonly bridge: Bridge,
    sessionId: string,
  ) {
    this.entries = mcpCatalogue(cfg);
    this.activeStore = new McpActiveStore(activeFile, () => autoConnectIds(cfg));
    this.resetStatuses();
    this.adapter = {
      identifier: sessionId,
      getActive: async () => this.activeStore.load().filter((id) => this.entries.some((e) => e.id === id)),
      activate: async (id) => {
        this.activeStore.set(id, true);
        this.patch(id, { active: true, state: "connected" });
        this.emitStatus();
      },
      deactivate: async (id) => {
        this.activeStore.set(id, false);
        this.patch(id, { active: false, state: "inactive" });
        this.emitStatus();
      },
      getAccessToken: async (id) => mcpToken(this.cfg, id) ?? "",
    };
  }

  get hasServers(): boolean {
    return this.entries.length > 0;
  }

  list(): McpServerStatus[] {
    return this.entries
      .map((e) => this.statuses.get(e.id))
      .filter((s): s is McpServerStatus => s !== undefined);
  }

  /** Persist a toggle. Returns true when the active set changed. */
  setActive(id: string, active: boolean): boolean {
    if (!this.entries.some((e) => e.id === id)) return false;
    return this.activeStore.set(id, active);
  }

  /**
   * Connect every active server, fold its tools onto `agent`, and register the
   * discovery subagent. Per-server failures degrade to an `error` status —
   * a down MCP server never blocks session start.
   */
  async mount(agent: IGloveRunnable): Promise<void> {
    if (!this.hasServers) return;
    await this.closeAll();
    this.resetStatuses();
    const active = await this.adapter.getActive();
    for (const id of active) {
      const entry = this.entries.find((e) => e.id === id)!;
      try {
        const conn = await this.connect(entry);
        this.conns.push(conn);
        const tools = await withTimeout(conn.listTools(), CONNECT_TIMEOUT_MS, `${id}: listTools timed out`);
        // glove-mcp pins glove-core@3.0.0; glorp runs ^3.0.6. The shapes are
        // runtime-compatible — the casts paper over the nested-install types.
        for (const tool of tools) agent.fold(bridgeMcpTool(conn, tool, true) as unknown as GloveFoldArgs<unknown>);
        this.patch(id, {
          active: true, state: "connected", toolCount: tools.length,
          tools: tools.slice(0, MAX_TOOL_NAMES).map((t) => t.name),
        });
      } catch (err) {
        this.patch(id, { active: true, state: "error", error: (err as Error)?.message ?? String(err) });
      }
    }
    agent.defineSubAgent(discoverySubAgent({
      adapter: this.adapter,
      entries: this.entries,
      ambiguityPolicy: { type: "auto-pick-best" },
      clientInfo: CLIENT_INFO,
    }) as unknown as DefineSubAgentArgs);
    this.emitStatus();
  }

  /** Re-broadcast the current status snapshot (used on hydrate/resync). */
  emitStatus(): void {
    if (!this.hasServers) return;
    this.bridge.emit({ type: "mcp_status", servers: this.list() });
  }

  async closeAll(): Promise<void> {
    const closing = this.conns;
    this.conns = [];
    await Promise.allSettled(closing.map((c) => c.close()));
  }

  private async connect(entry: McpCatalogueEntry): Promise<McpServerConnection> {
    const token = mcpToken(this.cfg, entry.id);
    const conn = connectMcp({
      namespace: entry.id,
      url: entry.url,
      ...(token ? { auth: bearer(() => mcpToken(this.cfg, entry.id) ?? "") } : {}),
      clientInfo: CLIENT_INFO,
    });
    return withTimeout(conn, CONNECT_TIMEOUT_MS, `${entry.id}: connect timed out`, (late) => void late.close().catch(() => {}));
  }

  private resetStatuses(): void {
    const active = new Set(this.activeStore.load());
    for (const e of this.entries) {
      this.statuses.set(e.id, {
        id: e.id, name: e.name, url: e.url,
        description: this.cfg[e.id]?.description,
        tags: e.tags,
        active: active.has(e.id),
        state: "inactive",
        toolCount: 0,
      });
    }
  }

  private patch(id: string, patch: Partial<McpServerStatus>): void {
    const current = this.statuses.get(id);
    if (current) this.statuses.set(id, { ...current, ...patch });
  }
}

/** Race a promise against a timeout; optionally dispose a late winner. */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
  onLate?: (value: T) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new Error(message));
    }, ms);
    promise.then(
      (value) => {
        if (settled) { onLate?.(value); return; }
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
