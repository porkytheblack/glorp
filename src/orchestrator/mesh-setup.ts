/**
 * Cross-process mesh transport using the filesystem.
 * Each agent gets an inbox directory under `dataDir/mesh/<agentId>/`.
 * Messages are atomic file writes; subscribe polls the inbox.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { MeshAdapter, AgentIdentity, MeshMessage, IncomingMeshMessage } from "glove-mesh";
import { mountMesh } from "glove-mesh";
import type { IGloveRunnable } from "glove-core/glove";

const POLL_MS = 100;

export class FileMeshAdapter implements MeshAdapter {
  readonly identifier: string;
  private baseDir: string;
  private identity: AgentIdentity | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private handler: ((msg: IncomingMeshMessage) => Promise<void>) | null = null;
  private seen = new Set<string>();

  constructor(agentId: string, meshDir: string) {
    this.identifier = agentId;
    this.baseDir = meshDir;
  }

  async register(identity: AgentIdentity): Promise<void> {
    this.identity = identity;
    const dir = path.join(this.baseDir, "agents");
    await fs.mkdir(dir, { recursive: true });
    await atomicWrite(path.join(dir, `${identity.id}.json`), JSON.stringify(identity));
    await fs.mkdir(path.join(this.baseDir, "inbox", identity.id), { recursive: true });
  }

  async unregister(): Promise<void> {
    if (!this.identity) return;
    this.stopPolling();
    const file = path.join(this.baseDir, "agents", `${this.identity.id}.json`);
    await fs.rm(file, { force: true });
    this.identity = null;
  }

  async listAgents(): Promise<AgentIdentity[]> {
    const dir = path.join(this.baseDir, "agents");
    try {
      const files = await fs.readdir(dir);
      const results: AgentIdentity[] = [];
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const raw = await fs.readFile(path.join(dir, f), "utf-8");
        results.push(JSON.parse(raw) as AgentIdentity);
      }
      return results;
    } catch {
      return [];
    }
  }

  async getAgent(id: string): Promise<AgentIdentity | null> {
    try {
      const raw = await fs.readFile(path.join(this.baseDir, "agents", `${id}.json`), "utf-8");
      return JSON.parse(raw) as AgentIdentity;
    } catch {
      return null;
    }
  }

  async send(message: MeshMessage): Promise<void> {
    if (!message.to) return;
    const dir = path.join(this.baseDir, "inbox", message.to);
    await fs.mkdir(dir, { recursive: true });
    const filename = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}.json`;
    await atomicWrite(path.join(dir, filename), JSON.stringify(message));
  }

  async broadcast(message: Omit<MeshMessage, "to">): Promise<void> {
    const agents = await this.listAgents();
    const self = this.identity?.id;
    for (const agent of agents) {
      if (agent.id === self) continue;
      await this.send({ ...message, to: agent.id } as MeshMessage);
    }
  }

  async acknowledge(messageId: string, note?: string): Promise<void> {
    // Route ack back to the sender by scanning the senders table
    const sendersDir = path.join(this.baseDir, "senders");
    try {
      const raw = await fs.readFile(path.join(sendersDir, `${messageId}.txt`), "utf-8");
      const senderId = raw.trim();
      await this.send({
        id: `ack_${messageId}_${Date.now()}`,
        from: this.identity?.id ?? "unknown",
        to: senderId,
        content: note ?? `ack:${messageId}`,
        created_at: new Date().toISOString(),
      } as MeshMessage);
    } catch {
      // Sender lookup failed — best effort.
    }
  }

  subscribe(handler: (msg: IncomingMeshMessage) => Promise<void>): () => void {
    this.handler = handler;
    this.pollTimer = setInterval(() => void this.pollInbox(), POLL_MS);
    return () => this.stopPolling();
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.handler = null;
  }

  private async pollInbox(): Promise<void> {
    if (!this.handler || !this.identity) return;
    const dir = path.join(this.baseDir, "inbox", this.identity.id);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const f of files) {
      if (this.seen.has(f)) continue;
      this.seen.add(f);
      try {
        const raw = await fs.readFile(path.join(dir, f), "utf-8");
        const msg = JSON.parse(raw) as MeshMessage;
        await recordSender(this.baseDir, msg.id, msg.from);
        const kind = msg.content?.startsWith("ack:") ? "ack" as const : "direct" as const;
        const incoming: IncomingMeshMessage = { ...msg, kind };
        await this.handler(incoming);
        await fs.rm(path.join(dir, f), { force: true });
        this.seen.delete(f);
      } catch (err) {
        console.error(`[mesh] failed to process ${f}:`, err);
      }
    }
  }
}

async function atomicWrite(filePath: string, data: string): Promise<void> {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data, "utf-8");
  await fs.rename(tmp, filePath);
}

async function recordSender(baseDir: string, msgId: string, sender: string): Promise<void> {
  const dir = path.join(baseDir, "senders");
  await fs.mkdir(dir, { recursive: true });
  await atomicWrite(path.join(dir, `${msgId}.txt`), sender);
}

export async function mountAgentMesh(
  runnable: IGloveRunnable,
  id: string,
  meshDir: string,
  capabilities: string[] = [],
): Promise<FileMeshAdapter> {
  const adapter = new FileMeshAdapter(id, meshDir);
  // mountMesh requires { fold, store } — IGloveRunnable exposes fold but store
  // is private. We cast through a structural match since the Glove class does
  // satisfy MeshMountTarget at the value level.
  await mountMesh(runnable as any, {
    adapter,
    identity: { id, name: id, description: `Orchestrated agent: ${id}`, capabilities },
  });
  return adapter;
}

export async function teardownAgentMesh(adapter: FileMeshAdapter): Promise<void> {
  await adapter.unregister();
}
