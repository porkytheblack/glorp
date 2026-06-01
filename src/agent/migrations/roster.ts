/**
 * Migration chain for the conversational-agent roster store (`roster.json` /
 * legacy `<id>.roster.json`). Append `{ to, description, up }` entries to evolve
 * the roster schema.
 */

import { Migrator, type Migration } from "./engine.ts";
import type { RosterFile } from "../runtime/agent-roster.ts";

type VersionedRoster = RosterFile & { version: number };

const migrations: Migration[] = [
  {
    to: 1,
    description: "baseline: stamp version and normalize roster shape",
    up(doc) {
      const specs = Array.isArray(doc.specs) ? doc.specs : [];
      const activeId = typeof doc.activeId === "string" ? doc.activeId : "main";
      return { ...doc, activeId, specs };
    },
  },
];

export const rosterMigrator = new Migrator<VersionedRoster>("roster", migrations);
export const CURRENT_ROSTER_VERSION = rosterMigrator.currentVersion;
