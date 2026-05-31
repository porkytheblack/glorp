/**
 * The compact selector row for the new-chat compose screen: workspace, work
 * mode, model profile, and setup template — each a frosted shadcn Select chip.
 * Owned by NewChatScreen (which holds the ChatConfig state) so this stays a thin
 * presentational piece.
 */

import { FolderGit2, ShieldCheck, Cpu, Layers } from "lucide-react";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select.tsx";
import type { ProfileSummary, TemplateSummary } from "../api/client.ts";
import type { WorkspaceGroup } from "../state/useWorkspaces.ts";

export type PermMode = "normal" | "auto" | "bypass";

export interface ChatConfig {
  workspaceId: string;
  mode: PermMode;
  profileId: string;
  template: string;
}

const MODES: { value: PermMode; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "auto", label: "Auto-review" },
  { value: "bypass", label: "Full access" },
];

const chipTrigger = "h-8 w-auto gap-1.5 rounded-full px-3 text-[12px] text-glorp-muted";

export function NewChatConfig(p: {
  groups: WorkspaceGroup[];
  profiles: ProfileSummary[];
  templates: TemplateSummary[];
  value: ChatConfig;
  onChange: (next: ChatConfig) => void;
}) {
  const v = p.value;
  const set = (patch: Partial<ChatConfig>) => p.onChange({ ...v, ...patch });

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Select value={v.workspaceId} onValueChange={(x) => set({ workspaceId: x })}>
        <SelectTrigger className={chipTrigger}>
          <FolderGit2 className="text-glorp-muted" />
          <SelectValue placeholder="Workspace" />
        </SelectTrigger>
        <SelectContent>
          {p.groups.map((g) => (
            <SelectItem key={g.workspace.id} value={g.workspace.id}>
              {g.workspace.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={v.mode} onValueChange={(x) => set({ mode: x as PermMode })}>
        <SelectTrigger className={chipTrigger}>
          <ShieldCheck className="text-glorp-muted" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MODES.map((m) => (
            <SelectItem key={m.value} value={m.value}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={v.profileId || "__default__"}
        onValueChange={(x) => set({ profileId: x === "__default__" ? "" : x })}
      >
        <SelectTrigger className={chipTrigger}>
          <Cpu className="text-glorp-muted" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__default__">Station default</SelectItem>
          {p.profiles.map((pr) => (
            <SelectItem key={pr.id} value={pr.id}>
              {pr.label} · {pr.model}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {p.templates.length > 0 && (
        <Select
          value={v.template || "__none__"}
          onValueChange={(x) => set({ template: x === "__none__" ? "" : x })}
        >
          <SelectTrigger className={chipTrigger}>
            <Layers className="text-glorp-muted" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">No template</SelectItem>
            {p.templates.map((t) => (
              <SelectItem key={t.name} value={t.name}>
                {t.name} · {t.step_count} steps
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
