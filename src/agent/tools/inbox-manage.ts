import { z } from "zod";
import type { Context, GloveFoldArgs } from "glove-core";

export function inboxManageTool(context: Context): GloveFoldArgs<{
  item_ids?: string[];
  tags?: string[];
  reason: string;
}> {
  return {
    name: "glove_update_inbox",
    description:
      "Mark inbox items consumed when they are no longer needed. Use this before proceeding if a pending blocking inbox item is obsolete, irrelevant to the chosen path, or superseded by other evidence. You may pass exact internal item ids, visible inbox tags, or both. If the UI only shows a tag, pass it in tags. Repeated calls for an already-consumed item are treated as success. Do not use this to hide a result you still depend on.",
    inputSchema: z
      .object({
        item_ids: z
          .array(z.string().min(1))
          .max(20)
          .optional()
          .describe("Exact inbox item ids to consume, when known"),
        tags: z
          .array(z.string().min(1))
          .max(20)
          .optional()
          .describe("Visible inbox tags to consume. All pending/resolved items with a matching tag are consumed."),
        reason: z
          .string()
          .min(1)
          .max(500)
          .describe("Why these items are no longer needed"),
      })
      .refine((value) => (value.item_ids?.length ?? 0) > 0 || (value.tags?.length ?? 0) > 0, {
        message: "Provide at least one item id or tag.",
      }),
    async do(input) {
      const items = await context.getInboxItems();
      const byId = new Map(items.map((item) => [item.id, item]));
      const byTag = new Map<string, typeof items>();
      for (const item of items) {
        const tagged = byTag.get(item.tag) ?? [];
        tagged.push(item);
        byTag.set(item.tag, tagged);
      }
      const targets = new Map<string, typeof items[number]>();
      const updated: string[] = [];
      const matchedTags: string[] = [];
      const alreadyConsumed: string[] = [];
      const missingIds: string[] = [];
      const missingTags: string[] = [];
      const now = new Date().toISOString();

      const addByTag = (tag: string) => {
        const matches = byTag.get(tag) ?? [];
        if (matches.length === 0) {
          missingTags.push(tag);
          return;
        }
        matchedTags.push(tag);
        for (const item of matches) {
          if (item.status === "consumed") {
            alreadyConsumed.push(item.id);
          } else {
            targets.set(item.id, item);
          }
        }
      };

      for (const id of input.item_ids ?? []) {
        const item = byId.get(id);
        if (!item) {
          if (byTag.has(id)) {
            addByTag(id);
            continue;
          }
          missingIds.push(id);
          continue;
        }
        if (item.status === "consumed") {
          alreadyConsumed.push(item.id);
          continue;
        }
        targets.set(item.id, item);
      }

      for (const tag of input.tags ?? []) {
        addByTag(tag);
      }

      for (const item of targets.values()) {
        await context.updateInboxItem(item.id, {
          status: "consumed",
          response: item.response ?? `[dismissed] ${input.reason}`,
          resolved_at: item.resolved_at ?? now,
        });
        updated.push(item.id);
      }

      if (updated.length === 0) {
        if (alreadyConsumed.length > 0) {
          return {
            status: "success",
            data: {
              updated,
              already_consumed: [...new Set(alreadyConsumed)],
              matched_tags: [...new Set(matchedTags)],
              missing_ids: missingIds,
              missing_tags: missingTags,
              reason: input.reason,
              message:
                "No active inbox items needed changes; the requested inbox items are already consumed. You may proceed.",
            },
          };
        }
        return {
          status: "error",
          data: { updated, already_consumed: [], matched_tags: matchedTags, missing_ids: missingIds, missing_tags: missingTags },
          message: "No matching inbox items were found for the supplied ids or tags.",
        };
      }

      return {
        status: "success",
        data: {
          updated,
          already_consumed: [...new Set(alreadyConsumed)],
          matched_tags: [...new Set(matchedTags)],
          missing_ids: missingIds,
          missing_tags: missingTags,
          reason: input.reason,
          message: `Consumed ${updated.length} inbox item${updated.length === 1 ? "" : "s"}.`,
        },
      };
    },
  };
}
