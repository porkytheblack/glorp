/** Template browse endpoints — disk library + companion-service registry merged. */

import type { TemplateSource } from "../templates/source.ts";
import type { Template } from "../templates/types.ts";
import type { TemplateSummaryDto, TemplateParamDto } from "../contract.ts";
import { json, errorJson } from "../respond.ts";

export interface TemplateRoutes {
  list(): Promise<Response>;
  get(name: string): Promise<Response>;
}

/** Project a template into its public summary (counts + declared params). */
function summarize(t: Template): TemplateSummaryDto {
  return {
    name: t.name,
    description: t.description ?? null,
    step_count: t.steps?.length ?? 0,
    repo_count: t.repos?.length ?? 0,
    skill_count: t.skills?.length ?? 0,
    mcp_count: t.mcp?.length ?? 0,
    has_system_prompt: typeof t.system_prompt === "string",
    params: (t.params ?? []).map(paramDto),
  };
}

/** Null-normalise a declared param's optional fields for the wire contract. */
export function paramDto(p: NonNullable<Template["params"]>[number]): TemplateParamDto {
  return {
    name: p.name,
    description: p.description ?? null,
    required: p.required ?? false,
    default: p.default ?? null,
    secret: p.secret ?? false,
  };
}

export function templateRoutes(source: TemplateSource): TemplateRoutes {
  return {
    async list(): Promise<Response> {
      return json({ templates: (await source.list()).map(summarize) });
    },

    async get(name): Promise<Response> {
      const template = await source.get(name);
      if (!template) return errorJson("not_found", `Template ${name} not found`, 404);
      return json({ template });
    },
  };
}
