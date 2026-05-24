import { describe, test, expect } from "bun:test";
import { Glove } from "glove-core/glove";
import { Displaymanager } from "glove-core/display-manager";
import type { ModelAdapter } from "glove-core/core";

import {
  registerBuiltInSkills,
  registerDiskSkills,
} from "../src/agent/runtime/skills.ts";
import type { LoadedSkill } from "../src/agent/extensions-loader.ts";

const fakeModel: ModelAdapter = {
  name: "noop",
  async prompt() {
    return { messages: [{ sender: "agent", text: "ok" }], tokens_in: 0, tokens_out: 0 };
  },
  setSystemPrompt() {},
};

function makeBuilder() {
  return new Glove({
    store: makeMemoryStore(),
    model: fakeModel,
    displayManager: new Displaymanager(),
    serverMode: true,
    systemPrompt: "test",
    compaction_config: { compaction_instructions: "x", max_turns: 5 },
  });
}

function makeMemoryStore(): any {
  const msgs: any[] = [];
  return {
    identifier: "skills-test",
    async getMessages() { return msgs; },
    async appendMessages(arr: any[]) { msgs.push(...arr); },
    async getTokenCount() { return 0; },
    async addTokens() {},
    async getTurnCount() { return 0; },
    async incrementTurn() {},
    async resetCounters() {},
    async getTasks() { return []; },
    async addTasks() {},
    async updateTask() {},
    async getPermission() { return "unset" as const; },
    async setPermission() {},
    async getInboxItems() { return []; },
    async addInboxItem() {},
    async updateInboxItem() {},
    async getResolvedInboxItems() { return []; },
    async createSubAgentStore() { return makeMemoryStore(); },
  };
}

function diskSkill(name: string, description: string, body = ""): LoadedSkill {
  return {
    name,
    description,
    body,
    sourcePath: `/tmp/skills/${name}/SKILL.md`,
    source: "claude",
    scope: "workspace",
    referencePaths: [],
  };
}

function skillsOnBuilder(builder: Glove): Map<string, { description: string; handler: any }> {
  // The Glove builder stores skills on a private `skills` Map. We read it
  // through the instance to assert registration outcome without going via
  // the model loop. This is a test-only inspection.
  return (builder as any).skills;
}

describe("skill registration precedence", () => {
  test("built-in skill is registered when no disk skill claims its name", () => {
    const builder = makeBuilder();
    registerDiskSkills(builder, []);
    registerBuiltInSkills(builder, []);
    const skills = skillsOnBuilder(builder);
    expect(skills.has("concise")).toBe(true);
    expect(skills.get("concise")?.description).toBe("Trim verbosity for this exchange");
  });

  test("disk skill of the same name as a built-in wins (workspace skill > built-in)", async () => {
    const builder = makeBuilder();
    const userOverride = diskSkill("concise", "User's louder version", "Use a lot of words.");
    registerDiskSkills(builder, [userOverride]);
    registerBuiltInSkills(builder, [userOverride]);
    const skills = skillsOnBuilder(builder);
    const entry = skills.get("concise");
    expect(entry).toBeDefined();
    expect(entry!.description).toBe("User's louder version");
    const body = await entry!.handler({ source: "agent", args: undefined, parsedText: "" });
    expect(body).toContain("Use a lot of words.");
    expect(body).not.toContain("Two-sentence answers");
  });

  test("disk skills register normally even when none collide with built-ins", () => {
    const builder = makeBuilder();
    const docx = diskSkill("docx", "Make Word documents");
    registerDiskSkills(builder, [docx]);
    registerBuiltInSkills(builder, [docx]);
    const skills = skillsOnBuilder(builder);
    expect(skills.has("docx")).toBe(true);
    expect(skills.has("concise")).toBe(true); // built-in untouched
  });
});
