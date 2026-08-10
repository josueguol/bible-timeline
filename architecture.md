# Bible Timeline — Architecture

## Stack

### Backend (`api/`)
| Layer | Technology |
|---|---|
| Runtime | .NET 9, ASP.NET Core Minimal API |
| Database | PostgreSQL (Npgsql 9.0.3) |
| API docs | Swashbuckle + Microsoft.AspNetCore.OpenApi |
| Tests | xunit + WebApplicationFactory (integration, no mocks) |

### Frontend (`web/`)
| Layer | Technology |
|---|---|
| Language | TypeScript 5 (strict, no framework) |
| Bundler | Vite 5 |
| Offline | vite-plugin-pwa (Workbox) |
| Rendering | Vanilla HTML Canvas 2D (no D3, no React) |
| State | Custom EventTarget store (no Redux/Zustand) |

### Data pipeline (`scripts/`, `resources/`)
| Layer | Technology |
|---|---|
| Contracts | JSON Schema (in `docs/contracts/`) |
| Validation | Python 3 scripts |
| Seed generation | `scripts/generate_sql_timeline_bundle.py` |
| Bible source | `resources/biblias/RV60.xml` (base version) |

---

## Database Schema

```
bible_versions          → version metadata (RV60, NTV, …)
bible_verses            → (version_id, ref) → text
strong_entries          → Strong dictionary entries (H/G number → lemma/definition)
bible_verse_segments    → word-level tokens for tagged original-language versions
strong_entry_translations → localized Strong definitions (Spanish draft/reviewed)
bible_verse_segment_strongs → token → Strong number links
timeline_manifests      → reading order plan (e.g. lectura-expandida-rv60)
timeline_chapter_entries→ ordered chapters in a manifest
timeline_verse_order    → (manifest_id, sequence) → ref  [31102 rows for full Bible]
timelines               → a named timeline (e.g. bible-history-hierarchy-seed)
timeline_zoom_levels    → 5 levels per timeline (panorama/era/book/chapter/verse)
timeline_events         → hierarchical events (parent_id tree, zoom_level, start/end sequence)
```

Key invariants:
- `timeline_verse_order.sequence` is the universal int axis (1–31 102)
- `timeline_events.start_sequence <= end_sequence` (enforced by CHECK)
- `importance` is 1–100 (enforced by CHECK)
- A `manifest_id` owns a complete canonical verse ordering

---

## API Endpoints

```
GET /health
GET /api/timelines/{timelineId}/viewport   → ViewportResponse
GET /api/timelines/{timelineId}/events/{eventId} → EventDetailResponse
GET /api/bible/versions                    → VersionsListResponse
GET /api/bible/verses                      → VersesRangeResponse (+ optional Strong segments, strongLang)
GET /api/strongs/{strongNumber}?lang=es|en → StrongEntryResponse
GET /api/search?q=…                        → SearchResponse
```

All shapes are contract-first — defined as JSON Schema in `docs/contracts/`.

---

## Core Algorithm: Viewport Resolution

File: `api/Services/TimelineViewportService.cs`  
Python reference: `scripts/resolve_timeline_viewport.py`

1. **Load zoom levels** — table `timeline_zoom_levels` ordered by `level`
2. **Load full event tree** — all `timeline_events` for the timeline, assembled into parent→children in memory
3. **Load verse order** — `timeline_verse_order` for the configured `manifest_id`
4. **Resolve focus sequence** — from `focusSequence` int, `focusRef` string, or `focusEventId` (priority in that order)
5. **Resolve zoom level** — match `zoomFactor` ∈ [minZoomFactor, maxZoomFactor]
6. **Find focus path** — walk tree from roots downward, picking the node whose range contains `focusSequence` at each level, stopping at `activeZoomLevel`
7. **Build visible events** — DFS: only expand nodes on the focus path whose `zoom_level < activeZoomLevel`; optionally suppress strict ancestors (`includeAncestors`)
8. **Assign `displayOrder`** — numbered 1..N in DFS visit order

---

## Frontend Architecture

### State (`web/src/store/app-store.ts`)
Single `AppStore extends EventTarget` with immutable `update(patch)`. No framework.  
Key state fields: `zoomFactor`, `focusEventId`, `focusRef`, `primaryVersion`, `viewport`, `theme`, `density`.

### Canvas (`web/src/canvas/`)
- `TimelineCanvas` — main render loop (RAF), owns camera state: `focusSeq`, `panOffset`, `zoomFactor`
- `GestureHandler` — pointer/wheel events → pan/zoom callbacks; respects `data-scroll-host` and `data-no-drag` attributes
- `InertiaEngine` — physics for fling-to-pan after pointer release
- `ViewportFetcher` — debounced API calls when camera changes
- `zoom-math.ts` — `computePxPerVerse(zoomFactor)`: piecewise-linear mapping from `[0,1]` to px/verse

### Zoom levels (client-side thresholds)
```
0.00–0.12 → Panorama (level 0)
0.12–0.28 → Eras     (level 1)
0.28–0.50 → Books    (level 2)
0.50–0.75 → Chapters (level 3)
0.75–1.00 → Verses   (level 4)
```
Must stay in sync with `timeline_zoom_levels` rows in the DB.

### UI components (`web/src/ui/`)
All vanilla TS classes that manage DOM nodes directly (no VDOM). Key ones:
- `event-cards.ts` / `event-card.ts` — floating event cards above the axis
- `minimap.ts` / `book-minimap.ts` — position indicator
- `search-palette.ts` — keyboard-accessible search overlay
- `sidebar.ts` — collapsible detail panel
- `era-band.ts` — colored era strip overlay

### Path aliases (vite.config.ts)
```
@api    → /src/api
@store  → /src/store
@canvas → /src/canvas
@ui     → /src/ui
```

### PWA caching strategy
| Route pattern | Strategy | TTL |
|---|---|---|
| `/api/timelines/*` | NetworkFirst | 5 min |
| `/api/bible/*` | StaleWhileRevalidate | 30 days |
| `/api/search*` | NetworkFirst | 1 hour |

---

## Data Pipeline (adding or modifying timeline data)

All data flows through validated JSON → SQL bundle → PostgreSQL.  
**Never skip validation steps.**

### Contracts (in `docs/contracts/`)
Each JSON file is a JSON Schema. Relevant ones:
- `timeline-hierarchy.schema.json` — hierarchical event input
- `insert-hierarchical-events.schema.json` — SQL INSERT shape
- `insert-verse-timeline-bundle.schema.json` — full bundle
- `chapter-order-manifest.schema.json` — reading order
- `verse-order.schema.json` — per-verse canonical sequence
- `timeline-viewport-request/response.schema.json` — API contract
- `strong-entry-response.schema.json` — Strong dictionary entry API contract

### Validation commands
```bash
python3 scripts/validate_timeline_hierarchy.py <file.json>
python3 scripts/validate_sql_hierarchy.py <file.sql>
python3 scripts/validate_chapter_order_manifest.py <file.json>
python3 scripts/validate_verse_order.py <file.json>
python3 scripts/validate_timeline_viewport_request.py <file.json>
python3 scripts/validate_timeline_viewport_response.py <file.json>
python3 scripts/generate_sql_timeline_bundle.py <manifest.json> <verse-order.json> <hierarchy.json> --output <out.sql>
python3 scripts/validate_sql_timeline_bundle.py <file.sql>
```

### Agent workflow (AGENTS.md)
1. `historian-research` — curate historical events (no invention)
2. validate against contract
3. `backend-sql` — transform to SQL
4. validate SQL
5. `ux-ui` + `frontend-ui` — if UI changes needed

---

## Key Patterns and Constraints

### No ORMs
All DB access via raw `NpgsqlCommand`. No Entity Framework. Query strings are inline in service classes.

### Singleton services
`TimelineViewportService`, `BibleReadingService`, `SearchService`, `EventDetailService` are all registered as singletons. Connections are opened per-call via `NpgsqlConnectionFactory.OpenConnection()` (not pooled at the factory level — Npgsql has its own pool).

### Contract-first development
The JSON Schema files in `docs/contracts/` are the single source of truth for API shapes. C# models and TypeScript interfaces must match them. When changing an API response, update the schema first.

### Golden tests
`api.tests/TimelineViewportServiceGoldenTests.cs` spins up a real isolated PostgreSQL schema, seeds it, runs the viewport resolver, and compares against a saved JSON golden file in `resources/cronologia/`. When changing the resolver algorithm, update the golden file too.

### Theme system
Three themes: `inkwell` (dark blue), `vellum` (dark warm), `midnight` (dark purple).  
Colors defined in `web/src/theme.ts` as `oklch(...)` values. Applied to CSS custom properties on `:root` via `applyThemeToRoot()`. Canvas reads from `getComputedStyle` or uses the `Theme` object directly.

### Migration from SQLite → PostgreSQL
`NpgsqlConnectionFactory` replaced `SqliteConnectionFactory` (still exported as deprecated alias). Config key is `BibleTimeline:ConnectionString`. Default: `Host=localhost;Port=5432;Username=postgres;Password=postgres;Database=bible_timeline`.

---

## Local Development

```bash
# Backend
cd api && dotnet run          # http://localhost:5080

# Frontend
cd web && npm install && npm run dev   # http://localhost:5173
# Vite proxies /api → localhost:5080

# Tests (requires running PostgreSQL)
cd api.tests && dotnet test
```

Config overrides go in `api/appsettings.Development.json`.  
DB schema + seed auto-applied on startup if `AutoApplySeedIfMissing: true`.
