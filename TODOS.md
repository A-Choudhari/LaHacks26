# TODOS

## Completed

- [x] FastAPI backend with /health, /simulate, /fleet, /analyze endpoints
- [x] React + Mapbox frontend with Mission Control layout
- [x] 2D heatmap visualization for plume dispersion
- [x] Fleet dashboard for Arista "Connect the Dots" challenge
- [x] AI analysis endpoint with Gemma 4 / rule-based fallback
- [x] Mock data fallback system (demo works without Julia)
- [x] Smoke test script for pre-demo verification
- [x] Map legend for alkalinity heatmap
- [x] Impact metrics overlay (CO₂ removed, safety status)
- [x] MPA (Marine Protected Area) overlay on map
- [x] Mapbox token configured
- [x] Ollama + Gemma 2 setup
- [x] Three.js and wire up a canvas layer (`three` + `@types/three` installed; `ThreeLayer.ts` implements `mapboxgl.CustomLayerInterface`)
- [x] Isosurface bounding box (`buildIsosurfaceBBox()` renders wireframe box + floor plane + corner pillars for Ω_aragonite > 4.5 cells)
- [x] Streamline velocity vectors (`buildVelocityArrows()` derives flow from alkalinity gradient, renders as `THREE.ArrowHelper` instances)
- [x] Mode-aware layout scaffold (`ModeSelector` with Global Intelligence / Mission Control / Route Planning tabs)
- [x] Mode 1: Global Ocean Intelligence (Pacific-centered map, OAE zones, CalCOFI circles, MPA overlay, `/discover` integration)
- [x] Mode 3: Route Planning (Click-to-add waypoints, route LineString, per-segment CO₂ estimates, AIS traffic markers)
- [x] CalCOFI oceanographic data integration (`GET /oceanographic`, 18 real stations in `data/mock/calcofi_stations.json`)
- [x] Enhanced MarineTraffic vessel traffic (`GET /traffic`, 5 mock AIS vessels, directional triangle markers)
- [x] Discovery Mode / AI-recommended deployment zones (`POST /discover` using SpatialIntelligenceAgent, glowing pulse markers)
- [x] Google ADK setup and base agent scaffold (`backend/agents/base.py`, `POST /agent` endpoint, Gemini 2.0 Flash + fallback)
- [x] Agent 1: Spatial Intelligence (`backend/agents/spatial_intelligence.py`, site selection from CalCOFI grid)
- [x] Agent 2: Geochemist / Dispatcher (`backend/agents/geochemist.py`, function calling, `/analyze` integration)
- [x] Agent 3: Verdict Logger / MRV proof (`compute_mrv_hash()` in `main.py`, SHA-256 hash, `data/mrv_log.jsonl`, "✓ MRV" badge)
- [x] Pre-compute rich simulation fallback data (50×50 directional Gaussian plume in `plume_simulation.json`)

---

## Implementation Order

Tasks below are ordered for execution. Complete each group before moving to the next — later phases depend on earlier ones being stable.

---

## Priority 0 — Critical Path

### 1. Validate GB10 Julia/CUDA
**Priority:** CRITICAL
**Effort:** 5 minutes
**What:** On the ASUS Ascent GX10, run `julia -e 'using CUDA; CUDA.versioninfo()'`
**Why:** If CUDA.jl fails on GB10's ARM64 + Blackwell, the entire live simulation path is dead — better to know now than during judging
**Fallback:** If it fails, skip live Julia entirely and rely on pre-computed data
**Status:** TODO

---

## Remaining Tasks

### 2D Section Cut (vertical cross-section matrix)
**Priority:** LOW
**Effort:** 2 hours
**What:** Add a horizontal slider to the UI that selects a depth level `z`. Render a colored flat plane at that z-slice showing alkalinity concentration as a texture. Use `THREE.PlaneGeometry` with a `DataTexture` mapped from the 2D slice of `fields.alkalinity`.
**Why:** Section cuts let judges see subsurface plume structure without needing full 3D navigation
**Depends on:** ThreeLayer.ts (complete)
**Status:** TODO

### Demo script preparation
**Priority:** HIGH
**Effort:** 30–45 minutes
**What:** Write a 3-minute narrated demo script hitting all four judging tracks:
- **Sustainability:** Show Mode 1 Global Intelligence → site selection → safe deployment → MRV proof hash
- **ASUS Challenge:** Mention GB10 Grace Blackwell running live Oceananigans.jl LES simulation
- **Arista "Connect the Dots":** Show fleet dashboard → 3 ships → route planning → conflict avoidance
- **Google Gemma:** Show Gemma 2 safety assessment → agent function calls → CO₂ projection

Include explicit fallback paths: if Julia fails → pre-computed data; if Ollama fails → rule-based text; if Mapbox fails → screenshot backup.
**Status:** TODO

---

## Stretch Goals (If Time Permits)

### Three.js true 3D volumetric rendering
**Priority:** LOW
**What:** Replace the isosurface wireframe with a real marching-cubes mesh using custom GLSL shaders for volume ray-casting.
**Status:** DEFERRED

### Marine health score
**Priority:** LOW
**What:** Add a composite ecosystem health index (chlorophyll proxy, biodiversity risk, MPA proximity) to the Impact Metrics overlay.
**Status:** DEFERRED

### Live MarineTraffic API
**Priority:** LOW
**What:** Replace mock AIS data with real MarineTraffic API calls (requires API key).
**Status:** DEFERRED
