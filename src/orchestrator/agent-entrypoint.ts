/**
 * Subprocess-importable agent definitions for the ContinuumRunner bootstrap.
 *
 * The bootstrap loads this file via `import(CONTINUUM_AGENT_FILE)`, finds the
 * exported agent by name, and runs its factory. Config is read from env vars
 * set by the parent runner (GLORP_WORKSPACE, GLORP_DATA_DIR, GLORP_MESH_DIR).
 *
 * Agent construction is defined once in agent-factory.ts — this file only
 * applies the Happy Eyeballs fix and re-exports the definitions.
 */

// Node 22's Happy Eyeballs (autoSelectFamily) breaks on endpoints that
// return unreachable IPv6 NAT64 records. Disable before any fetch occurs.
import * as net from "node:net";
net.setDefaultAutoSelectFamily(false);

import { defineOrchestratorAgent } from "./agent-factory.ts";

const cfg = {
  dataDir: process.env.GLORP_DATA_DIR ?? "",
  workspace: process.env.GLORP_WORKSPACE ?? "",
  meshDir: process.env.GLORP_MESH_DIR ?? "",
};

export const generator = defineOrchestratorAgent("generator", cfg);
export const evaluator = defineOrchestratorAgent("evaluator", cfg);
export const researcher = defineOrchestratorAgent("researcher", cfg);
export const builder = defineOrchestratorAgent("builder", cfg);
