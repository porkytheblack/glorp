/**
 * Conversational agent roster: the set of agents a user can switch between
 * within one session. Each spec owns a persistent transcript (its own store)
 * and a persona (role). Persisted alongside the session snapshot so the roster
 * survives restarts. Exactly one spec is active at a time.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export const MAIN_AGENT_ID = "main";

/** Roles that map to a built-in persona prompt (agents/<role>.md). */
export const SELECTABLE_ROLES = ["general", "researcher", "reviewer", "planner", "builder"] as const;
export type SelectableRole = (typeof SELECTABLE_ROLES)[number];

const ROLE_LABELS: Record<string, string> = {
  general: "glorp",
  researcher: "researcher",
  reviewer: "reviewer",
  planner: "planner",
  builder: "builder",
};

export interface AgentSpec {
  id: string;
  label: string;
  role: string;
  /** Store identifier; doubles as the on-disk session file key. */
  storeId: string;
  createdAt: number;
  lastActiveAt: number;
  turnCount: number;
}

export interface RosterFile {
  activeId: string;
  specs: AgentSpec[];
}

export function defaultLabelForRole(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

export function defaultRoster(sessionId: string): RosterFile {
  const now = Date.now();
  return {
    activeId: MAIN_AGENT_ID,
    specs: [{
      id: MAIN_AGENT_ID,
      label: ROLE_LABELS.general,
      role: "general",
      storeId: sessionId,
      createdAt: now,
      lastActiveAt: now,
      turnCount: 0,
    }],
  };
}

export function newAgentSpec(sessionId: string, role: string, label?: string): AgentSpec {
  const id = `a_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const now = Date.now();
  return {
    id,
    label: label?.trim() || defaultLabelForRole(role),
    role,
    storeId: `${sessionId}__${id}`,
    createdAt: now,
    lastActiveAt: now,
    turnCount: 0,
  };
}

export function loadRoster(rosterFile: string, sessionId: string): RosterFile {
  try {
    if (!fs.existsSync(rosterFile)) return defaultRoster(sessionId);
    const parsed = JSON.parse(fs.readFileSync(rosterFile, "utf-8")) as Partial<RosterFile>;
    const specs = Array.isArray(parsed.specs) ? parsed.specs.filter(isSpec) : [];
    if (!specs.some((s) => s.id === MAIN_AGENT_ID)) {
      return defaultRoster(sessionId);
    }
    const activeId = specs.some((s) => s.id === parsed.activeId) ? parsed.activeId! : MAIN_AGENT_ID;
    return { activeId, specs };
  } catch {
    return defaultRoster(sessionId);
  }
}

export function saveRoster(rosterFile: string, roster: RosterFile): void {
  try {
    fs.mkdirSync(path.dirname(rosterFile), { recursive: true });
    const tmp = `${rosterFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(roster, null, 2), "utf-8");
    fs.renameSync(tmp, rosterFile);
  } catch (err) {
    console.error("[agent-roster] failed to persist roster:", err);
  }
}

function isSpec(v: unknown): v is AgentSpec {
  const s = v as AgentSpec;
  return !!s && typeof s.id === "string" && typeof s.storeId === "string" && typeof s.role === "string";
}
