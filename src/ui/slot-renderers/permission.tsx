import React from "react";
import { PermissionPrompt } from "../permission-prompt.tsx";
import type { SlotRendererProps } from "./registry.tsx";
import type { PermissionRequest } from "../../shared/events.ts";

/**
 * Wraps the existing PermissionPrompt overlay as a slot renderer so it
 * fits the same plug-in registry as confirm/info/select_one. Glove's
 * executor pushes `permission_request` slots whenever a tool with
 * `requiresPermission: true` needs consent.
 */
export function PermissionSlot({ slot, onResolve }: SlotRendererProps) {
  const input = slot.input as { toolName?: string; toolInput?: unknown };
  const request: PermissionRequest = {
    slotId: slot.slotId,
    toolName: input.toolName ?? "(unknown)",
    toolInput: input.toolInput,
    createdAt: slot.createdAt,
  };
  return <PermissionPrompt request={request} onResolve={(allow) => onResolve(allow)} />;
}
