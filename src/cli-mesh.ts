/**
 * `glorp mesh [agents|log]` — observability over the inter-agent mesh.
 *
 * The mesh never deletes: read messages are archived to `processed/`, agent
 * identities are tombstoned (status "completed") rather than removed. This
 * command reads that durable record so you can inspect the full back-and-forth
 * after agents have closed.
 *
 *   glorp mesh                 summary (agents + recent messages)
 *   glorp mesh agents          who joined the mesh + status
 *   glorp mesh log             the full message history (from → to)
 *   glorp mesh --session <id>  inspect a specific session
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { listSessions } from "./agent/sessions.ts";
import { resolveSessionPaths } from "./agent/session-paths.ts";
import type { CliArgs } from "./cli-args.ts";

interface MeshAgent { id: string; name?: string; capabilities?: string[]; status?: string; completedAt?: string }
type Delivery = "pending" | "read" | "deadletter";
interface MeshMsg { id?: string; from: string; to?: string; content: string; created_at?: string; delivery: Delivery; recipient: string }

function readJson<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, "utf-8")) as T; } catch { return null; }
}

function readMeshAgents(meshDir: string): MeshAgent[] {
  const dir = path.join(meshDir, "agents");
  let files: string[];
  try { files = fs.readdirSync(dir); } catch { return []; }
  return files
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson<MeshAgent>(path.join(dir, f)))
    .filter((a): a is MeshAgent => !!a);
}

function readMeshMessages(meshDir: string): MeshMsg[] {
  const buckets: Array<[string, Delivery]> = [["inbox", "pending"], ["processed", "read"], ["deadletter", "deadletter"]];
  const out: MeshMsg[] = [];
  for (const [bucket, delivery] of buckets) {
    const base = path.join(meshDir, bucket);
    let recipients: string[];
    try { recipients = fs.readdirSync(base); } catch { continue; }
    for (const recipient of recipients) {
      let files: string[];
      try { files = fs.readdirSync(path.join(base, recipient)); } catch { continue; }
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const m = readJson<MeshMsg>(path.join(base, recipient, f));
        if (m) out.push({ id: m.id, from: m.from, to: m.to, content: m.content, created_at: m.created_at, delivery, recipient });
      }
    }
  }
  return out.sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
}

function badge(d: Delivery): string {
  return d === "read" ? "✓ read   " : d === "pending" ? "· pending" : "✗ dead   ";
}
const oneLine = (s: string) => (s ?? "").replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1) + "…");

export async function runMesh(args: CliArgs): Promise<void> {
  const dataDir = process.env.GLORP_DATA_DIR ?? path.join(os.homedir(), ".glorp");
  let sessionId = args.sessionId;
  if (!sessionId) sessionId = (await listSessions(dataDir, { kind: "all" }))[0]?.id ?? "";
  if (!sessionId) { console.log("No sessions found."); return; }

  const meshDir = resolveSessionPaths(dataDir, sessionId).meshDir;
  console.log(`glorp mesh — session ${sessionId}`);
  console.log(`mesh dir: ${meshDir}\n`);

  const sub = (args.meshSub ?? "summary").toLowerCase();
  const wantAgents = sub === "summary" || sub === "agents" || sub === "list-agents";
  const wantLog = sub === "summary" || sub === "log" || sub === "messages";

  if (wantAgents) {
    const agents = readMeshAgents(meshDir);
    console.log(`AGENTS (${agents.length}):`);
    if (agents.length === 0) console.log("  (no agents have joined the mesh)");
    for (const a of agents) {
      const caps = a.capabilities?.length ? `  [${a.capabilities.join(", ")}]` : "";
      console.log(`  ${(a.status ?? "active").padEnd(10)} ${a.id}${caps}`);
    }
    console.log("");
  }

  if (wantLog) {
    const msgs = readMeshMessages(meshDir);
    const shown = sub === "summary" ? msgs.slice(-20) : msgs;
    const suffix = shown.length < msgs.length ? `, showing last ${shown.length}` : "";
    console.log(`MESSAGES (${msgs.length}${suffix}):`);
    if (msgs.length === 0) console.log("  (no mesh messages yet)");
    for (const m of shown) {
      const t = m.created_at ? m.created_at.slice(11, 19) : "  --:--  ";
      console.log(`  [${t}] ${badge(m.delivery)}  ${m.from} → ${m.to ?? m.recipient}: ${clip(oneLine(m.content), 100)}`);
    }
  }
}
