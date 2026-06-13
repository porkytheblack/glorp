/**
 * Resolves every on-disk path that belongs to a session.
 *
 * New sessions are self-contained folders: `<dataDir>/sessions/<id>/` holds the
 * transcript, roster, error log, resources, mesh, sub-agent runs, and each
 * spawned conversational agent (with its own transcript). Older sessions used a
 * flat layout (`sessions/<id>.json`, `sessions/<id>.roster.json`, `mesh/<id>/`,
 * …); those are detected and kept working unchanged — we never move existing
 * data, we just keep reading it where it already lives.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { safeFilePart } from "./store-snapshot.ts";

export interface SessionPaths {
  dataDir: string;
  sessionId: string;
  /** True when this session uses the pre-folder flat layout. */
  legacy: boolean;
  /** The session's own folder (folder layout) or its notional root. */
  root: string;
  /** Main transcript store (messages, tool calls/results, tasks, plan, …). */
  storeFile: string;
  rosterFile: string;
  errorsFile: string;
  resourcesFile: string;
  meshDir: string;
  /** Where conversational agents (and their transcripts) live. */
  agentsDir: string;
  /** Where sub-agent run transcripts live. */
  subagentsDir: string;
  /** The agent's declared task deliverable (task mode); read by the Task API. */
  taskResultFile: string;
  /** The agent's latest non-blocking progress note (task mode). */
  taskProgressFile: string;
}

function statKind(p: string): "file" | "dir" | null {
  try { return fs.statSync(p).isDirectory() ? "dir" : "file"; } catch { return null; }
}

/** Resolve all paths for a session, choosing the folder or legacy layout. */
export function resolveSessionPaths(dataDir: string, sessionId: string): SessionPaths {
  const id = safeFilePart(sessionId);
  const base = path.join(dataDir, "sessions");
  const root = path.join(base, id);
  const legacyMain = path.join(base, `${id}.json`);
  // Legacy iff the flat transcript exists and no folder has been created.
  const legacy = statKind(legacyMain) === "file" && statKind(root) !== "dir";

  if (legacy) {
    return {
      dataDir, sessionId, legacy: true, root,
      storeFile: legacyMain,
      rosterFile: path.join(base, `${id}.roster.json`),
      errorsFile: path.join(base, `${id}.errors.log`),
      resourcesFile: path.join(base, `${id}.resources.json`),
      meshDir: path.join(dataDir, "mesh", sessionId),
      agentsDir: base, // legacy conversational stores were flat siblings: <id>__<aid>.json
      subagentsDir: path.join(base, `${id}.subagents`),
      taskResultFile: path.join(base, `${id}.task-result.json`),
      taskProgressFile: path.join(base, `${id}.task-progress.json`),
    };
  }
  return {
    dataDir, sessionId, legacy: false, root,
    storeFile: path.join(root, "session.json"),
    rosterFile: path.join(root, "roster.json"),
    errorsFile: path.join(root, "errors.log"),
    resourcesFile: path.join(root, "resources.json"),
    meshDir: path.join(root, "mesh"),
    agentsDir: path.join(root, "agents"),
    subagentsDir: path.join(root, "subagents"),
    taskResultFile: path.join(root, "task-result.json"),
    taskProgressFile: path.join(root, "task-progress.json"),
  };
}

/** Transcript file for a conversational agent within a session. */
export function agentStoreFile(paths: SessionPaths, agentId: string): string {
  const aid = safeFilePart(agentId);
  return paths.legacy
    ? path.join(paths.agentsDir, `${safeFilePart(paths.sessionId)}__${aid}.json`)
    : path.join(paths.agentsDir, aid, "session.json");
}

/** Resources file for a conversational agent within a session. */
export function agentResourcesFile(paths: SessionPaths, agentId: string): string {
  const aid = safeFilePart(agentId);
  return paths.legacy
    ? path.join(paths.agentsDir, `${safeFilePart(paths.sessionId)}__${aid}.resources.json`)
    : path.join(paths.agentsDir, aid, "resources.json");
}

/** Remove everything stored for a session (folder layout + any legacy files). */
export function removeSessionStorage(dataDir: string, sessionId: string): void {
  const id = safeFilePart(sessionId);
  const base = path.join(dataDir, "sessions");
  const targets = [
    path.join(base, id),                       // folder layout
    path.join(base, `${id}.json`),             // legacy transcript
    path.join(base, `${id}.roster.json`),
    path.join(base, `${id}.errors.log`),
    path.join(base, `${id}.resources.json`),
    path.join(base, `${id}.subagents`),
    path.join(base, `${id}.task-result.json`),   // legacy task deliverable
    path.join(base, `${id}.task-progress.json`),
    path.join(dataDir, "mesh", sessionId),     // legacy mesh
  ];
  for (const t of targets) { try { fs.rmSync(t, { recursive: true, force: true }); } catch { /* ignore */ } }
}
