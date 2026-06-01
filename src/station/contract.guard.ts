/**
 * Compile-time guard: the self-contained wire DTOs in `contract.ts` must stay
 * structurally identical to the canonical types in `types.ts` (and the shared
 * `PermissionMode`). This file is never imported at runtime — it exists purely
 * so `tsc` fails if the two drift. (BridgeEvent/EventEnvelope are intentionally
 * a curated open union in the contract, so they are not asserted here.)
 */

import type * as C from "./contract.ts";
import type * as T from "./types.ts";
import type { PermissionMode } from "../agent/runtime/permission-mode.ts";

/** `true` when A and B are mutually assignable, else `never`. */
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

// Each entry must be `true`; if a DTO drifts, its `Equal<>` becomes `never`
// and assigning `true` to it is a compile error.
const _assertions: [
  Equal<C.PermissionMode, PermissionMode>,
  Equal<C.SessionLifecycle, T.SessionLifecycle>,
  Equal<C.SessionCredential, T.SessionCredential>,
  Equal<C.WorkspaceDto, T.WorkspaceDto>,
  Equal<C.CreateWorkspaceInput, T.CreateWorkspaceInput>,
  Equal<C.CreateSessionInput, T.CreateSessionInput>,
  Equal<C.SessionDto, T.SessionDto>,
] = [true, true, true, true, true, true, true];

void _assertions;
