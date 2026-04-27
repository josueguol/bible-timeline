# UI migration · Bible Timeline design

_Migrated the `web/` client to match `resources/bible-timeline-design/`._

## Summary

The app kept its vanilla TS + canvas architecture but the visual layer was
rebuilt top-to-bottom to match the horizontal "Google-Maps-for-the-Bible"
design. Business logic (camera, viewport fetcher, API clients, store,
service worker) was preserved unchanged. The backend did not require
modifications — it already supports per-zoom-level event retrieval, which is
the core UX requirement (level 1 events when zoomed out, drilling down to
verses at max zoom).

## What changed

### Tokens + fonts (new)

- `src/styles/tokens.css` — single source of truth for colors, spacing,
  typography, radii, shadows, motion, and z-index. Semantic colors
  (`--color-*`) are written at runtime by `theme.ts` so theme switching is
  one `applyThemeToRoot()` call and everything else follows.
- Fonts (Inter, Fraunces, JetBrains Mono) were already wired in
  `index.html` — kept as-is.

### Canvas (`src/canvas/timeline-canvas.ts`)

- Draws the themed vignette, era-color rail above the axis, main axis line,
  level-aware ticks (major/minor), and fade-to-bg date rule on both sides.
- Added `jumpToSequence(seq)` and `jumpToSequenceAndZoom(seq, zoom)` — used
  by the sidebar era picker and the search palette respectively.
- Tick density now keys off the server-reported zoom level label
  (`panorama` / `era` / `book` / `chapter` / `verse`).

### Cards above the axis (`src/ui/event-cards.ts` — full rewrite)

- Two modes driven by the server's zoom level:
  - **Event mode** — one card per `VisibleEvent` from the viewport response.
    Cards are styled per the design (serif title, era-tinted ref chip,
    level badge, focused-state glow, ancestor markers).
  - **Verse mode** — activates when `zoomLevel.label === "Versículos"`. A
    new `VerseWindowFetcher` pulls the visible sequence range from
    `/api/bible/verses` (RV60 + optional NVI) and renders one card per
    verse with scrollable body and copy-to-clipboard.
- Horizontal packing: cards never overlap; when packing pushes a card off
  its natural seqX, an SVG elbow connector ties it back to the true axis
  position (matches the prototype's `VerseConnector`).

### Cards below the axis (`src/ui/float-cards.ts` — new)

- Context / prophecy / cross-ref / note / map / people cards in two lanes
  under the axis, with dashed type-colored border and a dotted guide line
  back to the axis.
- Data lives in `src/data/floats.ts` (static for now — when the catalog
  grows the contract here can move to a backend table).
- Visibility gated by sidebar toggles (`showFloats` + `floatTypes`).

### Era band (`src/ui/era-band.ts`)

- Now glass-styled, shows era name in Fraunces plus the approximate date in
  mono; labels auto-hide when the segment is too narrow.
- Left edge tracks `sidebarOpen` (52px rail vs 288px panel).

### Sidebar (`src/ui/sidebar.ts` — full rewrite)

- Rail (52px) with hamburger, floats toggle, bookmarks shortcut.
- Expanded panel (288px) with version picker (multi-select RV60/NVI), era
  jump menu, float toggles + chip filters, bookmarks list, keyboard hints.
- All state changes flow through the app store. Era jump emits
  `sidebar-jump-sequence` (listened to by `main.ts` → canvas).

### Top-right toolbar (`src/ui/topbar.ts` — full rewrite)

- Minimal glass-pill group: theme switcher (Inkwell / Vellum / Midnight) +
  language toggle (ES / EN). Replaces the old opaque header.

### Zoom FAB (`src/ui/zoom-fab.ts` — full rewrite)

- Stacked ＋ / ⌖ / − buttons with a glass LVL badge showing the current
  server-reported level and the `zoom × 16` ratio.

### Search palette (`src/ui/search-palette.ts` — full rewrite)

- Now a persistent floating glass bar centered at the top. `/` or `⌘K`
  focus shortcut. Suggestions dropdown with reference / event / text
  categories. On pick it calls `canvas.jumpToSequenceAndZoom(seq)`.

### Minimap (`src/ui/minimap.ts` — full rewrite)

- Centered glass strip at the bottom with era bands, visible-event dots,
  float-card markers, and a draggable viewport indicator.

### Event detail modal (`src/ui/event-card.ts`)

- Retheme-only (no logic change). Hardcoded slate palette replaced with
  design tokens, so theme switching reaches the modal too. API calls and
  keyboard/focus behavior preserved.

### Reading panel — removed

- The old bottom `ReadingSheet` and the stub `ReadingSidebar` were deleted.
  The design doesn't have a separate reading panel; verses live *inside*
  the cards above the axis. When zoom reaches the verse level, the event
  cards switch to verse cards that render RV60 + NVI directly (see the
  verse-mode in `event-cards.ts`). Net result: fewer moving pieces and a
  tighter match to the prototype.

### Store (`src/store/app-store.ts`)

- Added `showFloats`, `floatTypes`, `bookmarks`, and a `FloatType` export.
- Default density bumped from `compact` → `regular` to match the design.

### `main.ts`

- Import `styles/tokens.css` early.
- Apply theme to `:root` at boot and on every theme change.
- Added `Topbar` and `FloatCards` to the mount order.
- Wired `sidebar-jump-sequence` custom event to `canvas.jumpToSequence`.
- Wired `searchPalette.connect(canvas)` so search hits animate into view.

## What didn't change (load-bearing preservation)

- `src/api/` — all clients, types, and request/response shapes.
- `src/canvas/gesture-handler.ts`, `src/canvas/inertia.ts`,
  `src/canvas/viewport-fetcher.ts`, `src/canvas/zoom-math.ts`.
- `src/camera.ts`.
- Service worker config in `vite.config.ts`.
- `/health`, `/api/*` routes (backend untouched).
- Accessibility primitives: aria-labels, roles, keyboard focus handling,
  `prefers-reduced-motion` honored via the tokens CSS.

## Progressive retrieval (the "zoom level" requirement)

The retrieval pipeline you described works end-to-end:

1. The canvas emits a zoom change → `ViewportFetcher` requests
   `/api/timelines/{id}/viewport?zoomFactor=X&focusSequence=Y`.
2. The backend `TimelineViewportService` picks the active level from
   `timeline_zoom_levels` and runs the DFS that expands the focus path
   while collapsing siblings. Ancestors are included up to the active
   level.
3. The frontend renders the resulting `visibleEvents` as event cards —
   so at `level 0` you see the ~14 canonical events, at `level 1` their
   children on the focus path, etc.
4. At the deepest level (`"Versículos"`), the card layer switches to
   verse mode and `VerseWindowFetcher` pulls the exact sequence window
   from `/api/bible/verses`, rendering one verse per card with RVR60 +
   optional NVI.

## Known gaps / next steps

- **Floats backend**: currently static in `src/data/floats.ts`. When the
  catalog grows past ~30 entries, move to a backend table and endpoint
  (the contract in `floats.ts` mirrors what a server response would look
  like).
- **Hierarchy seed**: only the `creation` subtree is deep. Task #11
  (expand levels 2-4 across other roots) is independent and unblocked.
- **Bookmarks** are in the store but no UI action yet creates one. Easy
  follow-up: wire a ★ button inside event / verse cards.
- **Prefers-reduced-motion** is handled globally; motion durations already
  live in tokens. No per-component override needed yet.

## Verification

- `npx tsc --noEmit` passes under full strict mode (`strict`,
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `noImplicitOverride`).
- `vite build` runs on macOS; the CI Linux container needs
  `@rollup/rollup-linux-arm64-gnu` installed via `npm ci`, which is a
  host-env concern, not a code issue.
