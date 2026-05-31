/**
 * Permissions modal (TUI parity). Lists the session's permission grants (key +
 * status) and lets you revoke each one (with a confirm), refreshing the list
 * from the API afterwards. Shows an empty state when nothing is granted.
 */

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog.tsx";
import { api, type PermissionGrant } from "../api/client.ts";

export interface PermissionsProps {
  sessionId: string;
  onClose: () => void;
}

export function Permissions(p: PermissionsProps) {
  const [grants, setGrants] = useState<PermissionGrant[]>([]);
  const [busy, setBusy] = useState(false);

  const load = () => {
    void api.permissions(p.sessionId).then((r) => setGrants(r.permissions)).catch(() => {});
  };
  useEffect(load, [p.sessionId]);

  const revoke = (g: PermissionGrant) => {
    if (!window.confirm(`Revoke permission "${g.key}"?`)) return;
    setBusy(true);
    void api
      .revokePermission(p.sessionId, g.key)
      .then(load)
      .catch((e) => window.alert(String(e)))
      .finally(() => setBusy(false));
  };

  return (
    <Dialog open onOpenChange={(o) => !o && p.onClose()}>
      <DialogContent className="max-w-md gap-4">
        <DialogHeader>
          <DialogTitle>Permissions</DialogTitle>
        </DialogHeader>

        <section className="space-y-1">
          {grants.length === 0 ? (
            <p className="px-2.5 py-6 text-center text-[13px] text-glorp-muted">No permissions granted.</p>
          ) : (
            grants.map((g) => (
              <div key={g.key} className="flex items-center gap-2 rounded-md px-2.5 py-2 hover:bg-glorp-surface-2">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-mono text-[12px] text-glorp-text">{g.key}</span>
                  <span className="text-[12px] text-glorp-muted">{g.status}</span>
                </span>
                <button
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-glorp-muted hover:bg-glorp-surface-2 hover:text-glorp-error disabled:opacity-40"
                  title="Revoke"
                  disabled={busy}
                  onClick={() => revoke(g)}
                >
                  <Trash2 size={16} className="shrink-0" />
                </button>
              </div>
            ))
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
