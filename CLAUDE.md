# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**The Tiered Edge Fleet** is an Ocean Alkalinity Enhancement (OAE) simulation platform for LA Hacks 2026. It simulates chemical plume dispersion from ship-based alkalinity deployment, with AI-powered safety analysis.

Target hardware: ASUS Ascent GX10 (NVIDIA GB10 Grace Blackwell, 128GB unified memory)

Judging tracks: Sustainability, ASUS Challenge, Arista Networks "Connect the Dots", Best Use of Google Gemma

## Development Commands

### Backend (FastAPI)
```bash
cd backend
source venv/bin/activate
uvicorn main:app --port 8001 --reload
```

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
ollama run gemma4:e4b               # Terminal 2 (first time — downloads and runs the 4B model)
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
│  │ POST /agent           — dispatch to ADK agents                      │    │
│  │ POST /discover        — AI-recommended deployment zones             │    │
│  │ POST /hotspot-impact  — deep-dive metric analysis for a site        │    │
│  │ GET  /ocean-state     — real-time ocean conditions for a lat/lon    │    │
│  │ GET  /oceanographic   — CalCOFI station data                        │    │
│  │ GET  /traffic         — AIS vessel traffic                          │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ ADK Agents (backend/agents/)                                        │    │
│  │ • SpatialIntelligenceAgent — site selection scoring                 │    │
│  │ • GeochemistAgent — safety analysis, CO₂ projection                 │    │
│  │ Fallback chain: Gemini 2.0 Flash → Ollama/Gemma4 → Rule-based       │    │
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

### Backend Key Files
- `backend/main.py` - FastAPI server with all endpoints — CORS allows `localhost:3000` and `3001`
- `backend/agents/spatial_intelligence.py` - Site selection scoring agent
- `backend/agents/geochemist.py` - Safety analysis agent with function calling
- `backend/agents/base.py` - ADK agent base class and helpers
- `julia/plume_simulator.jl` - Oceananigans.jl LES simulation (requires Julia + CUDA)
- `data/mock/plume_simulation.json` - Pre-computed fallback plume data
- `data/mock/calcofi_stations.json` - CalCOFI oceanographic station data (real data, local cache)
- `data/mrv_log.jsonl` - MRV cryptographic hash log

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
- Three-panel: left (route controls) + map + right (AIS Traffic)
- Hint card animates out when first waypoint placed
- Undo Last removes last waypoint; Clear All removes all; individual waypoints removable by click
- Route line: glow layer (14px blur) + dashed solid line (2.5px)
- Waypoint markers: cyan circles with numbered labels, spring-animate in on placement
- AIS traffic: SVG arrow markers on map, ship-card style in right sidebar with amber pip
- Segment cards stagger in, total CO₂ shown in green summary row

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

### MRV (Measurement, Reporting, Verification)
Every simulation result is hashed (SHA-256) and logged to `data/mrv_log.jsonl` for tamper-evident carbon credit verification. The hash is displayed in the Impact Metrics overlay.

## Offline-First Design

The platform must work without internet (ship at sea scenario):
- Backend auto-detects Julia availability and falls back to mock data
- AI analysis falls back: ADK agent → Ollama/Gemma4 → rule-based logic
- All external API data is mocked (MarineTraffic, CalCOFI)

## Environment Variables

Frontend (`frontend/.env`):
```
VITE_MAPBOX_TOKEN=your-token
VITE_API_URL=http://localhost:8001  # optional
```

Backend (optional):
```
GOOGLE_API_KEY=your-key  # Enables Gemini 2.0 Flash in ADK agents
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
