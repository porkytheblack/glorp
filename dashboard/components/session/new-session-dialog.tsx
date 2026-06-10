"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { launchSession } from "@/lib/launch";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Spinner } from "@/components/shared";
import type { WorkspaceDto, ProfileDto } from "@/lib/types";

const DEFAULT_WS = "__default__";
const DEFAULT_MODEL = "__default__";

export function NewSessionDialog({ workspaces, profiles }: { workspaces: WorkspaceDto[]; profiles: ProfileDto[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [prompt, setPrompt] = React.useState("");
  const [ws, setWs] = React.useState(DEFAULT_WS);
  const [profile, setProfile] = React.useState(DEFAULT_MODEL);
  const [mode, setMode] = React.useState("normal");
  const [busy, setBusy] = React.useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const id = await launchSession({
        prompt: prompt.trim() || undefined,
        workspaceId: ws === DEFAULT_WS ? undefined : ws,
        profileId: profile === DEFAULT_MODEL ? undefined : profile,
        permissionMode: mode,
      });
      router.push(`/sessions/${id}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start the session");
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus /> New session
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New session</DialogTitle>
          <DialogDescription>Put an agent to work in a workspace. You can send the first instruction now or later.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 py-1">
          <div className="flex flex-col gap-2">
            <Label>First message <span className="font-normal text-faint">(optional)</span></Label>
            <Textarea
              autoFocus
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Add rate limiting to the API routes and write a test."
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label>Workspace</Label>
              <Select value={ws} onValueChange={setWs}>
                <SelectTrigger>
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
            </div>
            <div className="flex flex-col gap-2">
              <Label>Model</Label>
              <Select value={profile} onValueChange={setProfile}>
                <SelectTrigger>
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
          </div>
          <div className="flex flex-col gap-2">
            <Label>Permission mode</Label>
            <Select value={mode} onValueChange={setMode}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="normal">Normal — prompt for risky tools</SelectItem>
                <SelectItem value="auto">Auto — auto-approve</SelectItem>
                <SelectItem value="bypass">Bypass — no prompts</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="mt-1">
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={create} disabled={busy}>
            {busy ? <Spinner /> : <Plus />} Start session
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
