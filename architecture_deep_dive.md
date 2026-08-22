# LaHacks26 — OceanOps: Technical Architecture Deep Dive

## What Is This?

**OceanOps** is an Ocean Alkalinity Enhancement (OAE) simulation and fleet-management platform built for LA Hacks 2026. The domain is marine carbon removal: ships disperse alkaline feedstock (olivine minerals or sodium hydroxide) into the ocean to chemically increase CO₂ absorption.

The app simulates the chemistry, monitors the fleet, routes ships to optimal deployment zones, and provides AI-generated safety analysis — all running **fully locally** with no cloud LLM dependencies.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Browser (React + Vite, port 5173)                                       │
│  ┌─────────────┐  ┌─────────────────┐  ┌──────────────────┐            │
│  │ MissionCtrl │  │ GlobalIntell.   │  │ RoutePlanning    │            │
│  │ (simulate)  │  │ (globe + data)  │  │ (AI fleet route) │            │
│  └──────┬──────┘  └────────┬────────┘  └────────┬─────────┘            │
│         │                  │                     │                       │
│  ┌──────▼──────────────────▼─────────────────────▼──────────────────┐  │
│  │          React Query (shared cache for fleet / traffic / health)   │  │
│  │       + NATS WebSocket subscription (real-time 1Hz updates)        │  │
│  └──────────────────────────────┬────────────────────────────────────┘  │
└─────────────────────────────────┼──────────────────────────────────────┘
                                  │ HTTP + WS
┌─────────────────────────────────▼──────────────────────────────────────┐
│  FastAPI Backend (uvicorn, port 8000)                                    │
│                                                                          │
│  Routers:                                                                │
│  /simulate      /fleet      /traffic     /health                         │
│  /analyze       /discover   /hotspots    /mpas                           │
│  /ocean         /route-plan                                              │
│                                                                          │
│  Background Services:                                                    │
│  ├── ais_worker.py  (subprocess — WebSocket to aisstream.io)            │
│  ├── data_fetcher.py (NOAA ERDDAP + CalCOFI pre-cache thread)           │
│  └── NATS publishers (HealthPublisher, FleetPublisher, AISPublisher)     │
│                                                                          │
│  AI Agents (Gemma4 via Ollama → rule-based fallback):                   │
│  ├── GeochemistAgent    → safety_assessment + co2_projection             │
│  └── SpatialIntelligenceAgent → suitability_score + site reasoning      │
└─────────────────────────────────┬──────────────────────────────────────┘
                ┌──────────────────┼───────────────────┐
                │                  │                   │
       ┌────────▼──────┐  ┌────────▼──────┐  ┌────────▼──────┐
       │ Ollama/Gemma4 │  │ Julia/CUDA    │  │ NATS JetStream│
       │ (port 11434)  │  │ (Oceananigans)│  │ (port 4222)   │
       └───────────────┘  └───────────────┘  └───────────────┘
```

---

## Backend Deep Dive

### `main.py` — Startup Orchestrator

This is the FastAPI app entry point. On startup (via `lifespan`), it does **three things concurrently**:

1. **Ocean data pre-cache** — calls `data_fetcher.refresh_all()` in a daemon thread. This fires HTTP requests to NOAA ERDDAP and CalCOFI before any user request arrives, so the first `/simulate` call is fast.

2. **AIS subprocess** — calls `ais_stream.stream_forever()`, which spawns `ais_worker.py` as a child process. The worker maintains a WebSocket to `aisstream.io` and writes vessels to `data/real/ais_live.json` every 5 seconds. The parent then bridge-publishes that file to NATS.

3. **NATS publishers** — attempts to connect to a NATS JetStream server. If available, starts `HealthPublisher` and `FleetPublisher` which push real-time telemetry. If NATS isn't running, the system silently falls back to HTTP polling — **everything works either way**.

---

### Routers (API Surface)

| Router | Endpoint(s) | Purpose |
|--------|-------------|---------|
| `health.py` | `GET /health` | System status: Ollama, Julia, AIS, NATS — polled every 5s by frontend header chips |
| `fleet.py` | `GET /fleet` | Returns mock fleet of ~3 OAE ships with real-time position + CO₂ stats |
| `traffic.py` | `GET /traffic` | Returns AIS vessel list from live file or curated mock data |
| `simulation.py` | `POST /simulate` | **Core endpoint** — runs OAE plume dispersion simulation |
| `analysis.py` | `POST /analyze` | Calls `GeochemistAgent` → Gemma4 safety + CO₂ narrative |
| `discovery.py` | `POST /discover` | Calls `SpatialIntelligenceAgent` → ranked deployment zones |
| `hotspot.py` | `GET/POST /hotspots` | Per-coordinate deep impact analysis (plume area, pH, economics) |
| `oceanographic.py` | `GET /ocean` | Returns real NOAA/CalCOFI ocean state for a lat/lon |
| `mpas.py` | `GET /mpas` | GeoJSON of Marine Protected Areas for map overlay |
| `route_plan.py` | `POST /route-plan` | Server-side TSP route computation (alternative to client-side) |

---

### `simulation.py` — The Core Physics Engine

This is the most complex endpoint. The behavior depends on whether Julia is available:

**Path A — Julia live (`USE_MOCK=False`):**
1. Fetches real ocean conditions from NOAA ERDDAP + CalCOFI
2. Injects real T/S/MLD into the simulation request
3. Calls `run_julia_simulation()` → shells out to Julia/Oceananigans for GPU-accelerated plume CFD
4. Returns a 3D field of alkalinity and aragonite saturation

**Path B — Physics-based mock (`USE_MOCK=True`, default):**
1. Still fetches real ocean conditions (live data!)
2. Calls `generate_plume_from_conditions()` — a Python physics model parameterized by real SST, salinity, and MLD
3. Labels result `source: "live-conditions"` so the frontend can show the data provenance

**Path C — Full offline fallback:**
- Loads static `data/mock/*.json` files when no network is available

After simulation, every result gets:
- `mrv_hash`: SHA-256 of the simulation output for tamper-evident MRV (Monitoring, Reporting, Verification) — appended to `data/mrv_log.jsonl`
- `viability`: a deterministic rule-based assessment (NO latency, no LLM in the hot path)

The Gemma4 enrichment is **intentionally deferred** to the separate `/analyze` call, which the user triggers manually.

---

### AI Agents

#### `agents/base.py`
Shared utilities for all agents:
- `OLLAMA_URL` + `GEMMA_MODEL` from env vars (defaults: `localhost:11434`, `gemma4:e4b`)
- `is_ollama_available()` — checks `/api/tags`, verifies model is loaded, 2s timeout
- `query_gemma(prompt, system, timeout)` — POSTs to Ollama `/api/generate` with `temperature=0.3`, `num_predict=512`, streaming disabled → structured JSON output
- `extract_json(text)` — regex extracts first `{...}` block from LLM response

#### `agents/geochemist.py` — `GeochemistAgent`
The safety analysis agent. Always runs **3 deterministic tool functions first**, then optionally calls Gemma4:

| Tool | Input | Output |
|------|-------|--------|
| `check_aragonite_threshold(Ω)` | aragonite saturation value | safe bool + margin below limit (30.0) |
| `check_alkalinity_threshold(TA)` | total alkalinity µmol/kg | safe bool + margin below limit (3500) |
| `project_co2_removal(TA, T, km²)` | chemistry + area | tons CO₂ removed over 10 years |

Gemma4 receives the JSON tool outputs and synthesizes: `safety_assessment` (string), `co2_projection` (string), `recommendations` (list). If Gemma is offline, `_rule_based_synthesis()` composes the same fields deterministically.

#### `agents/spatial_intelligence.py` — `SpatialIntelligenceAgent`
The site-selection agent. Runs 2 deterministic tools, then calls Gemma4:

| Tool | Input | Output |
|------|-------|--------|
| `get_mpa_overlap(lat, lon, radius_km)` | position + radius | overlaps bool + MPA name |
| `get_ocean_state(lat, lon)` | position | T/S/MLD/alkalinity/suitability from CalCOFI dataset |

Gemma4 synthesizes: `suitability_score` (0–1), `reason` (string), `mpa_conflict` (bool). Fallback uses the raw CalCOFI suitability score ± MLD/MPA adjustments.

---

### AIS Vessel Pipeline

```
aisstream.io WebSocket
    │
    ▼
ais_worker.py  (subprocess, own event loop)
    │  writes every 5s
    ▼
data/real/ais_live.json
    │
    ├── /traffic endpoint reads JSON directly
    │
    └── _nats_file_bridge() (every 2s)
            │  publishes ais.batch
            ▼
        NATS JetStream → frontend WS subscription
```

The subprocess isolation is intentional: the main FastAPI event loop never blocks on WebSocket I/O, and if the AIS worker crashes it can be restarted without touching the server.

Conflict detection (`_has_conflict`) checks whether a vessel is within 1.5° (~167km) of predefined OAE deployment zones and flags it as a conflict risk.

---

### NATS Real-Time Layer

NATS JetStream is an optional overlay that replaces polling when available:

| Subject | Publisher | Payload | Default without NATS |
|---------|-----------|---------|----------------------|
| `health.backend` | `HealthPublisher` (every 5s) | backend status | HTTP poll every 5s |
| `fleet.*.position` | `FleetPublisher` (every 1s per ship) | lat/lon/heading/speed | HTTP poll every 10s |
| `ais.batch` | `AISPublisher` (every 2s) | vessel array | HTTP poll every 30s |

The frontend `useNatsSubscription` hook subscribes to these subjects and patches the React Query cache in-place. When a NATS position message arrives, only the specific ship object is mutated — the rest of the fleet array stays untouched.

---

## Frontend Deep Dive

### Entry Point — `App.tsx`

The root component owns the three **shared, top-level data fetches** that all three pages consume:

```tsx
fleet  → GET /fleet       (10s polling, or NATS fleet.*.position at 1Hz)
traffic → GET /traffic    (30s polling, or NATS ais.batch at 2s)
health  → GET /health     (5s polling, or NATS health.backend at 5s)
```

These are lifted here specifically so `MissionControl`, `GlobalIntelligence`, and `RoutePlanning` all share the **same React Query cache** — switching tabs never refetches, and NATS updates benefit all three pages simultaneously.

---

### Three Pages (Modes)

#### `MissionControl.tsx` — Primary Operations Dashboard
The active simulation view. Left sidebar has the parameter controls (vessel speed, discharge rate, feedstock type, ocean conditions). Center is a Mapbox map showing:
- Fleet ship markers with status
- Plume heatmap overlay (alkalinity / aragonite saturation gradient from Julia/mock data)
- MPA exclusion zones
- AIS traffic via `AISLayer`

Right sidebar shows: live ocean conditions chip, AI analysis panel (calls `/analyze` → Gemma4), impact metrics (CO₂ tons, pH delta), and the MRV hash display.

#### `GlobalIntelligence.tsx` — Strategic Overview
A global 3D/2D view that shows:
- `GlobalHotspot` scoring across open ocean — composite of SST, wind speed, latitude, and upwelling bonuses
- CalCOFI station network markers
- Per-hotspot deep analysis: plume projection, 10/50-year CO₂ removal, economics (carbon credit revenue), pH impact

#### `RoutePlanning.tsx` — AI Fleet Routing (your active file)
Two tabs:
- **AI Fleet tab**: clicks "Compute Routes" → `POST /discover` → `SpatialIntelligenceAgent` returns ranked `DiscoveryZone` list. `planFleetRoutes()` runs a greedy nearest-neighbor + TSP-ish assignment, then the route lines are drawn with the animated `trimRoute()` + `easeInOut()` + RAF loop.
- **Manual tab**: click-to-place waypoints, haversine distance calc, CO₂ cost estimate per segment.

Recent additions in the diffs you already have:
- `trimRoute(waypoints, progress)` — linearly interpolates along cumulative distances to produce a sub-route at progress 0–1
- Staggered animation: ship `i` starts its draw at `i × 18%` of the 1800ms window, so routes appear sequentially rather than all at once
- Draggable ship markers: `localPositions` state overrides the server position for route recomputation
- `AISLayer` extracted as a shared component (GPU-rendered GeoJSON cluster — no DOM nodes per vessel, handles 3000+ ships)

---

### Data & State Flow

```
App.tsx (React Query provider + NATS provider)
│
├── fleet[]    ──────► MissionControl, RoutePlanning (draggable markers)
├── traffic[]  ──────► GlobalIntelligence, RoutePlanning (AISLayer)
└── health     ──────► Header chips (latency, Gemma ✓/✗, GPU ✓/✗, NATS ✓/✗)

Per-page local state:
  MissionControl  → SimulationParams, SimulationResult, AnalysisResult
  GlobalIntell.   → selected hotspot, hotspot impact detail
  RoutePlanning   → hotspots[], localPositions{}, animProgress, routesComputed
```

---

### Key Shared Components

| Component | Purpose |
|-----------|---------|
| `AISLayer.tsx` | GeoJSON Source + cluster/dot Layers — GPU-rendered, zero DOM elements per vessel |
| `MPAOverlay.tsx` | Fetches `/mpas`, renders GeoJSON fill layer as hatched exclusion zones |
| `ShipMarker.tsx` | Animated SVG ship icon, color-coded by status, tooltip with CO₂/speed |
| `PlumeHeatmap.tsx` | Converts simulation `fields.alkalinity[][]` into a Mapbox heatmap layer |
| `ImpactMetrics.tsx` | Animated counter cards for CO₂ removed, pH delta, plume area |
| `FleetPanel.tsx` | Scrollable ship list for left sidebar |
| `TourOverlay` | Per-mode guided tour system using `data-tour` attributes as anchors |

---

### Key Libraries

| Library | Role |
|---------|------|
| `react-map-gl` + Mapbox GL | Interactive map, GPU-rendered GeoJSON layers |
| `@tanstack/react-query` | Shared data fetching, caching, and polling |
| `framer-motion` | Spring animations, stagger lists, page transitions |
| `nats.ws` | WebSocket NATS client for real-time subscriptions |
| `three.js` | 3D globe in GlobalIntelligence (mounted on a canvas layer) |

---

## Data Layer

```
data/
├── mock/
│   ├── calcofi_stations.json   ← Station T/S/MLD/alkalinity used by SpatialIntelligenceAgent
│   ├── fleet_data.json         ← Simulated ship positions + status
│   └── ais_vessels.json        ← Curated fallback AIS vessels (no API key needed)
├── real/
│   └── ais_live.json           ← Written by ais_worker.py subprocess (live vessels)
└── mrv_log.jsonl               ← Append-only MRV audit trail (timestamp + SHA-256 hash + params)
```

The `mrv_log.jsonl` file is append-only by design. Each simulation appends one line with a SHA-256 hash of the result. This creates a tamper-evident audit trail for carbon credit MRV compliance — regulators can verify any past simulation by rehashing the params.

---

## Startup Sequence Summary

```
./start.sh
├── 1. ollama pull gemma4:e4b    (downloads if missing)
├── 2. ollama run gemma4:e4b     (warm-up inference)
├── 3. uvicorn main:app          (FastAPI, port 8000)
│       ├── data_fetcher.refresh_all()   [thread]
│       ├── ais_stream.stream_forever()  [asyncio task → subprocess]
│       └── NATS publishers              [asyncio tasks]
└── 4. npm run dev               (Vite, port 5173)
```

Everything degrades gracefully: Julia missing → physics mock, NATS missing → HTTP polling, Gemma4 missing → rule-based fallback, `AISSTREAM_API_KEY` missing → curated vessel data.
