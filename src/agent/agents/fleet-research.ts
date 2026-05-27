/**
 * Research agent factory — builds a read-only Glove for codebase research.
 * Originally used by the fleet; now available for orchestrator background tasks.
 */

import { Displaymanager } from "glove-core/display-manager";
import { Glove } from "glove-core/glove";
import { CredentialsStore } from "../credentials.ts";
import { GlorpStore } from "../store.ts";
import { pickModel } from "../model-picker.ts";
import { rolePrompt } from "../../orchestrator/role-registry.ts";
import { safeFilePart } from "../store-snapshot.ts";
import { createToolRegistry, registerTools } from "../tools/registry.ts";
import * as os from "node:os";
import * as path from "node:path";

export interface ResearchAgentInput {
  workspace: string;
  payload: string;
  itemId: string;
  provider?: string;
  model?: string;
  profileId?: string;
  dataDir?: string;
}

export async function runResearchAgent(input: ResearchAgentInput): Promise<string> {
  const credentials = input.dataDir ? new CredentialsStore(input.dataDir) : undefined;
  const picked = await pickModel({
    provider: input.provider,
    model: input.model,
    profileId: input.profileId,
    credentials,
  });
  const dataDir = input.dataDir ?? path.join(os.tmpdir(), "glorp-research");
  const itemId = safeFilePart(input.itemId);
  const child = new Glove({
    store: new GlorpStore(`research_${input.itemId}`, dataDir, {
      filePath: path.join(dataDir, "research", `${itemId}.json`),
      metadata: {
        kind: "subagent",
        namespace: "research-agent",
        triggerMessageId: input.itemId,
        triggerMessageIndex: -1,
        triggerMessageText: input.payload.slice(0, 500),
        durable: false,
        createdAt: new Date().toISOString(),
      },
    }),
    model: picked.adapter,
    displayManager: new Displaymanager(),
    serverMode: true,
    systemPrompt: rolePrompt("researcher"),
    compaction_config: {
      compaction_instructions: "Keep research findings, drop chatter.",
      max_turns: 8,
    },
  });
  registerTools(child, createToolRegistry({ workspace: input.workspace }), [
    "read", "grep", "glob", "ls", "web_fetch",
  ]);
  const result = await child.build().processRequest(input.payload);
  return finalText(result);
}

function finalText(result: unknown): string {
  if (result && typeof result === "object" && "messages" in result) {
    const messages = (result as { messages?: Array<{ text?: string }> }).messages ?? [];
    return messages.at(-1)?.text ?? "(no response)";
  }
  return (result as { text?: string })?.text ?? "(no response)";
}
