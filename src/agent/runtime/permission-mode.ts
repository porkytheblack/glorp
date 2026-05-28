/**
 * Permission modes control how tool-execution prompts are handled.
 *
 *   "normal"  — every gated tool asks the user for approval (default)
 *   "auto"    — auto-approve safe operations; escalate destructive + interactive
 *   "bypass"  — auto-approve everything; zero permission prompts
 *
 * Both "auto" and "bypass" still honour the hard-block tier in command-guard
 * (rm -rf /, sudo, etc.) — those are refused inside the tool, not via the
 * display manager gate.
 */

import type {
  DisplayManagerAdapter, Renderer, Slot, ListenerFn,
} from "glove-core/display-manager";

export type PermissionMode = "normal" | "auto" | "bypass";

const MODES: PermissionMode[] = ["normal", "auto", "bypass"];

/** Cycle to the next permission mode in order. */
export function nextPermissionMode(current: PermissionMode): PermissionMode {
  return MODES[(MODES.indexOf(current) + 1) % MODES.length]!;
}

/**
 * Mutable display-manager wrapper that enforces the active permission mode.
 * Mode can be changed at runtime — takes effect on the next pushAndWait call.
 */
export class PermissionDM implements DisplayManagerAdapter {
  private _mode: PermissionMode;
  constructor(private inner: DisplayManagerAdapter, mode: PermissionMode) {
    this._mode = mode;
  }

  get mode() { return this._mode; }
  set mode(m: PermissionMode) { this._mode = m; }

  // ── Delegation ────────────────────────────────────────────────
  get renderers() { return this.inner.renderers; }
  set renderers(v) { this.inner.renderers = v; }
  get stack() { return this.inner.stack; }
  set stack(v) { this.inner.stack = v; }
  get listeners() { return this.inner.listeners; }
  set listeners(v) { this.inner.listeners = v; }
  get resolverStore() { return this.inner.resolverStore; }
  set resolverStore(v) { this.inner.resolverStore = v; }

  registerRenderer<I, O>(r: Renderer<I, O>) { this.inner.registerRenderer(r); }
  pushAndForget<I>(s: Omit<Slot<I>, "id">) { return this.inner.pushAndForget(s); }
  async notify() { return this.inner.notify(); }
  subscribe(l: ListenerFn) { return this.inner.subscribe(l); }
  resolve<O>(id: string, v: O) { this.inner.resolve(id, v); }
  reject(id: string, e: any) { this.inner.reject(id, e); }
  removeSlot(id: string) { this.inner.removeSlot(id); }
  clearStack() { return this.inner.clearStack(); }

  // ── Interception ──────────────────────────────────────────────
  async pushAndWait<I, O>(slot: Omit<Slot<I>, "id">): Promise<O> {
    if (this._mode === "normal") return this.inner.pushAndWait(slot);
    const renderer = (slot as any).renderer as string | undefined;

    if (this._mode === "bypass") {
      if (renderer === "permission_request") return true as O;
      if (renderer === "confirm") return true as O;
      if (renderer === "info") return undefined as O;
      return this.inner.pushAndWait(slot);
    }

    // auto mode — approve safe ops, escalate dangerous + interactive
    if (renderer === "permission_request") return true as O;
    if (renderer === "confirm") {
      const input = (slot as any).input as { danger?: boolean } | undefined;
      if (!input?.danger) return true as O;
      return this.inner.pushAndWait(slot);
    }
    return this.inner.pushAndWait(slot);
  }
}
