# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**The Tiered Edge Fleet** is an Ocean Alkalinity Enhancement (OAE) simulation platform for LA Hacks 2026. It simulates chemical plume dispersion from ship-based alkalinity deployment, with AI-powered safety analysis.

Target hardware: ASUS Ascent GX10 (NVIDIA GB10 Grace Blackwell, 128GB unified memory)

Judging tracks: Sustainability, ASUS Challenge, Arista Networks "Connect the Dots", Best Use of Google Gemma

## Development Commands

### Quickstart (all-in-one)
```bash
./start.sh             # Start everything: Ollama, backend, Julia warmup, frontend
./start.sh --no-julia  # Skip Julia CUDA warmup for faster cold start
./start.sh --stop      # Kill all background processes
```
`start.sh` waits for each service to be port-ready before proceeding. Logs written to `.logs/`.

### Backend (FastAPI)
```bash
cd backend
source venv/bin/activate
uvicorn main:app --port 8001 --reload
```
On startup, `lifespan()` fires a daemon thread running `refresh_all()` to pre-cache all ocean data (SST, CalCOFI, chlorophyll, currents) before first request.

### Frontend (React + Vite)
```bash
cd frontend
npm install      # First time — install dependencies including Three.js
npm run dev      # Dev server on port 3000
npm run build    # Production build
```

### Smoke Test (verify all components)
```bash
./smoke_test.sh
```

### Ollama/Gemma (AI analysis)
```bash
ollama serve                        # Terminal 1
ollama run gemma4:31b               # Terminal 2 (first time — downloads and runs the 31B model)
```

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                           Frontend (React + Vite)                          │
│  ┌─────────────────┬─────────────────┬─────────────────┐                   │
│  │ Mode 1: Global  │ Mode 2: Mission │ Mode 3: Route   │  ModeSelector     │
│  │ Intelligence    │ Control         │ Planning        │                   │
│  └────────┬────────┴────────┬────────┴────────┬────────┘                   │
│           │                 │                 │                            │
│           ▼                 ▼                 ▼                            │
│  ┌────────────────────────────────────────────────────────┐               │
│  │         Mapbox GL + Three.js (ThreeLayer.ts)           │               │
│  │  • 2D Heatmap • 3D Isosurface BBox • Velocity Arrows   │               │
│  │  • 2D Section Cut (depth slider) • MPA Overlays        │               │
│  └────────────────────────────────────────────────────────┘               │
└─────────────────────────────────┬──────────────────────────────────────────┘
                                  │
                                  ▼ REST API
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Backend (FastAPI :8001)                           │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Endpoints                                                           │    │
│  │ GET  /health          — system status                               │    │
│  │ POST /simulate        — plume dispersion + MRV hash                 │    │
│  │ GET  /fleet           — OAE ship fleet status                       │    │
│  │ POST /analyze         — AI safety analysis (agent → Ollama → rules) │    │
│  │ POST /agent           — dispatch to local agents                    │    │
│  │ POST /discover        — AI-recommended deployment zones             │    │
│  │ POST /hotspot-impact  — deep-dive metric analysis for a site        │    │
│  │ GET  /ocean-state     — real-time ocean conditions for a lat/lon    │    │
│  │ GET  /oceanographic   — CalCOFI station data                        │    │
│  │ GET  /traffic         — AIS vessel traffic                          │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Local Agents (backend/agents/) — fully offline, no cloud deps       │    │
│  │ • SpatialIntelligenceAgent — site selection scoring                 │    │
│  │ • GeochemistAgent — safety analysis, CO₂ projection                 │    │
│  │ Fallback chain: Ollama/Gemma4 (local) → Rule-based deterministic    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼ (optional)
                    ┌───────────────────────────────────┐
                    │ Julia / Oceananigans.jl + CUDA    │
                    │ (GPU LES plume simulation)        │
                    └───────────────────────────────────┘
```

### Three-Mode UI System
1. **Global Intelligence (Mode 1)**: Pacific-centered view with CalCOFI oceanographic data, OAE zone scoring, MPA overlays, and AI-recommended deployment zones via `/discover`
2. **Mission Control (Mode 2)**: Localized simulation view with 2D heatmap, 3D isosurface visualization, 2D section cut (depth-adjustable cross-section), safety analysis, and impact metrics
3. **Route Planning (Mode 3)**: Click-to-add waypoints, route LineString layer, per-segment CO₂ estimates, AIS vessel traffic overlay

### Data Flow
1. **Mode 1**: Frontend calls `GET /oceanographic` and `POST /discover` → renders CalCOFI stations + AI-recommended zones
2. **Mode 2**: Frontend sends params to `POST /simulate` → Backend returns plume data with MRV hash → Frontend renders heatmap + Three.js isosurface → User clicks "Analyze" → `POST /analyze` → AI safety assessment
3. **Mode 3**: Frontend calls `GET /traffic` → renders AIS vessels; user builds route → per-segment CO₂ estimates

### Frontend File Structure

```
frontend/src/
├── App.tsx                               # Root — header, mode switcher, QueryClientProvider
├── types.ts                              # All shared TypeScript interfaces
├── constants.ts                          # API_URL, MAPBOX_TOKEN, GeoJSON data, animation variants
├── index.css                             # All styles — design tokens in :root at the top
├── ThreeLayer.ts                         # Three.js Mapbox custom layer (isosurface + velocity arrows)
├── lib/
│   └── utils.ts                          # cn() helper (clsx + tailwind-merge)
├── components/
│   ├── ui/
│   │   ├── ParamSlider.tsx               # Radix slider with animated value pop
│   │   └── FeedstockPicker.tsx           # Sliding segmented control (Olivine / NaOH)
│   ├── shared/
│   │   ├── ShipMarker.tsx                # SVG top-down vessel icon with status colors
│   │   ├── MPAOverlay.tsx                # Mapbox layers — organic MPA blobs with glow
│   │   ├── PlumeHeatmap.tsx              # Mapbox heatmap layer for alkalinity plume
│   │   ├── MapLegend.tsx                 # Bottom-left map legend overlay
│   │   ├── ImpactMetrics.tsx             # Top-center CO₂ / safety / MRV chips
│   │   ├── FleetPanel.tsx                # Right sidebar — fleet summary + ship cards
│   │   └── ModeSelector.tsx              # Sliding segmented control in header (3-col spring pill)
│   └── mission/
│       ├── SimulationPanel.tsx           # Left sidebar — sliders, feedstock, run button, result card
│       └── AIPanel.tsx                   # Left sidebar — Gemma analysis panel
└── pages/
    ├── GlobalIntelligence.tsx            # Mode 1 — Pacific view, OAE zones, CalCOFI, discovery
    ├── MissionControl.tsx                # Mode 2 — simulation, heatmap, Three.js, fleet
    └── RoutePlanning.tsx                 # Mode 3 — waypoints, route line, AIS traffic
```

### Other Notes
- Favicon: `frontend/public/favicon.svg` — sailboat + waves SVG, referenced in `index.html` with `?v=2` cache-bust
- Mission Control initial map zoom: `6.5` (shows Pacific coast context; was 8.5 → 7 → 6.5)
- Header chip labels: `GPU ✓` / `GPU ✗` for Julia availability — NOT "Live/Mock" (that was misleading; simulation uses real CalCOFI data regardless of Julia)
- Error boundary: `ErrorBoundary` class in `App.tsx` wraps `<main>` — catches render errors and displays them on-screen instead of a black page
- ThreeLayer lazy import: `PlumeThreeLayer` is loaded via dynamic `import('../ThreeLayer')` inside `handleMapLoad` — never imported statically at app startup to prevent Three.js from blocking/crashing the initial render. `import type { PlumeThreeLayer }` used for the TypeScript type only.
- **ThreeLayer origin**: `SHIP_LNG = -119.50`, `SHIP_LAT = 33.80` — must match the Pacific Guardian ship position. Previously was downtown LA coords (-118.24, 34.05) which rendered the 3D box ~100 km east of the ships on the map.

### Backend Key Files
- `backend/main.py` - FastAPI server with all endpoints — CORS allows `localhost:3000`, `3001`, `5173`. Has `lifespan()` for startup ocean data pre-caching.
- `backend/data_fetcher.py` - Real NOAA ERDDAP fetchers (`fetch_sst`, `fetch_calcofi`, `fetch_chlorophyll`, `fetch_currents`, `refresh_all`) with 24-hour file cache in `data/real/`
- `backend/agents/spatial_intelligence.py` - Site selection scoring agent
- `backend/agents/geochemist.py` - Safety analysis agent with function calling
- `backend/agents/base.py` - Local agent base: `query_gemma()` (Ollama/Gemma4), `extract_json()`, `is_ollama_available()`
- `backend/benchmarks.py` - Algorithm benchmarks: 12 checks for haversine, TSP ratio, fleet assignment, hotspot scoring. Run: `PYTHONIOENCODING=utf-8 python benchmarks.py`
- `julia/plume_simulator.jl` - Oceananigans.jl LES simulation (requires Julia + CUDA)
- `data/mock/plume_simulation.json` - Pre-computed fallback plume data
- `data/mock/calcofi_stations.json` - CalCOFI oceanographic station data (real data, local cache)
- `data/real/` - Live-fetched NOAA data: `sst.json`, `calcofi.json`, `chlorophyll.json`, `currents.json`, `zone_scores.json`
- `data/mrv_log.jsonl` - MRV cryptographic hash log
- `start.sh` - Unified launcher: Ollama → backend → Julia warmup → frontend; `--stop` to kill all

### Live Data Sources
- **NOAA ERDDAP jplMURSST41**: SST fetched via `fetch_ocean_state(lat, lon)` — `https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.json`. 10-minute in-memory cache (`_ocean_state_cache`). Falls back to CalCOFI if unreachable.
- **CalCOFI stations**: `data/mock/calcofi_stations.json` — 18 real oceanographic stations, used for salinity, MLD, baseline alkalinity. Despite "mock" path, this is real survey data.
- **Ocean state source labels**: `"noaa_erddap+calcofi"` | `"calcofi"` | `"defaults"` — shown in SimulationPanel ocean conditions block.
- **Simulation source labels**: `"live"` (Julia ran) | `"live-conditions"` (physics plume + real ocean data) | `"mock"` (full offline fallback).
- **Ship deployment position for ocean fetch**: `(33.80, -119.50)` — Pacific Guardian site off Channel Islands (NOT downtown LA).
- **Global OAE hotspots** (`GET /global-hotspots`): Real NOAA OISST v2.1 SST (ncdcOisst21Agg_LonPM180) + QuikSCAT/ASCAT wind speed (erdQCwindproductsMonthly). Scored by 4-factor model: SST×0.30 (CO₂ solubility via Henry's Law) + Wind×0.30 (gas transfer k∝u², Wanninkhof 2014) + Lat/mixing×0.25 (Southern Ocean > subpolar gyres > subtropics > tropics) + Upwelling basin bonus≤0.25. Filtered to show only highly viable regions (score ≥ 0.70) and organically distributed using ±1.5° geographic jitter to remove the 4° mathematical grid appearance. Cached 7 days to `data/real/global_hotspots.json`. Dot color = OAE score; dot size = wind speed (gas transfer proxy).

### Safety Thresholds (from OAE research)
- Ω_aragonite > 30.0 → runaway carbonate precipitation (UNSAFE)
- Total alkalinity > 3500 µmol/kg → olivine toxicity (UNSAFE)

## UI Stack (phase:ui1 + ui2)

Installed in `frontend/`:
- **Framer Motion** — all animations (`motion.*`, `AnimatePresence`, spring physics)
- **Radix UI Slider** (`@radix-ui/react-slider`) — custom styled range inputs
- **Tailwind CSS v4** + `@tailwindcss/postcss` — utility classes available; CSS variables are primary
- **clsx + tailwind-merge** — `cn()` utility at `src/lib/utils.ts`

### Design Tokens (in `frontend/src/index.css` `:root`)
| Token | Value | Usage |
|---|---|---|
| `--bg` | `#0c0f14` | App background |
| `--panel-bg` | `rgba(12,15,20,0.96)` | Sidebar + overlay panels |
| `--accent` | `#ffffff` | Sliders, active states (white — minimal use) |
| `--deploy` | `#00c8f0` | Deploying ship status only |
| `--success` | `#4ade80` | Safe status, active ships, CO₂ estimates |
| `--danger` | `#f87171` | Unsafe status, MPA zones |
| `--warning` | `#fbbf24` | Idle ships, AIS traffic |
| `--text-1/2/3` | light→muted grey | Heading / body / label hierarchy |

### Shared Animation Patterns
- Sidebars slide in from edges on mount (`x: ±280 → 0`, spring stiffness 280, damping 30)
- Header staggers in element-by-element on load
- `AnimatePresence` on all conditional panels — result cards, analysis, zone detail, hint card
- Cards stagger in via `staggerList` / `fadeUp` variants (0.07s delay, defined in `constants.ts`)
- Slider value number pops on change (`key={value}`, scale spring stiffness 520)
- Online dot breathes with CSS `@keyframes dot-breathe`
- Deploying ship markers pulse with CSS `@keyframes ring-out`

### Segmented Control Pattern (reused across the app)
All tab/toggle controls use the same sliding pill approach:
```
position:relative grid → padding:3px → motion.div indicator (position:absolute)
indicator width = calc(N%-Xpx), x = index * 100%
```
- **FeedstockPicker** — 2-col (`calc(50%-3px)`), `x: 0 | 100%`
- **ModeSelector** — 3-col (`calc(33.333%-2px)`), `x: 0 | 100% | 200%`, centered in header via `.header-center { position:absolute; left:50%; transform:translateX(-50%) }`

### Component Patterns

**ModeSelector** (`components/shared/ModeSelector.tsx`)
Sliding segmented control in header. Spring transition stiffness 500 / damping 38. Labels: "Global Intelligence" | "Mission Control" | "Route Planning".

**ParamSlider** (`components/ui/ParamSlider.tsx`)
Radix Root/Track/Range/Thumb. 14px track, 28px thumb, gradient fill with glow. Value display pops on change.

**FeedstockPicker** (`components/ui/FeedstockPicker.tsx`)
2-option segmented control. Sliding `motion.div` indicator.

**ShipMarker** (`components/shared/ShipMarker.tsx`)
SVG top-down vessel: hull path, superstructure rect, bow line, port/starboard circles. Status-colored with pulsing ring for deploying. Accepts `heading?: number` — rotates SVG to vessel bearing with 1.2 s CSS `transition: transform`.

**MPAOverlay** (`components/shared/MPAOverlay.tsx`)
3 organic blob polygons. 3 layers: wide blur glow line → translucent fill → dotted outline (1.5/2.5 dash ratio).

### Page-Specific Patterns

**GlobalIntelligence** (`pages/GlobalIntelligence.tsx`)
- OAE zones: organic blob polygons in constants, 3-layer map treatment (glow + fill + dotted outline), color-coded by score
- Zone cards: ship-card DNA — left stripe via `::before`, pip dot, name + label + score, animated `›` chevron, `whileHover scale 1.015`
- Zone detail popup: `position:absolute; top:16px; left:50%` within map-container, slides down from `y:-16` on open
- `zoneTier()` accepts `number | string` (Mapbox serializes properties as strings on map click)
- CalCOFI data renders as `stat-card` tiles, not raw `<p>` text
- Discovery zones clickable — trigger same detail popup

**MissionControl** (`pages/MissionControl.tsx`)
- Three-panel: left sidebar (SimulationPanel + AIPanel) + map + right sidebar (FleetPanel)
- Three.js layer (`PlumeThreeLayer`) added on map load via `onLoad` callback — loaded with dynamic `import('../ThreeLayer')` (lazy) to prevent blocking initial render
- `reuseMaps` guard: existing `'plume-three-layer'` is removed before re-adding on every `handleMapLoad` call (prevents "layer already exists" crash when switching modes)
- `TICK_MS = 1500` — ship position advances client-side every 1.5 s via `advanceShip(ship, dtMs)`
- `SIM_REFRESH_MS = 45_000` — re-fetches real ocean conditions every 45 s while running
- `isRunning` / `elapsedS` state — Pause/Resume/Reset controls wired through `SimulationPanel`
- Sim status bar: bottom-center map overlay (`sim-status-bar`) shows live/paused dot, elapsed time, fetching spinner
- `PlumeHeatmap` receives `centerLat`/`centerLon` from active (deploying) ship so plume follows the vessel
- Auto-starts simulation on mount via `useEffect(() => simulate.mutate(defaultParams), [])`

**SimulationPanel** (`components/mission/SimulationPanel.tsx`)
- Props: `onRun`, `isLoading`, `result?`, `isRunning?`, `elapsedLabel?`, `onToggleRunning?`, `onReset?`
- Pause/Resume button (`.sim-ctrl-btn.pause` / `.resume`) and Reset button below Run Simulation button
- Live elapsed row (`.sim-elapsed-row`) with pulsing green dot shown when `isRunning && elapsedLabel`
- Result card shows: status, source badge, Ω aragonite, total alkalinity, real ocean conditions block (SST, PSU, MLD, baseline TA), safety failures

**PlumeHeatmap** (`components/shared/PlumeHeatmap.tsx`)
- Props: `visible`, `simulationData?`, `centerLat?`, `centerLon?`
- `baseLon = centerLon ?? -119.50`, `baseLat = centerLat ?? 33.80` — heatmap recenters on active ship

**GlobalIntelligence** (`pages/GlobalIntelligence.tsx`)
- After `POST /discover` returns zones, fetches `POST /hotspot-impact` for each zone in parallel (`useEffect` on `discoveryZones`)
- `impactData: Record<number, HotspotImpact>` — keyed by zone index
- `selectedDiscIdx: number | null` — which discovery zone is selected; clicking opens right sidebar
- Right sidebar (`sidebar-right`) appears via `AnimatePresence` when `selectedDiscIdx !== null`
- `ImpactPanel` component (defined at bottom of file): renders CO₂ projections (1/5/10/50 yr), revenue, ocean chemistry, plume metrics, safety badge, ocean state — all metric-driven
- `fmt(n, dec)` helper: formats large numbers as `k` / `M`

**RoutePlanning** (`pages/RoutePlanning.tsx`)
- Three-panel: left (route controls) + map + right (AIS Traffic + fleet summary)
- **Two tabs** via `.rp-tab-toggle` segmented control:
  - **AI Fleet tab**: "Compute Optimal Routes" button → `POST /discover` (disabled/spinner while fetching) → greedy nearest-neighbor assignment of discovered hotspots to each ship → per-ship colored dashed route lines on map + fleet assignment cards in sidebar
  - **Manual tab**: original click-to-add waypoints UX; Undo Last + Clear All; staggered segment cards with km + CO₂ per leg
- Route optimization algorithm (`planFleetRoutes`): ships sorted; each gets nearest unassigned hotspot; last ship absorbs all remaining via TSP nearest-neighbor; waypoints start at ship position
- Per-ship route colors: Pacific Guardian `#00c8f0` (cyan), Ocean Sentinel `#4ade80` (green), Reef Protector `#fbbf24` (amber); FALLBACK_COLORS array for additional ships
- Hotspot markers: 28px pulsing cyan circles (`rp-hotspot-marker`) with alphabetic site labels (A/B/C...) and `rp-hotspot-ring` pulse animation; scale-spring in with staggered delay
- Route lines per ship: glow layer (12px blur, 0.18 opacity) + dashed solid layer (2.5px, `[4, 2.5]` dash)
- Right sidebar shows AIS traffic + per-ship fleet summary (color pip + ship name + sites + km + CO₂) after routes are computed
- `POST /discover` returns zones with `name: "Site A"/"Site B"/...` (assigned in backend); `DiscoveryZone.name` is optional string
- AIS traffic: SVG arrow markers on map, ship-card style in right sidebar with amber pip
- Map center: `longitude: -119.8, latitude: 33.8, zoom: 7` (Pacific coast fleet area)

### New CSS Classes (Phase 3)
| Class | Location | Purpose |
|---|---|---|
| `.sim-controls` | `index.css` | Flex row for Pause/Resume + Reset buttons |
| `.sim-ctrl-btn.pause/.resume/.reset` | `index.css` | Colored control buttons |
| `.sim-elapsed-row` / `.sim-elapsed-dot` | `index.css` | Live elapsed time row with pulsing dot |
| `.sim-status-bar` | `index.css` | Bottom-center map overlay pill (Live/Paused status) |
| `.sim-status-dot.running/.paused` | `index.css` | Animated status dot |
| `.impact-panel` / `.impact-section` | `index.css` | Right sidebar container for hotspot metrics |
| `.impact-metric-grid` / `.impact-metric-card` | `index.css` | 2-col or 4-col metric tile grid |
| `.impact-metric-val.co2/.deploy/.warn` | `index.css` | Color-coded metric values |
| `.impact-safety-badge.low/.medium/.high` | `index.css` | Risk level badge |
| `.impact-chemistry-row` | `index.css` | Key-value chemistry row |
| `.impact-loading` | `index.css` | Loading/empty state in impact panel |

### New CSS Classes (Route Planning AI Redesign)
| Class | Location | Purpose |
|---|---|---|
| `.rp-tab-toggle` | `index.css` | 2-col segmented control (AI Fleet / Manual) |
| `.rp-tab-btn` / `.rp-tab-btn.active` | `index.css` | Tab button; active state has filled bg |
| `.rp-compute-btn` / `.rp-compute-btn.loading` | `index.css` | Cyan "Compute Optimal Routes" button; loading variant dims border |
| `.rp-compute-spinner` | `index.css` | 12px spinning ring inside compute button |
| `.rp-fleet-card` | `index.css` | Per-ship route assignment card with colored left border |
| `.rp-fleet-header` | `index.css` | Pip + ship name + km meta row inside fleet card |
| `.rp-fleet-pip` | `index.css` | 7px colored circle matching ship route color |
| `.rp-fleet-name` | `index.css` | Ship name, colored, truncated |
| `.rp-fleet-meta` | `index.css` | Distance in km, muted right-aligned |
| `.rp-fleet-sites` | `index.css` | List of assigned hotspots inside fleet card |
| `.rp-fleet-site-row` | `index.css` | Single hotspot row: dot + name + score% |
| `.rp-fleet-site-dot` | `index.css` | 4px muted circle bullet |
| `.rp-fleet-site-score` | `index.css` | Green score percentage |
| `.rp-fleet-co2` | `index.css` | Green CO₂ estimate at bottom of card |
| `.rp-hotspot-marker` | `index.css` | 28px pulsing cyan circle on map for discovered sites |
| `.rp-hotspot-letter` | `index.css` | Alphabetic site label (A/B/C) inside marker |
| `.rp-hotspot-ring` | `index.css` | Pulsing outer ring — `hotspot-pulse` keyframes (2s ease-out) |
| `.rp-fleet-summary-row` | `index.css` | Compact route summary row in right sidebar |
| `@keyframes spin` | `index.css` | 360° spinner for compute button loading state |
| `@keyframes hotspot-pulse` | `index.css` | Scale 1→1.6, opacity 0.6→0 pulse for hotspot rings |

### Local Agent Architecture (Phase 4)

All agents run **fully locally** via Ollama/Gemma4 — no cloud dependency, no API keys required.

**Flow for every agent call:**
1. Tool functions execute deterministically (always — provides hard numbers regardless of LLM state)
2. Tool results sent to Gemma4 (`gemma4:31b`) via Ollama for natural-language synthesis
3. Response parsed as JSON; if malformed or Ollama unreachable, rule-based synthesis used instead

**`backend/agents/base.py`**
- `query_gemma(prompt, system, timeout)` — POSTs to `OLLAMA_URL/api/generate` with low temperature (0.3) and 512-token limit for deterministic JSON output
- `is_ollama_available()` — checks `/api/tags` and verifies `gemma4` is loaded
- `extract_json(text)` — regex-extracts first JSON object from LLM response
- `httpx` import is guarded for compatibility when running `benchmarks.py` from base Python

**`backend/agents/geochemist.py`** — `GeochemistAgent`
- Always runs: `check_aragonite_threshold()`, `check_alkalinity_threshold()`, `project_co2_removal()` (deterministic)
- Gemma4 synthesises: `safety_assessment` (string), `co2_projection` (string), `recommendations` (list)
- `model_used` field: `"gemma4:31b (local)"` or `"rule-based-fallback"`

**`backend/agents/spatial_intelligence.py`** — `SpatialIntelligenceAgent`
- Always runs: `get_mpa_overlap()`, `get_ocean_state()` (deterministic)
- Gemma4 synthesises: `suitability_score` (0–1), `reason` (string), `mpa_conflict` (bool)
- `model_used` field: `"gemma4:31b (local)"` or `"rule-based-fallback"`

### Route Planning — AI Fleet Tab

`RoutePlanning.tsx` has two tabs: **AI Fleet** and **Manual**.

**AI Fleet tab** calls `POST /discover` via `computeRoutes()` async function:
- `hotspots: DiscoveryZone[]` state — populated from `/discover` response
- `isDiscovering: boolean` — spinner/disabled state while fetch is in flight
- `routesComputed: boolean` — shows route cards after first successful fetch
- `planFleetRoutes(ships, zones)` — greedy nearest-neighbor assignment (runs client-side from hotspots state)
- Compute button always visible; spinner shows "Analyzing ocean conditions…" during fetch
- No waypoints needed for AI Fleet tab — zones come from server

### Algorithm Benchmarks

`backend/benchmarks.py` — run with `PYTHONIOENCODING=utf-8 python benchmarks.py`

**12/12 checks pass** (as of 2026-04-25):
| Benchmark | Result |
|---|---|
| Haversine accuracy | max 1.5% error |
| Greedy TSP optimality | 1.054x mean, 1.211x worst |
| Fleet assignment completeness | 6/6 zones assigned |
| SST weight effect (Δ5°C vs 25°C) | Δ0.230 |
| Wind weight effect (Δ2 vs 10 m/s) | Δ0.195 |
| Latitude weight (tropical vs Southern Ocean) | Δ0.200 |
| Known good zones score ≥0.70 | 3/3 (SO: 0.931, NA: 0.810, CA: 0.715) |
| Known bad zones score <0.70 | 3/3 (tropics: 0.14–0.17) |
| Score monotonicity (decreasing SST) | pass |
| MPA detection | 3/3 |
| Ocean state plausibility | pass |
| Rule-based score determinism | pass |

Performance: Haversine 1.25M calls/sec, fleet assignment 0.18ms per call.

**Hotspot scoring formula**: `SST×0.30 + Wind×0.30 + Lat/mixing×0.25 + UpwellingBonus≤0.25`
- SST score: `(28 - sst) / 26`, clamped 0–1. Cooler = higher CO₂ solubility (Henry's Law)
- Wind score: ramps 0→1 from 0→12 m/s, then falls above 18 m/s. Gas transfer k∝u² (Wanninkhof 2014)
- Lat score: Southern Ocean 1.0 > Subpolar 0.9 > Mid-lat 0.8 > Subtropics 0.55 > Tropics 0.20
- Upwelling bonus: cumulative bonus for EBUS zones (California, Humboldt, Canary, Benguela, Southern Ocean, etc.), capped at 0.25

### Backend Startup — Ocean Data Pre-Caching
`main.py` uses a FastAPI `lifespan` async context manager (not deprecated `@app.on_event`). On startup, it spawns a daemon thread calling `data_fetcher.refresh_all()`, which fetches and writes:
- `data/real/sst.json` — NOAA OISST v2.1 SST (12-hour cache)
- `data/real/calcofi.json` — CalCOFI CTD stations (7-day cache)
- `data/real/chlorophyll.json` — ERDDAP chlorophyll-a (24-hour cache)
- `data/real/currents.json` — OSCAR surface currents (24-hour cache)
- `data/real/zone_scores.json` — computed OAE zone suitability scores

Cache staleness check: `_is_stale(path, max_age_hours)` compares file `mtime`. If not stale, the in-file cache is returned immediately. If unreachable, falls back to whatever is on disk. Each dataset has its own max-age.

### MRV (Measurement, Reporting, Verification)
Every simulation result is hashed (SHA-256) and logged to `data/mrv_log.jsonl` for tamper-evident carbon credit verification. The hash is displayed in the Impact Metrics overlay.

## Offline-First Design

The platform must work without internet (ship at sea scenario):
- Backend auto-detects Julia availability and falls back to mock data
- AI analysis falls back: Ollama/Gemma4 (local) → rule-based deterministic logic
- All external API data is mocked (MarineTraffic, CalCOFI)

## Environment Variables

Frontend (`frontend/.env`):
```
VITE_MAPBOX_TOKEN=pk.eyJ1IjoidHNyaXJhbSIsImEi...  # Mapbox GL token
VITE_API_URL=http://localhost:8001                  # Must be 8001 — backend port
```
**Critical**: `VITE_API_URL` must be `8001`. The Vite config proxies `/api` → `8001`, but direct `API_URL` calls (used throughout) bypass the proxy and hit this env var directly. Using `8000` silently breaks all simulation, fleet, and AI endpoints.

Backend (optional):
```
OLLAMA_URL=http://localhost:11434  # Override Ollama endpoint (default: localhost:11434)
GEMMA_MODEL=gemma4:31b             # Override Gemma model tag (default: gemma4:31b)
```

## gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__claude-in-chrome__*` tools.

### Available Skills

- `/office-hours` - YC Office Hours brainstorming and startup mode
- `/plan-ceo-review` - CEO/founder-mode plan review
- `/plan-eng-review` - Eng manager-mode plan review
- `/plan-design-review` - Designer's eye plan review
- `/design-consultation` - Design system consultation
- `/design-shotgun` - Generate multiple design variants
- `/design-html` - Production-quality HTML/CSS generation
- `/review` - Pre-landing PR review
- `/ship` - Ship workflow (tests, PR, changelog)
- `/land-and-deploy` - Land and deploy workflow
- `/canary` - Post-deploy canary monitoring
- `/benchmark` - Performance regression detection
- `/browse` - Fast headless browser for QA testing
- `/connect-chrome` - Connect to Chrome browser
- `/qa` - QA test and fix bugs
- `/qa-only` - QA test report only
- `/design-review` - Designer's eye QA
- `/setup-browser-cookies` - Import browser cookies
- `/setup-deploy` - Configure deployment settings
- `/retro` - Weekly engineering retrospective
- `/investigate` - Systematic debugging
- `/document-release` - Post-ship documentation update
- `/codex` - OpenAI Codex CLI wrapper
- `/cso` - Chief Security Officer mode
- `/autoplan` - Auto-review pipeline
- `/plan-devex-review` - Developer experience plan review
- `/devex-review` - Live developer experience audit
- `/careful` - Safety guardrails for destructive commands
- `/freeze` - Restrict file edits to a directory
- `/guard` - Full safety mode
- `/unfreeze` - Clear freeze boundary
- `/gstack-upgrade` - Upgrade gstack
- `/learn` - Manage project learnings

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. The
skill has multi-step workflows, checklists, and quality gates that produce better
results than an ad-hoc answer. When in doubt, invoke the skill. A false positive is
cheaper than a false negative.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke /office-hours
- Strategy, scope, "think bigger", "what should we build" → invoke /plan-ceo-review
- Architecture, "does this design make sense" → invoke /plan-eng-review
- Design system, brand, "how should this look" → invoke /design-consultation
- Design review of a plan → invoke /plan-design-review
- Developer experience of a plan → invoke /plan-devex-review
- "Review everything", full review pipeline → invoke /autoplan
- Bugs, errors, "why is this broken", "this doesn't work" → invoke /investigate
- Test the site, find bugs, "does this work" → invoke /qa (or /qa-only for report only)
- Code review, check the diff, "look at my changes" → invoke /review
- Visual polish, design audit, "this looks off" → invoke /design-review
- Developer experience audit, try onboarding → invoke /devex-review
- Ship, deploy, create a PR, "send it" → invoke /ship
- Merge + deploy + verify → invoke /land-and-deploy
- Configure deployment → invoke /setup-deploy
- Post-deploy monitoring → invoke /canary
- Update docs after shipping → invoke /document-release
- Weekly retro, "how'd we do" → invoke /retro
- Second opinion, codex review → invoke /codex
- Safety mode, careful mode, lock it down → invoke /careful or /guard
- Restrict edits to a directory → invoke /freeze or /unfreeze
- Upgrade gstack → invoke /gstack-upgrade
- Save progress, "save my work" → invoke /context-save
- Resume, restore, "where was I" → invoke /context-restore
- Security audit, OWASP, "is this secure" → invoke /cso
- Make a PDF, document, publication → invoke /make-pdf
- Launch real browser for QA → invoke /open-gstack-browser
- Import cookies for authenticated testing → invoke /setup-browser-cookies
- Performance regression, page speed, benchmarks → invoke /benchmark
- Review what gstack has learned → invoke /learn
- Tune question sensitivity → invoke /plan-tune
- Code quality dashboard → invoke /health
