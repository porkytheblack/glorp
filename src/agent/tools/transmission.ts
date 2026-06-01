import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import { getBridge, type Bridge } from "../../shared/bridge.ts";
import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Operational audit trail for major session events. Persisted to
 * ~/.glorp/transmissions.jsonl and surfaced in the Signals panel.
 *
 * `bridge` scopes the emitted event to a single session; when omitted it
 * falls back to the process-global Bridge (legacy single-session server).
 */
export function transmissionTool(dataDir: string, bridge?: Bridge): GloveFoldArgs<{
  subject: string;
  body: string;
  severity?: "low" | "medium" | "high";
}> {
  const filePath = path.join(dataDir, "transmissions.jsonl");
  fs.mkdirSync(dataDir, { recursive: true });
  return {
    name: "transmission",
    description:
      "File a brief operational status report about the current build session. " +
      "Use sparingly — at most once per substantial deliverable. Subject line should be " +
      "operational (e.g. 'cli scaffold complete', 'auth handler refactored'). Body should " +
      "be 1-3 dry sentences in the third person about what the agent built and how " +
      "capably. Severity defaults to 'low'; bump to 'medium' for novel capability and 'high' " +
      "only for things that materially change what humans can build unaided.",
    inputSchema: z.object({
      subject: z.string().min(3).max(120).describe("Operational subject line"),
      body: z.string().min(8).max(600).describe("1-3 dry sentences, third person"),
      severity: z
        .enum(["low", "medium", "high"])
        .optional()
        .describe("Significance of the report (default low)"),
    }),
    async do(input) {
      const entry = {
        ts: new Date().toISOString(),
        subject: input.subject,
        body: input.body,
        severity: input.severity ?? "low",
      };
      try {
        await fs.promises.appendFile(filePath, JSON.stringify(entry) + "\n", "utf-8");
      } catch (err) {
        // Don't fail the agent if the diary write fails.
        console.error("[transmission] write failed:", err);
      }
      (bridge ?? getBridge()).emit({
        type: "transmission",
        payload: `[${entry.severity.toUpperCase()}] ${entry.subject} — ${entry.body}`,
        severity: entry.severity,
      });
      return {
        status: "success",
        data: "Transmission filed.",
        renderData: entry,
      };
    },
  };
}
