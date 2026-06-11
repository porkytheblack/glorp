/**
 * Migration chain for the session snapshot store (`session.json` / legacy
 * `<id>.json`). To ship a schema change, append a `{ to, description, up }`
 * entry below — the engine and persisted `version` field handle the rest.
 */

import { Migrator, type Migration } from "./engine.ts";
import type { Snapshot } from "../store-snapshot.ts";
import { repairToolFlow } from "../runtime/tool-flow-repair.ts";

type VersionedSnapshot = Snapshot & { version: number };

const migrations: Migration[] = [
  {
    to: 1,
    description: "baseline: stamp version and normalize legacy snapshot fields",
    up(doc) {
      const meta = (doc.metadata && typeof doc.metadata === "object") ? doc.metadata : {};
      return {
        ...doc,
        metadata: {
          kind: "session",
          createdAt: new Date().toISOString(),
          ...meta,
        },
        messages: Array.isArray(doc.messages) ? doc.messages : [],
        tasks: Array.isArray(doc.tasks) ? doc.tasks : [],
        inboxItems: Array.isArray(doc.inboxItems) ? doc.inboxItems : [],
        permissions: doc.permissions && typeof doc.permissions === "object" ? doc.permissions : {},
        tokensIn: typeof doc.tokensIn === "number" ? doc.tokensIn : 0,
        tokensOut: typeof doc.tokensOut === "number" ? doc.tokensOut : 0,
        turnCount: typeof doc.turnCount === "number" ? doc.turnCount : 0,
      };
    },
  },
  {
    to: 2,
    description:
      "backfill reasoning_content on assistant tool-call messages captured " +
      "before reasoning capture was always-on — default-thinking providers " +
      "(kimi-k2.6 et al.) 400 a replayed tool-call turn that lacks it",
    up(doc) {
      const messages = Array.isArray(doc.messages) ? doc.messages : [];
      return {
        ...doc,
        messages: messages.map((m: any) =>
          m && m.sender === "agent" && Array.isArray(m.tool_calls) && m.tool_calls.length > 0 &&
          !(typeof m.reasoning_content === "string" && m.reasoning_content.length > 0)
            ? { ...m, reasoning_content: " " }
            : m,
        ),
      };
    },
  },
  {
    to: 3,
    description:
      "repair tool-call/result flow: aborted turns left dangling tool_calls " +
      "with late or missing results — strict providers (Moonshot Kimi) reject " +
      "the replay unless every tool_calls message is followed by its results",
    up(doc) {
      const messages = Array.isArray(doc.messages) ? doc.messages : [];
      return { ...doc, messages: repairToolFlow(messages as never) };
    },
  },
];

export const sessionMigrator = new Migrator<VersionedSnapshot>("session", migrations);
export const CURRENT_SESSION_VERSION = sessionMigrator.currentVersion;
