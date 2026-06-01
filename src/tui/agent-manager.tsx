/**
 * Agent manager overlay — a roster of conversational agents you can switch
 * the live chat to, plus add/remove. Opened via Ctrl+A.
 *
 * Two modes (one MenuList mounted at a time so keyboard never conflicts):
 *  - roster: switch / remove / jump to add
 *  - adding: pick a role for a new agent
 */

import React, { useState } from "react";
import { useTerminalDimensions } from "@opentui/react";
import { theme } from "./theme.ts";
import { OverlayHost, OverlayPanel } from "./overlay-host.tsx";
import { MenuList, type MenuItem } from "./components/menu/menu-list.tsx";
import type { AgentInfo } from "../shared/events.ts";
import type { UiState } from "./store-reducer.ts";
import type { GlorpClient } from "../client/client.ts";

interface Props {
  client: GlorpClient;
  state: UiState;
  onClose: () => void;
}

const ROLES = [
  { id: "general", label: "general assistant", hint: "full glorp persona" },
  { id: "researcher", label: "researcher", hint: "explores & explains the codebase" },
  { id: "reviewer", label: "reviewer", hint: "reviews diffs & finds bugs" },
  { id: "planner", label: "planner", hint: "breaks work into a plan" },
  { id: "builder", label: "builder", hint: "implements changes end-to-end" },
];

export function AgentManager({ client, state, onClose }: Props) {
  const { width, height } = useTerminalDimensions();
  const [adding, setAdding] = useState(false);

  const panelW = Math.min(86, Math.max(50, width - 8));
  const listW = panelW - 4;

  if (adding) {
    const items: MenuItem[] = ROLES.map((r) => ({
      id: r.id,
      label: r.label,
      hint: r.hint,
      icon: "+",
      keywords: [r.id],
    }));
    return (
      <OverlayHost width={width} height={height}>
        <OverlayPanel
          title="agents · add"
          titleColor={theme.agent}
          subtitle="pick a role"
          borderColor={theme.agent}
          width={panelW}
        >
          <MenuList
            items={items}
            width={listW}
            placeholder="add agent…"
            accentColor={theme.agent}
            emptyText="no roles"
            onSubmit={(item) => { client.addAgent(item.id); onClose(); }}
            onClose={() => setAdding(false)}
          />
        </OverlayPanel>
      </OverlayHost>
    );
  }

  const items: MenuItem[] = state.agents.map((a) => toRosterItem(a, state.activeAgentId));
  const count = state.agents.length;

  return (
    <OverlayHost width={width} height={height}>
      <OverlayPanel
        title="agents"
        titleColor={theme.agent}
        subtitle={`${count} agent${count !== 1 ? "s" : ""}`}
        borderColor={theme.agent}
        width={panelW}
      >
        <MenuList
          items={items}
          width={listW}
          placeholder="switch agent…"
          accentColor={theme.agent}
          emptyText="no agents"
          onSubmit={(item) => {
            if (item.id !== state.activeAgentId) client.switchAgent(item.id);
            onClose();
          }}
          onClose={onClose}
          actions={[
            {
              key: "x",
              label: "remove",
              run: (item) => {
                if (item && item.id !== "main" && item.id !== state.activeAgentId) {
                  client.removeAgent(item.id);
                }
              },
            },
            { key: "a", label: "add agent", run: () => setAdding(true) },
          ]}
        />
      </OverlayPanel>
    </OverlayHost>
  );
}

function toRosterItem(a: AgentInfo, activeId: string): MenuItem {
  const isActive = a.id === activeId;
  const icon = a.busy ? "◌" : isActive ? "●" : "○";
  const tags = [a.role];
  if (isActive) tags.push("active");
  if (a.turnCount > 0) tags.push(`${a.turnCount} turn${a.turnCount === 1 ? "" : "s"}`);
  return {
    id: a.id,
    label: a.label,
    icon,
    detail: tags.join(" · "),
    accent: isActive ? theme.agent : undefined,
    keywords: [a.role],
  };
}
