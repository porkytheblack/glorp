import { z } from "zod";
import type { GloveFoldArgs } from "glove-core";
import type { ResourceFsAdapter } from "glove-memory";
import type { GlorpStore } from "../store.ts";

export function planTool(
  store: GlorpStore,
  resources?: ResourceFsAdapter,
): GloveFoldArgs<{ title: string; body: string }> {
  return {
    name: "glorp_update_plan",
    description:
      "Create or replace the session plan document. A plan is a durable methodology document: " +
      "scope, approach, sequencing, risks, assumptions, and verification strategy. " +
      "Do not use this for the execution checklist; use glove_update_tasks for task artifacts.",
    inputSchema: z.object({
      title: z.string().min(3).max(120).describe("Short plan title"),
      body: z
        .string()
        .min(20)
        .max(16_000)
        .describe("Markdown plan body with methodology, assumptions, risks, and verification"),
    }),
    async do(input) {
      const plan = await store.updatePlan({ title: input.title, body: input.body });
      if (resources) {
        await resources.write(
          "/plans/current.md",
          { type: "markdown", text: `# ${plan.title}\n\n${plan.body}` },
          {
            summary: plan.title,
            tags: ["plan", "current"],
            links: [],
            revision: plan.revision,
          },
          {
            source: "session-plan",
            actor: "main-agent",
            timestamp: plan.updatedAt,
            note: "Mirrors the active Glorp plan document.",
          },
        );
      }
      return {
        status: "success",
        data: {
          title: plan.title,
          revision: plan.revision,
          summary: firstMeaningfulLine(plan.body),
        },
        renderData: plan,
      };
    },
  };
}

function firstMeaningfulLine(markdown: string): string {
  return markdown.split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 200) ?? "";
}
