/**
 * Migration chain for the session snapshot store (`session.json` / legacy
 * `<id>.json`). To ship a schema change, append a `{ to, description, up }`
 * entry below — the engine and persisted `version` field handle the rest.
 */

import { Migrator, type Migration } from "./engine.ts";
import type { Snapshot } from "../store-snapshot.ts";

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
];

export const sessionMigrator = new Migrator<VersionedSnapshot>("session", migrations);
export const CURRENT_SESSION_VERSION = sessionMigrator.currentVersion;
