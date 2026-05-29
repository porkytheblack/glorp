export interface Keybind {
  key: string;
  label: string;
  description: string;
  context: "global" | "input" | "overlay" | "permission";
}

export const KEYBINDS: Keybind[] = [
  { key: "ctrl+k", label: "^K", description: "Command palette", context: "global" },
  { key: "ctrl+a", label: "^A", description: "Agents · switch / add", context: "global" },
  { key: "ctrl+m", label: "^M", description: "Model switcher", context: "global" },
  { key: "ctrl+s", label: "^S", description: "Session picker", context: "global" },
  { key: "ctrl+b", label: "^B", description: "Toggle context rail", context: "global" },
  { key: "ctrl+t", label: "^T", description: "Transmissions log", context: "global" },
  { key: "ctrl+p", label: "^P", description: "Permissions list", context: "global" },
  { key: "ctrl+y", label: "^Y", description: "Cycle permission mode", context: "global" },
  { key: "ctrl+?", label: "^?", description: "Help dialog", context: "global" },
  { key: "ctrl+r", label: "^R", description: "Toggle reasoning", context: "global" },
  { key: "ctrl+c", label: "^C", description: "Abort / clear / quit", context: "global" },
  { key: "escape", label: "Esc", description: "Close overlay or abort", context: "global" },
  { key: "ctrl+up", label: "^Up", description: "Scroll transcript up", context: "input" },
  { key: "ctrl+down", label: "^Down", description: "Scroll transcript down", context: "input" },
  { key: "enter", label: "Enter", description: "Send message", context: "input" },
  { key: "shift+enter", label: "S-Enter", description: "Insert newline", context: "input" },
  { key: "tab", label: "Tab", description: "Complete hint", context: "input" },
  { key: "up", label: "Up", description: "History / menu nav", context: "input" },
  { key: "down", label: "Down", description: "History / menu nav", context: "input" },
  { key: "y", label: "y", description: "Allow permission", context: "permission" },
  { key: "n", label: "n", description: "Deny permission", context: "permission" },
  { key: "escape", label: "Esc", description: "Cancel / close", context: "overlay" },
  { key: "up", label: "Up", description: "Navigate list", context: "overlay" },
  { key: "down", label: "Down", description: "Navigate list", context: "overlay" },
  { key: "enter", label: "Enter", description: "Select / confirm", context: "overlay" },
];

export function matchKeybind(
  input: { name?: string; ctrl?: boolean; shift?: boolean },
  context: Keybind["context"],
): Keybind | null {
  const keyStr = buildKeyString(input);
  return KEYBINDS.find((kb) => kb.key === keyStr && kb.context === context) ?? null;
}

function buildKeyString(input: { name?: string; ctrl?: boolean; shift?: boolean }): string {
  const parts: string[] = [];
  if (input.ctrl) parts.push("ctrl");
  if (input.shift) parts.push("shift");
  parts.push(input.name ?? "");
  return parts.join("+");
}

export function keybindsForContext(context: Keybind["context"]): Keybind[] {
  return KEYBINDS.filter((kb) => kb.context === context);
}
