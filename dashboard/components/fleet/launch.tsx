"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Cpu, FolderGit2, SendHorizontal } from "lucide-react";
import { toast } from "sonner";
import { launchSession } from "@/lib/launch";
import { Spinner } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import type { WorkspaceDto, ProfileDto } from "@/lib/types";

const DEFAULT_WS = "__default__";
const DEFAULT_MODEL = "__default__";

/** The hero: describe a task, pick where it runs, launch an agent. */
export function LaunchComposer({ workspaces, profiles }: { workspaces: WorkspaceDto[]; profiles: ProfileDto[] }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [ws, setWs] = useState(DEFAULT_WS);
  const [profile, setProfile] = useState(DEFAULT_MODEL);
  const [busy, setBusy] = useState(false);

  const launch = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    try {
      const id = await launchSession({
        prompt,
        workspaceId: ws === DEFAULT_WS ? undefined : ws,
        profileId: profile === DEFAULT_MODEL ? undefined : profile,
      });
      router.push(`/sessions/${id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the session");
      setBusy(false);
    }
  };

  return (
    <section>
      <h1 className="text-display text-center">What should Glorp build?</h1>
      <p className="mx-auto mt-2.5 max-w-md text-center text-[13.5px] leading-relaxed text-muted-foreground">
        Describe a task to launch an agent in a sandboxed workspace, or jump back into a running session below.
      </p>

      <div className="group mt-7 rounded-xl border border-border bg-card p-2.5 shadow-card transition-shadow focus-within:border-brand/40 focus-within:shadow-glow">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) launch();
          }}
          placeholder="e.g. Add rate limiting to the API routes and write a test for it."
          className="min-h-[88px] w-full resize-none bg-transparent px-2.5 py-2 text-[14px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60"
        />
        <div className="flex items-center justify-between gap-2 border-t border-border/70 pt-2.5">
          <div className="flex items-center gap-2">
            <Select value={ws} onValueChange={setWs}>
              <SelectTrigger className="h-8 w-[188px] text-[13px]">
                <FolderGit2 className="size-3.5 shrink-0 text-faint" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_WS}>Default workspace</SelectItem>
                {workspaces.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={profile} onValueChange={setProfile}>
              <SelectTrigger className="h-8 w-[168px] text-[13px]">
                <Cpu className="size-3.5 shrink-0 text-faint" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_MODEL}>Default model</SelectItem>
                {profiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={launch} disabled={busy || !prompt.trim()}>
            {busy ? <Spinner /> : <SendHorizontal />} Launch
          </Button>
        </div>
      </div>
      <p className="mt-2.5 text-center text-[11.5px] text-faint">
        <kbd className="rounded border border-border bg-surface-2 px-1 py-0.5 font-mono text-[10px]">⌘</kbd>{" "}
        <kbd className="rounded border border-border bg-surface-2 px-1 py-0.5 font-mono text-[10px]">↵</kbd> to launch
      </p>
    </section>
  );
}
