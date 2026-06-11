/** Template browse endpoints. */

import type { TemplateStore } from "../templates/store.ts";
import { json, errorJson } from "../respond.ts";

export interface TemplateRoutes {
  list(): Response;
  get(name: string): Response;
}

export function templateRoutes(store: TemplateStore): TemplateRoutes {
  return {
    list(): Response {
      const templates = store.list().map((t) => ({
        name: t.name,
        description: t.description ?? null,
        step_count: t.steps?.length ?? 0,
      }));
      return json({ templates });
    },

    get(name): Response {
      const template = store.get(name);
      if (!template) return errorJson("not_found", `Template ${name} not found`, 404);
      return json({ template });
    },
  };
}
