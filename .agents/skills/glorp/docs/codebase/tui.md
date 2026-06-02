# TUI Frontend

The terminal UI is Glorp's interactive frontend, built with [`@opentui/react`](https://github.com/anomalyco/opentui) — a React reconciler that renders to the terminal using JSX intrinsics like `<box>`, `<text>`, `<scrollbox>`, `<textarea>`, and `<ascii-font>`. It presents the chat transcript, live tool-call cards, a context sidebar, an input bar with slash/`@`/`$` autocomplete, and a stack of full-screen overlays (model switcher, session picker, command palette, etc.).

## Two frontends: `src/tui/` (active) vs `src/ui/` (legacy)

There are two parallel implementations of the same UI. They share the wire types in `src/shared/` and an almost-identical reducer shape, but differ in how they talk to the agent:

| | `src/tui/` (current) | `src/ui/` (legacy) |
|---|---|---|
| Transport | A `GlorpClient` (WebSocket to a local server) | The in-process `Bridge` pub/sub |
| Mounted by | `src/cli-tui.ts` → `import("./tui/app.tsx")` (`src/cli-tui.ts:92`) | not mounted as the main app |
| Sidebar component | `ContextRail` (`src/tui/components/context-rail.tsx`) | `Sidebar` (`src/ui/components/sidebar.tsx`) |
| Bottom chrome | `StatusBar` (top) + `ChromeBar` (bottom keyhint row) | `StatusBar` + footer path line |
| Overlays | model, session, transmissions, permissions, help, agents, command palette | model, session, transmissions, permissions |

`src/cli-tui.ts` is the live entrypoint and lazily imports `./tui/app.tsx` (`src/cli-tui.ts:92`); it still pulls `Onboarding` from `src/ui/onboarding.tsx` (`src/cli-tui.ts:111`). The README "Layout" section documents the older `src/ui/` tree (`app.tsx`, `store.ts`, `sidebar.tsx`, etc.); the `src/tui/` tree is the evolved version that runs against the server protocol. This document covers `src/tui/` as the primary surface and notes `src/ui/` where it diverges.

## Communication: wire types and the bridge

### Wire event types — `src/shared/events.ts`

This module is the contract between the agent half and the UI half (both originally ran on the same Bun thread; the `src/tui/` path now relays the same shapes over a server). Key types:

- `ToolEvent` (`src/shared/events.ts:8`) — a single tool invocation: `id`, `name`, `input`, `status` (`"running" | "success" | "error" | "aborted"`, `ToolStatus` at `:6`), `output`, `renderData` (used for mini-diffs), and timestamps.
- `ChatTurn` (`src/shared/events.ts:19`) — one transcript row: `kind` is `"user" | "agent" | "tool" | "system" | "transmission"`, with optional `text`, `reasoning`, `tool`, and `meta`.
- `TaskItem` (`:29`), `PlanDocument` (`:36`), `InboxEntry` (`:43`) — sidebar data.
- `OrchestratorPhase` (`:54`), `OrchestratorAgentEvent` (`:62`) — orchestrator/loop state.
- `AgentInfo` (`:75`) / `AgentStats` (`:86`) / `RunnerAgentStats` (`:93`) — conversational-agent roster and per-agent stats.
- `DisplaySlotEvent` (`:103`) — a UI "slot" the agent pushes and (optionally) waits on: `slotId`, `renderer` name, `input`, and `isPermissionRequest`.
- `BridgeEvent` (`:111`) — the discriminated union of every message the agent emits to the UI: `session_hydrate`, `turn`, `turn_update`, `text_delta`, `text_clear`, `tool_started`, `tool_finished`, `busy`, `plan`, `tasks`, `inbox`, the `orchestrator_*` family, `agent_roster`, `stats`, `compaction`, `subagent`, `transmission`, `error`, `hook`, `skill`, `display_slot_pushed`, `display_slot_resolved`, `permission_mode_changed`, and `session_reset`.
- `BridgeListener` (`:159`) — `(event: BridgeEvent) => void`.
- `PermissionRequest` (`:152`) is deprecated, superseded by `DisplaySlotEvent` + `isPermissionRequest`.

### The bridge — `src/shared/bridge.ts`

`Bridge` (`src/shared/bridge.ts:7`) is a tiny synchronous pub/sub: `subscribe(fn)` returns an unsubscribe closure (`:10`), and `emit(event)` fans out to every listener, swallowing listener exceptions so a UI handler can't crash the agent (`:17`). `getBridge()` (`:31`) returns a lazily-created process-global singleton. The legacy `src/ui/store.ts` subscribes to this directly; the active `src/tui/` path subscribes through `GlorpClient` instead and converts server messages into `BridgeEvent`s via `serverMessageToBridgeEvent` (`src/client/bridge-adapter.ts`), so the same reducer works unchanged.

### Version — `src/shared/version.ts`

Exports `GLORP_VERSION` (`"0.1.0"`), `GLORP_CODENAME` (`"First-Contact"`), and `GLORP_BUILD` (from `process.env.GLORP_BUILD`, default `"dev"`).

## State model — `src/tui/store.ts` + `src/tui/store-reducer.ts`

State lives in a single `useReducer`. `useUiState(client)` (`src/tui/store.ts:49`) initializes `reduceUiState`/`initialUiState` and, in an effect, subscribes to the `GlorpClient`. Each incoming server message is run through `serverMessageToBridgeEvent` and then `bridgeEventToAction` (`src/tui/store.ts:9`) to map a `BridgeEvent` to a `UiAction`, which is dispatched through a ref (`dispatchRef`) so the subscription never needs to re-bind. The same effect also handles transport-only messages directly: `peer_joined`/`peer_left` → `peer_count`, `model_label_changed` → `model_label_changed`, and `server_hello` (which seeds peer count, model label, and permission mode) (`src/tui/store.ts:61`).

`UiState` (`src/tui/store-reducer.ts:6`) holds: `turns`, `title`, `streamingText`, `busy`, `plan`, `tasks`, `inbox`, `orchestratorAgents`, the conversational `agents` roster + `activeAgentId`, loop state (`loopPhase`, `loopId`, `loopVerdicts`, `foregroundAgent`, `planStatus`), `stats`, `compacting`, `activeSubagents`, `transmissions`, `lastExtension`, `runnerStats`, `displaySlots`, `lastError`, a derived `mood`, `peerCount`, `modelLabel`, and `permissionMode`. `reduceUiState` (`:80`) is a pure switch over `UiAction`; notable behaviors:

- `tool_started` appends a synthetic `tool`-kind turn keyed `t_<id>` (`:96`); `tool_finished` patches the matching turn's `tool` in place (`:98`).
- `text_delta` accumulates into `streamingText` (`:92`); `text_clear` resets it (`:94`). The streaming buffer is rendered as a live row and folded into a real `agent` turn by the agent side.
- `orchestrator_verdict` and `orchestrator_plan_event` both push a synthetic `system` turn tagged `meta.orchestrator` via `orchTurn` (`:160`), so loop activity appears inline in the transcript.
- `subagent` maintains `activeSubagents` as a multiset, removing the last occurrence on `end` (`:133`).
- `transmission` appends to a ring buffer capped at the last 40 (`:135`); `orchestratorAgents` is upserted and capped via `upsertAgent` (`:175`).
- `session_reset` resets to `initialUiState` but preserves `transmissions`, `peerCount`, and `modelLabel` (`:145`).
- After every action the reducer recomputes `mood` via `moodFrom` (`:164`): `error` if there's a `lastError`, `working` while generating/evaluating/with subagents/spawned agents, `speaking` when busy with streaming text, `working` when merely busy, `glitched` briefly after a recent high-severity transmission, else `idle`.

The legacy `src/ui/store.ts` is the same reducer driven straight off `getBridge().subscribe` with an inline `switch` (`src/ui/store.ts:8`).

## Root layout — `src/tui/app.tsx`

`App` (`src/tui/app.tsx:30`) takes a `client: GlorpClient`, `workspace`, `onQuit`, and optional `onSwapSession`. It reads terminal size with `useTerminalDimensions` and the reducer state with `useUiState(client)`. Local UI state covers the current `overlay`, `inputHeight`, `showReasoning`, `railOpen`, `scrollDelta` (keyboard scroll), and the client connection state (`connState`, tracked via `client.onStateChange`).

### Rendering order / branching

`App` returns one of several screens, checked in order:

1. **Non-permission display slot** (`src/tui/app.tsx:132`) — if a slot exists that is not a permission request, it renders full-screen via the registry (`getSlotRenderer(slot.renderer) ?? UnknownSlot`), wiring `onResolve`/`onReject` to the client.
2. **Overlay** (`:143`) — `palette`, `model`, `session`, `transmissions`, `permissions`, `help`, or `agents`, each a dedicated full-screen component.
3. **Empty state** (`:177`) — when there are no turns and no streaming text, renders `EmptyHero` (the pre-chat landing screen).
4. **Main split-pane layout** (`:196`).

### Pane arrangement

The main layout (`src/tui/app.tsx:196`) is a vertical `<box>` of full terminal size:

- **`StatusBar`** at the top (1 row).
- A middle **`<box flexDirection="row">`** containing the **`Transcript`** (width `mainW`) and, when it fits and is open, the **`ContextRail`** sidebar.
- **`InputBar`** below.
- **`ChromeBar`** at the very bottom (1 row of keyhints).

Width breakpoints `NARROW=90`, `MEDIUM=140`, `WIDE=200` (`:22`) drive the rail width (`32`/`28`/`20`, or `0` when collapsed or the terminal is narrower than `NARROW`) (`:187`). Transcript height is `height − statusH − inputH − chromeH`, with input height clamped to `[4, height−4]` (`:193`).

### Keyboard

`useKeyboard` (`src/tui/app.tsx:60`) handles, in priority order: abort while busy (Ctrl+C / `\x03`), inline permission `y/a` (allow) `n/d` (deny) `esc` (cancel) when a permission slot is pending and no overlay is open, then (if no overlay/slot owns it) the global shortcuts — `^K` palette, `^A` agents, `^M` model, `^S` session, `^T` transmissions, `^P` permissions, `^Y` cycle permission mode (via `nextPermissionMode`), `^R` reasoning toggle, `^B` rail toggle, `^?`/`^/` help, `^Up`/`^Down` scroll, and `esc` to abort. The bottom `ChromeBar` documents the same chord set.

### Command palette commands

The `commands` memo (`src/tui/app.tsx:101`) builds the `^K` palette: manage agents, switch-to-each-non-active-agent, add an agent for each `QUICK_ADD_ROLES` (`researcher`, `reviewer`, `planner`, `builder`, `:28`), plus switch model, cycle/manage permissions, toggle rail and reasoning, open transmissions, help, quit, and (when `onSwapSession` is set) switch/new session.

## Components

### Transcript — `src/tui/components/transcript.tsx`

`Transcript` (`:25`) renders the chat history inside a `<scrollbox>`. It maps each `ChatTurn` to a `MessageRow`, appends a `StreamingRow` for in-flight text, renders any pending permission slots inline as `InlineSlot`s, and shows a `ThinkingRow` spinner when `busy && !streamingText`. A 10-frame Braille spinner (`SPINNER`, `:7`) animates at 90ms while busy. Auto-scroll: it stays "pinned" to the bottom as content arrives, but a keyboard `scrollDelta` from the parent un-pins and scrolls manually (`:45`); the scrollbox API is accessed defensively (`scrollTo` or `scrollTop`) and wrapped in try/catch to tolerate API drift. `ThinkingRow` (`:125`) labels the spinner contextually: `<agent> generating…`, `orchestrator evaluating…`, `@sub working…`, or `glorp is thinking…`.

### Message rows — `src/tui/components/message.tsx`

`MessageRow` (`:23`) renders a turn as a two-column row: a 6-wide label gutter (`LABEL`/`LABEL_COLOR` map `you`/`glorp`/`tool`/`sys`/`tx`, `:7`) and the wrapped body. Orchestrator turns (`system` + `meta.orchestrator`) are detected by `isOrchestratorTurn` (`:65`) and rendered by `OrchestratorRow` with an `orch` label. `tool`-kind turns delegate to `ToolCallRow`. Optional reasoning (when `showReasoning`) renders above via `ReasoningRow`, and an image-attachment count (`meta.imageCount`) shows a 📎 badge. `StreamingRow` (`:48`) renders the live `streamingText` with a trailing cursor `▌`.

### Reasoning — `src/tui/components/reasoning-row.tsx`

`ReasoningRow` (`:6`) renders a dimmed reasoning trace between `--- reasoning trace ---` / `--- end reasoning ---` markers, truncating to the first 18 lines (plus a "+N more lines" note) past 20 lines.

### Tool-call cards & mini-diffs — `src/tui/components/tool-call.tsx`

`ToolCallRow` (`:11`) renders a one-line tool summary with a status glyph (spinner while running; `✓`/`✗`/`⊘` otherwise, `GLYPHS`/`COLORS` at `:6`). `summarise` (`:72`) produces human-readable lines per tool (`read path@off+lim`, `write path`, `edit path`, `bash · <desc>`, `glob`, `grep /pat/`, `ls`, `@subagent prompt`, `/skill`, else a JSON-clipped fallback). When the tool is `edit` with `renderData`, `EditDiff` (`:41`) shows up to 3 old lines (red `-`) and 3 new lines (green `+`); for `apply_patch`, `PatchDiff` (`:56`) shows up to 6 added/removed lines parsed from the patch text. Diff colors come from the theme (`diffAdd`/`diffDel`/`diffAddText`/`diffDelText`).

### Sidebar (context rail) — `src/tui/components/context-rail.tsx`

`ContextRail` (`:13`) is the right-hand pane, a stack of compact sections:

- **CTX gauge** (`ContextGauge`, `:38`) — a `[████░░] N%` bar (green/amber/red at 65/85%) plus turn count and `in/out` token totals (`fmtK` k/m formatting).
- **PLAN** (`PlanSection`, `:52`) — plan revision + clipped title, or "PLAN none".
- **TASKS** (`TasksSection`, `:62`) — `open/total`, the top 5 tasks sorted in-progress→pending→completed with `○`/`●`/`✓` marks, "+N more" overflow.
- **AGENTS** (`AgentsSection`, `:82`) — active subagent names (`@name`) and spawned orchestrator agents, the foreground one marked `★`.
- **INBOX** (`InboxSection`, `:104`, only when there are pending entries) — count + blocking count, top 3 tags with `!` for blocking.
- **SIGNALS** (`SignalsSection`, `:120`) — the last 3 transmissions, colored by severity (`sigColor`, `:137`).

Note: the avatar described in the README ("a small ASCII glorp avatar whose mood tracks the agent's state") lives in the theme as `GLORP_AVATARS` and is keyed by the `mood` field; the legacy `src/ui/components/sidebar.tsx` (`Sidebar`, with a collapsed `SidebarStrip`, `:94`) is the bordered-panel variant the README documents (Session/Context/Plan/Tasks/Inbox/Agents/Signals panels).

### Status bar — `src/tui/components/status-bar.tsx`

`StatusBar` (`:11`) is the top row: the `glorp` brand, the active conversational agent (when more than one or non-`main`), a session status badge (`sessionStatus`, `:52` — connection state, error, generating/evaluating, compacting, agents, responding, working, ready), the permission mode badge (`⚡auto`/`⏩bypass` when not normal), the session title, and right-aligned model label + `ctx N%`.

### Chrome bar — `src/tui/components/chrome-bar.tsx`

`ChromeBar` (`:18`) is the bottom keyhint strip: model label, `ctx N%`, peer count (when >1), and the global chord legend (`^?` help, `^A` agents, `^M` model, `^R` reasoning, `^B` rail, `^Y` mode, `^V` paste img). The permission-mode word is colored per `MODE_DISPLAY` (`:12`).

### Input bar — `src/tui/components/input-bar.tsx`

`InputBar` (`:18`) wraps an OpenTUI `<textarea>` (1–8 visible lines, word wrap) with autocomplete, history, and image staging. It tracks `value`/`cursorOffset` by reading the textarea's `plainText`/`editBuffer` and reports its rendered height up to the parent (`onHeightChange`, `:79`).

- **Hint menu**: `findHintToken` (`:190`) detects a trailing `/`, `$`, or `@` token at the cursor and selects the matching pool (`slashCommands`/`skillHints`/`subagentMentions`). `<SlashMenu>` renders the filtered matches; `tab` completes the highlighted entry (`$skill` rewrites to `/skill`), up/down move the selection (`:88`).
- **Submit**: Enter (no shift/ctrl/meta) submits via `performSubmit` (`:54`), which normalizes `$alias`→`/alias`, guards against double-submit, pushes to a 50-entry history, intercepts `/quit`/`/exit` (→ `onQuit`) and `/help`, and forwards text + any staged images.
- **History**: up/down on an empty buffer scroll through prior submissions (`:101`).
- **Images**: via `useImagePaste`; staged images show a `📎N` badge.
- **Variants**: `default` (prompt-glyph row) and `hero` (bordered "Build · model" card used by `EmptyHero`); the border turns amber while busy.

### Slash / skill / subagent menu — `src/tui/components/slash-menu.tsx`

Defines the built-in `SLASH_COMMANDS` (`:11` — `/build`, `/plan`, `/diff`, `/compact`, `/clear`, `/concise`, `/transmissions`, `/help`, `/quit`), `SUBAGENT_MENTIONS` (`:23` — `@planner`/`@researcher`/`@reviewer`), and `SKILL_HINTS` (`:29` — `$concise`). `SlashMenu` (`:33`) renders a bordered, prefix-filtered, scrolling list (8 visible rows, `SLASH_MENU_VISIBLE_ROWS`) with a `tab to complete` header and a highlighted selection.

### Generic menu primitives — `src/tui/components/menu/`

The Helix-style overlays (command palette, agent manager, model switcher, session/help) are built on `MenuList` (`menu-list.tsx:40`): a filterable, keyboard-driven list with `MenuItem`s (icon/label/detail/hint/keywords/group/disabled), custom `MenuAction` footer keys, a scrolling window (`computeWindow`, `:149`), and group headers. Filtering uses `fuzzyFilter` (`menu/fuzzy.ts:65`) — a dependency-free case-insensitive subsequence matcher that scores word-boundary and consecutive-run matches and returns highlight `ranges`. `menu-row.tsx` supplies `FilterInput`, `GroupHeader`, and `MenuRow` presentational pieces.

## Slot renderers — `src/tui/slot-renderers/`

The agent can push a `DisplaySlotEvent` and (for blocking calls) wait on its resolution. `registry.tsx` defines `SlotRendererProps` (`slot`, `onResolve`, `onReject`, `:9`) and a mutable name→component `Map` (`SLOT_RENDERERS`, `:21`) with `registerSlotRenderer`/`getSlotRenderer`. `index.tsx` registers the built-ins on import: `permission_request`→`PermissionSlot`, `confirm`→`ConfirmSlot`, `info`→`InfoSlot`, `select_one`→`SelectOneSlot`, `text_input`→`TextInputSlot`, with `UnknownSlot` as the fallback for unregistered renderer names.

- **`PermissionSlot`** (`permission.tsx:13`) — full-screen "permission requested" panel; `y/a/enter` allow, `n/d` deny, `esc` cancel. In normal operation permissions render *inline* (see below); this is the fallback path.
- **`ConfirmSlot`** — yes/no (optionally `danger`-styled), resolves `true`/`false`.
- **`InfoSlot`** — non-blocking display card, any key dismisses; supports `severity`.
- **`SelectOneSlot`** — pick one option from a list or type a custom answer.
- **`TextInputSlot`** — free-form string; Enter submits, Esc cancels.
- **`UnknownSlot`** — shows raw input; `a` allow, `d`/esc deny.

`InlineSlot` (`src/tui/components/inline-slot.tsx:15`) is the in-transcript permission prompt: a rounded amber box showing the tool name, a clipped input preview (up to 6 lines), and the `y allow · n deny · esc cancel` legend. It is display-only — `App`'s `useKeyboard` owns the actual `y/n/esc` handling (`src/tui/app.tsx:64`).

## Hooks

- **`useUiState`** (`src/tui/store.ts:49`) — the reducer + client subscription described above.
- **`useImagePaste`** (`src/tui/hooks/use-image-paste.ts:23`) — stages images for the next message via two paths: (1) `usePaste` binary paste from terminals that send raw image bytes (sniffing PNG/JPEG/GIF/WebP magic numbers, `detectMime`, `:59`); (2) `Ctrl+V`/`Cmd+V` reading the system clipboard via `readClipboardImage` (`src/tui/clipboard-image.ts`, using `osascript`/`xclip`/`wl-paste`). Images cap at 10MB and are returned base64-encoded with a `media_type`.

## Theme & ASCII art — `src/tui/theme.ts`

`theme` (`:2`) is the palette: a quiet dark chrome (`bg #0b0e14`, panels, borders) plus semantic accents (`accent` mint, `user` blue, `system` amber, `error` red, `success` green, `toolName` violet, diff add/del backgrounds, `transmission` cyan, agent/loop colors, and menu/footer primitives). `BANNER` (`:36`) is a multi-line block-character "GLORP" wordmark. `GLORP_AVATARS` (`:48`) is a record of 3-line ASCII faces keyed by `mood` (`idle`/`thinking`/`working`/`speaking`/`glitched`/`error`) — the avatar that "tracks the agent's state" via the reducer's derived `mood`. (`EmptyHero` renders the brand with OpenTUI's `<ascii-font text="glorp" font="shade">` rather than `BANNER`.)

## Keybind reference — `src/tui/keybinds.ts`

`KEYBINDS` (`:8`) is the declarative list of chords (key, label, description, context: `global`/`input`/`overlay`/`permission`) consumed by the help dialog and as documentation. Helpers: `matchKeybind` (builds a `ctrl+shift+name` string and looks it up by context) and `keybindsForContext`.

## Overlays (full-screen)

Mounted by `App` based on `overlay` state, all built on `MenuList`/`OverlayHost`:

- **`CommandPalette`** (`command-palette.tsx`) — `^K` fuzzy command launcher.
- **`AgentManager`** (`agent-manager.tsx`) — `^A` conversational-agent roster: switch/add/remove.
- **`ModelSwitcher`** (`model-switcher.tsx`) — `^M` pick a model/provider profile.
- **`SessionPicker`** (`session-picker.tsx`) — `^S` switch/create sessions.
- **`TransmissionsLog`** (`transmissions-log.tsx`) — `^T` the homeworld-comms / signals log.
- **`PermissionsList`** (`permissions-list.tsx`) — `^P` review/revoke remembered permissions.
- **`HelpDialog`** (`help-dialog.tsx`) — `^?` grouped, searchable keybinding reference.
- **`OverlayHost`/`OverlayPanel`** (`overlay-host.tsx`) — shared centered-over-dimmed-content scaffolding.

## Key files

| File | Purpose |
|---|---|
| `src/shared/events.ts` | Wire types: `BridgeEvent`, `ChatTurn`, `ToolEvent`, `DisplaySlotEvent`, etc. |
| `src/shared/bridge.ts` | In-process synchronous pub/sub (`Bridge`, `getBridge`) |
| `src/shared/version.ts` | `GLORP_VERSION` / `GLORP_CODENAME` / `GLORP_BUILD` |
| `src/tui/app.tsx` | Active root layout: status bar / transcript / rail / input / chrome, overlays, keyboard |
| `src/tui/store.ts` | `useUiState(client)` — reducer + `GlorpClient` subscription (via bridge-adapter) |
| `src/tui/store-reducer.ts` | `UiState`, `UiAction`, `reduceUiState`, derived `mood` |
| `src/tui/theme.ts` | Palette, `BANNER`, `GLORP_AVATARS` |
| `src/tui/keybinds.ts` | Declarative keybind table + lookup helpers |
| `src/tui/components/transcript.tsx` | Scrollable history, streaming row, thinking spinner |
| `src/tui/components/message.tsx` | User/agent/system/orchestrator/tool row rendering |
| `src/tui/components/reasoning-row.tsx` | Collapsible reasoning trace |
| `src/tui/components/tool-call.tsx` | Tool-call cards + edit/patch mini-diffs |
| `src/tui/components/context-rail.tsx` | Sidebar: ctx gauge, plan, tasks, agents, inbox, signals |
| `src/tui/components/status-bar.tsx` | Top status line |
| `src/tui/components/chrome-bar.tsx` | Bottom keyhint / model / peers strip |
| `src/tui/components/input-bar.tsx` | Input textarea + autocomplete + history + images |
| `src/tui/components/inline-slot.tsx` | In-transcript permission prompt (display only) |
| `src/tui/components/slash-menu.tsx` | Built-in `/`,`@`,`$` command lists + menu render |
| `src/tui/components/menu/menu-list.tsx` | Generic fuzzy menu used by all overlays |
| `src/tui/components/menu/fuzzy.ts` | Dependency-free fuzzy matcher |
| `src/tui/components/menu/menu-row.tsx` | Menu row / header / filter-input primitives |
| `src/tui/hooks/use-image-paste.ts` | Clipboard / binary image staging |
| `src/tui/clipboard-image.ts` | Native clipboard image read (osascript/xclip/wl-paste) |
| `src/tui/slot-renderers/registry.tsx` | Slot renderer registry + props type |
| `src/tui/slot-renderers/index.tsx` | Registers built-in slot renderers |
| `src/tui/slot-renderers/{permission,confirm,info,select-one,text-input,unknown}.tsx` | Individual slot renderers |
| `src/tui/empty-hero.tsx` | Pre-chat landing screen |
| `src/tui/{command-palette,agent-manager,model-switcher,session-picker,help-dialog,transmissions-log,permissions-list,overlay-host}.tsx` | Full-screen overlays |
| `src/ui/*` | Legacy in-process-bridge frontend (README "Layout"); `Sidebar` lives here |
