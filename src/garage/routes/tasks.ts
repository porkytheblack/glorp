/**
 * The Task API — a simple black-box surface over Garage. A task wraps exactly
 * one worker session (task id == session id), so it inherits persistence,
 * rehydrate, GC, files, and R2 for free. This module owns only the thin task
 * envelope; status/result/questions are projected in task-project.ts, and the
 * agent declares its result through the task toolkit.
 */

import type { SessionManager } from "../manager.ts";
import type { GarageConfig } from "../config.ts";
import type { TemplateSource } from "../templates/source.ts";
import type { TaskStore } from "../task-store.ts";
import type { CreateTaskInput, PostTaskMessageInput, PostTaskAnswerInput } from "../contract.ts";
import { json, errorJson, noContent, readJson } from "../respond.ts";
import { newSessionId } from "../../agent/sessions.ts";
import { paramDto } from "./templates.ts";
import { buildTaskDto } from "./task-project.ts";
import { kickProvision } from "./task-provision.ts";

export interface TaskRoutes {
  types(): Promise<Response>;
  create(req: Request): Promise<Response>;
  start(id: string): Promise<Response>;
  list(): Promise<Response>;
  get(id: string): Promise<Response>;
  messages(id: string, req: Request): Promise<Response>;
  answers(id: string, req: Request): Promise<Response>;
  destroy(id: string): Promise<Response>;
}

/** Accept only http(s) callback URLs (a server-side fetch target). Returns the
 *  normalized URL, or null if absent/malformed. Host-level egress policy is the
 *  operator's network concern (internal callbacks are a legitimate use). */
export function validCallbackUrl(raw: unknown): string | null | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Coerce a consumer's answer to the value the slot renderer expects. */
export function coerceAnswer(renderer: string, answer: unknown): unknown {
  if (renderer === "confirm") return answer === true || answer === "yes" || answer === "true";
  if (renderer === "info") return null;
  return answer == null ? "" : String(answer);
}

export function taskRoutes(
  manager: SessionManager,
  config: GarageConfig,
  store: TaskStore,
  templates: TemplateSource,
): TaskRoutes {
  return {
    async types(): Promise<Response> {
      const list = await templates.list();
      const managed = config.taskParams ?? {};
      return json({
        types: list.map((t) => ({
          name: t.name,
          description: t.description ?? null,
          // Operator-managed params are filled server-side — hide them so a
          // consumer never sees (or has to supply) infrastructure inputs.
          inputs: (t.params ?? []).filter((p) => !(p.name in managed)).map(paramDto),
        })),
      });
    },

    async create(req): Promise<Response> {
      let body: CreateTaskInput;
      try {
        body = await readJson<CreateTaskInput>(req);
      } catch {
        return errorJson("bad_request", "Invalid JSON body", 400);
      }
      const type = body?.type;
      if (!type || typeof type !== "string") return errorJson("bad_request", "Missing 'type'", 400);
      const template = await templates.get(type);
      if (!template) return errorJson("bad_request", `Unknown task type '${type}'`, 400);
      // Freeze the type's deliverable contract onto the record so the read-side
      // can gate completion (and the worker can be told what to produce).
      const deliverable = template.deliverable ?? null;
      const prompt = body.input?.prompt;
      if (typeof prompt !== "string" || !prompt.trim()) return errorJson("bad_request", "Missing 'input.prompt'", 400);
      const callbackUrl = validCallbackUrl(body.callback_url);
      if (callbackUrl === null) return errorJson("bad_request", "'callback_url' must be an http(s) URL", 400);

      const id = newSessionId();
      const created_at = new Date().toISOString();
      // Operator-managed params are authoritative — they fill (and override) the
      // submitter's, so infra secrets like a render key never cross the API.
      const params = { ...body.input.params, ...config.taskParams };
      // defer_start: provision but withhold the prompt so the caller can upload
      // input files first, then POST /tasks/:id/start. The held prompt is persisted
      // so `start` is observable across reads.
      const deferred = body.defer_start === true;
      const record = store.create({
        id, type, created_at,
        ...(callbackUrl ? { callback_url: callbackUrl } : {}),
        ...(deferred ? { held: { prompt }, started: false } : {}),
        ...(deliverable ? { deliverable } : {}),
      });
      kickProvision({
        manager, store, config, record, params,
        permissionMode: body.permission_mode,
        sendPrompt: deferred ? undefined : prompt,
      });
      // Always "queued" at this instant — a deferred task flips to "staged" once
      // provisioning completes (projected live), an immediate one to "working".
      return json({ id, type, status: "queued", created_at }, 202);
    },

    async start(id): Promise<Response> {
      const record = store.get(id);
      if (!record) return errorJson("not_found", `Task ${id} not found`, 404);
      if (!record.held) return errorJson("conflict", "Task was not created with defer_start; nothing to start", 409);
      if (record.started) return errorJson("conflict", "Task already started", 409);
      const session = manager.getOrRehydrate(id);
      if (!session) return errorJson("not_active", "Task is still provisioning — retry once status is 'staged'", 409);
      // Mark before dispatch (synchronous, so a racing start sees `started`).
      store.setStarted(id);
      void session.send(record.held.prompt);
      return json({ accepted: true, id }, 202);
    },

    async list(): Promise<Response> {
      const now = Date.now();
      const tasks = await Promise.all(store.list().map((r) => buildTaskDto(r, manager.getOrRehydrate(r.id), config, now)));
      return json({ tasks });
    },

    async get(id): Promise<Response> {
      const record = store.get(id);
      if (!record) return errorJson("not_found", `Task ${id} not found`, 404);
      return json(await buildTaskDto(record, manager.getOrRehydrate(id), config, Date.now()));
    },

    async messages(id, req): Promise<Response> {
      if (!store.get(id)) return errorJson("not_found", `Task ${id} not found`, 404);
      let body: PostTaskMessageInput;
      try {
        body = await readJson<PostTaskMessageInput>(req);
      } catch {
        return errorJson("bad_request", "Invalid JSON body", 400);
      }
      if (typeof body?.text !== "string" || !body.text.trim()) return errorJson("bad_request", "Missing 'text'", 400);
      const session = manager.getOrRehydrate(id);
      if (!session) return errorJson("not_active", "Task is not active", 409);
      void session.send(body.text);
      return json({ accepted: true, id }, 202);
    },

    async answers(id, req): Promise<Response> {
      if (!store.get(id)) return errorJson("not_found", `Task ${id} not found`, 404);
      let body: PostTaskAnswerInput;
      try {
        body = await readJson<PostTaskAnswerInput>(req);
      } catch {
        return errorJson("bad_request", "Invalid JSON body", 400);
      }
      const qid = body?.question_id;
      if (!qid || typeof qid !== "string") return errorJson("bad_request", "Missing 'question_id'", 400);
      const ans = body.answer;
      if (!(typeof ans === "string" || typeof ans === "boolean" || ans === null)) {
        return errorJson("bad_request", "'answer' must be a string, boolean, or null", 400);
      }
      const session = manager.getOrRehydrate(id);
      const handle = session?.current();
      if (!session || !handle) return errorJson("not_active", "Task is not active", 409);
      const slot = session.openSlots().find((s) => s.slotId === qid && !s.isPermissionRequest);
      if (!slot) return errorJson("not_found", `No open question '${qid}'`, 404);
      handle.resolveSlot(qid, coerceAnswer(slot.renderer, body.answer));
      return json({ resolved: true, question_id: qid });
    },

    async destroy(id): Promise<Response> {
      if (!store.get(id)) return errorJson("not_found", `Task ${id} not found`, 404);
      await manager.destroy(id, { workspace: true });
      store.delete(id);
      return noContent();
    },
  };
}
