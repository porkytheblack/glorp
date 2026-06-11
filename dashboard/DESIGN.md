# Garage design language — "sap & sunlight"

Refined, product-grade UI in two modes: **dark "pine at dusk"** (green-black
surfaces, luminous sap green, solar amber) and **light "warm paper"** (cream
surfaces, pine ink, darkened sap). Calm confidence: deliberate hierarchy,
depth from hairline borders + a top sheen (never heavy drop shadows on
surfaces), one sap-green accent used sparingly. The two modes share ONE
structure — only hues shift, and they shift inside globals.css, never in
components. The reference implementations are the Fleet
console (`app/(app)/page.tsx`, `components/fleet/*`) and the app shell
(`components/app-sidebar.tsx`, `components/app-topbar.tsx`). When in doubt,
imitate those files.

## Tokens (globals.css / tailwind.config.ts)

- **Elevation ladder** — surfaces climb, never jump:
  `bg-background` (page) → `bg-card` (containers) → `bg-surface-2` (bands,
  hovers, insets) → `bg-elevated` (highest inline emphasis). Overlays
  (dialogs/menus) sit on `bg-popover` + `shadow-elevated`.
- **Borders**: `border-border` everywhere; `border-border-strong` only for
  emphasis/hover. Dividers inside lists: `divide-border/60`.
- **Brand**: `brand` (sap green) for primary actions, active nav, focus,
  live accents; `brand-strong` for hover/links. Brand should touch few
  pixels. Green/amber/teal values are darker in light mode for contrast on
  cream — always use the token, never a literal, and it stays legible.
- **Quiet scale** (3 weights of gray text): `text-foreground` (content) →
  `text-muted-foreground` (secondary) → `text-faint` (hints, icons, meta).
  Decorative icons default to `text-faint`.
- **Semantic**: `success` (running/live), `warning` (solar amber —
  provisioning/working/caution), `destructive` (red clay — errors/dangerous
  actions). Tint surfaces with `/10`–`/[0.07]` alphas and `/25`–`/30`
  borders, as in `ErrorState`.

## Utilities & shadows

- `.surface` = card + border + `shadow-card` (the standard container).
- `shadow-sheen` inner top highlight for small chips/buttons.
- Shadows + sheen + `.skeleton` shimmer are CSS variables (`--shadow-card`,
  `--shadow-elevated`, `--sheen`, `--shimmer`) tuned per mode in globals.css
  — never write a literal box-shadow with a baked-in tint.
- `shadow-elevated` for overlays only. `shadow-glow` for hero focus moments
  (one per screen, e.g. the launch composer's `focus-within`).
- `.text-display` for hero headings; `.tnum` on every numeric column;
  `.skeleton` for loading blocks; `.app-backdrop` only on full-screen roots
  outside the app shell (e.g. login).

## Type scale

- Page title: `PageHeader` (22px semibold tight). Section: `SectionHeading`
  (eyebrow 11px uppercase tracking-wider text-faint + 15px semibold title).
- Body 13.5px · secondary 13px · meta 12–12.5px · hints 11.5px `text-faint`
  · mono `font-mono` 12–12.5px. Never `text-base` or larger outside heroes.
- Keyboard hints: `<kbd className="rounded border border-border bg-surface-2 px-1 py-0.5 font-mono text-[10px]">`.

## Composition patterns

- Lists/tables live inside a `.surface` with `overflow-hidden`; optional
  header band: `border-b border-border/70 bg-surface-2/40 px-3.5 py-2`.
- Dense rows: `px-3.5 py-2.5`, hover `hover:bg-surface-2`, trailing chevron
  that nudges on hover (`group-hover:translate-x-0.5`). Numeric columns
  right-aligned with `.tnum`.
- Live state: `SessionStatus` (pulse-ring on running states). Poll lists that
  should feel alive: `useQuery(path, [], 4000)` — it refreshes silently.
- Empty/error/loading: always `EmptyState` / `ErrorState` / `Loading` or
  `.skeleton` — never a bare "No data" string.
- Forms: `Label` 13px + control per row, `gap-4`+ between rows; dialogs get a
  clear title + one-line description; primary action right-aligned in footer.
- Motion: `animate-fade-in` for page mounts (built into `Page`),
  `animate-slide-up` for hero/section entrances, transitions ~150ms. No
  animation on data refresh.

## Primitives — compose, don't reinvent

`Page`, `PageHeader`, `SectionHeading`, `Metric`, `EmptyState`, `ErrorState`,
`SessionStatus`, `Loading`, `Spinner`, `CopyButton`, `ConfirmButton`,
`SecretReveal` (from `components/shared.tsx`, `components/primitives.tsx`)
plus the shadcn primitives in `components/ui/`.

## Hard rules

- Two modes, one structure: every screen must hold up in light AND dark.
  No new color literals — tokens only. Mode-specific styling means a token
  (or `--var`) tuned in globals.css, not a `dark:` utility in a component.
- Theme plumbing: boot script in `app/layout.tsx`, `useTheme` in
  `lib/theme.ts`, `ThemeToggle` in the topbar. localStorage `garage.theme`,
  absent = follow OS.
- Keep every file under 200 lines; split before exceeding.
- Don't restyle by overriding primitives with long `className` chains — if a
  pattern repeats three times, it belongs in a shared component.
- Visual changes must not alter API calls, data flow, or component contracts.
