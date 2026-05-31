/**
 * Full-screen, compose-first "new chat" (Codex-style): a centered hero prompt +
 * a frosted compose box, with workspace / mode / model / template as shadcn
 * Select chips. Typing the first prompt creates the session in the chosen
 * workspace, sends the message, and hands off to the chat view. "Start blank
 * chat" creates a session without a first message.
 */

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, FolderGit2 } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { api, type CreateSessionBody, type ProfileSummary, type TemplateSummary } from "../api/client.ts";
import type { WorkspacesController } from "../state/useWorkspaces.ts";
import { NewChatConfig, type ChatConfig } from "./NewChatConfig.tsx";

export interface NewChatScreenProps {
  ws: WorkspacesController;
  initialWorkspaceId: string | null;
  onCreated: (sessionId: string) => void;
  onNewWorkspace: () => void;
}

export function NewChatScreen(p: NewChatScreenProps) {
  const [config, setConfig] = useState<ChatConfig>({ workspaceId: "", mode: "auto", profileId: "", template: "" });
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setConfig((c) => ({ ...c, workspaceId: p.initialWorkspaceId ?? p.ws.groups[0]?.workspace.id ?? "" }));
    void api.profiles().then((r) => setProfiles(r.profiles)).catch(() => {});
    void api.templates().then((r) => setTemplates(r.templates)).catch(() => {});
  }, [p.initialWorkspaceId, p.ws.groups]);

  const wsName = p.ws.groups.find((g) => g.workspace.id === config.workspaceId)?.workspace.name ?? null;

  const create = async (firstMessage: string) => {
    if (!config.workspaceId || pending) return;
    setPending(true);
    setError(null);
    const body: CreateSessionBody = {
      permissionMode: config.mode,
      ...(config.profileId ? { profileId: config.profileId } : {}),
      ...(config.template ? { template: config.template } : {}),
    };
    try {
      const s = await api.createSessionInWorkspace(config.workspaceId, body);
      p.ws.refresh();
      const t = firstMessage.trim();
      if (t) await api.sendMessage(s.id, t).catch(() => {});
      p.onCreated(s.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPending(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (text.trim()) void create(text);
    }
  };

  if (p.ws.groups.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <FolderGit2 size={28} className="text-glorp-muted" strokeWidth={1.5} />
        <p className="max-w-sm text-[14px] text-glorp-muted">
          Add a workspace to start a chat — point Glorp at a folder on the host.
        </p>
        <Button onClick={p.onNewWorkspace}>Add a workspace</Button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-6 overflow-y-auto px-6 py-10">
      <h1 className="text-center text-[26px] font-medium tracking-tight text-glorp-text">
        What should we build{wsName ? ` in ${wsName}` : ""}?
      </h1>

      <div className="w-full max-w-2xl space-y-3">
        <div className="glass-strong flex items-end gap-2 rounded-2xl border border-glorp-border px-3 py-2.5 focus-within:border-glorp-border-active">
          <textarea
            ref={taRef}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder="Describe what you want to build…"
            className="max-h-48 flex-1 resize-none bg-transparent leading-relaxed text-glorp-text outline-none placeholder:text-glorp-muted"
          />
          <button
            onClick={() => text.trim() && void create(text)}
            disabled={!text.trim() || pending}
            title="Start chat"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-glorp-accent text-white hover:bg-glorp-accent-dim disabled:opacity-40"
          >
            {pending ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={18} strokeWidth={2.5} />}
          </button>
        </div>

        <NewChatConfig
          groups={p.ws.groups}
          profiles={profiles}
          templates={templates}
          value={config}
          onChange={setConfig}
        />

        {error && <p className="text-center text-[13px] text-glorp-error">{error}</p>}

        <div className="text-center">
          <button
            onClick={() => void create("")}
            disabled={pending}
            className="text-[12px] text-glorp-muted hover:text-glorp-text disabled:opacity-50"
          >
            Start blank chat
          </button>
        </div>
      </div>
    </div>
  );
}
