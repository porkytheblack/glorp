/** Session tools: run an agent, send messages, fetch results, manage lifecycle. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "../client.js";
import { guard } from "./util.js";

const ns = z.string().optional().describe("Act inside this namespace (admin keys only)");
const mode = z.enum(["normal", "auto", "bypass"]).optional();

export function registerSessionTools(server: McpServer, ctx: McpContext): void {
  server.registerTool(
    "glorp_run",
    {
      title: "Run an agent",
      description:
        "Create a session, send the first prompt, and (by default) wait for the turn to finish. " +
        "Provide `workspace` (host path) or `workspaceId`, or omit both for a fresh sandbox. " +
        "permissionMode defaults to `auto` so unattended runs don't block on prompts.",
      inputSchema: {
        prompt: z.string(),
        workspace: z.string().optional(),
        workspaceId: z.string().optional(),
        permissionMode: mode,
        waitMs: z.number().optional().describe("Max ms to wait for the result; 0 = return immediately"),
        namespace: ns,
      },
    },
    ({ prompt, workspace, workspaceId, permissionMode, waitMs, namespace }) =>
      guard(async () => {
        const h = await ctx
          .clientFor(namespace)
          .run({ prompt, workspace, workspaceId, permissionMode });
        if (waitMs === 0) return { session_id: h.sessionId, status: "started" };
        const result = await h.result({ timeoutMs: waitMs ?? 600_000 });
        return { session_id: h.sessionId, ...result };
      }),
  );

  server.registerTool(
    "glorp_list_sessions",
    { title: "List sessions", description: "List sessions in the (resolved) namespace.", inputSchema: { namespace: ns } },
    ({ namespace }) => guard(() => ctx.clientFor(namespace).sessions.list()),
  );

  server.registerTool(
    "glorp_get_session",
    {
      title: "Get session",
      description: "Fetch a session's status (state, busy, tokens, title).",
      inputSchema: { id: z.string(), namespace: ns },
    },
    ({ id, namespace }) => guard(() => ctx.clientFor(namespace).sessions.get(id)),
  );

  server.registerTool(
    "glorp_send_message",
    {
      title: "Send message",
      description: "Send a message to a session. `wait` blocks and returns the full turn text.",
      inputSchema: { id: z.string(), text: z.string(), wait: z.boolean().optional(), namespace: ns },
    },
    ({ id, text, wait, namespace }) =>
      guard(() => {
        const s = ctx.clientFor(namespace).sessions;
        return wait ? s.sendMessageAndWait(id, text) : s.sendMessage(id, text);
      }),
  );

  server.registerTool(
    "glorp_session_result",
    {
      title: "Session result",
      description: "Fetch the latest agent answer + run status without re-prompting.",
      inputSchema: { id: z.string(), namespace: ns },
    },
    ({ id, namespace }) => guard(() => ctx.clientFor(namespace).sessions.result(id)),
  );

  server.registerTool(
    "glorp_abort_session",
    { title: "Abort session", description: "Abort the running turn.", inputSchema: { id: z.string(), namespace: ns } },
    ({ id, namespace }) => guard(() => ctx.clientFor(namespace).sessions.abort(id)),
  );

  server.registerTool(
    "glorp_destroy_session",
    {
      title: "Destroy session",
      description: "Destroy a session; `cleanupWorkspace` also removes its sandbox (guarded).",
      inputSchema: { id: z.string(), cleanupWorkspace: z.boolean().optional(), namespace: ns },
    },
    ({ id, cleanupWorkspace, namespace }) =>
      guard(() => ctx.clientFor(namespace).sessions.destroy(id, cleanupWorkspace ?? false)),
  );
}
