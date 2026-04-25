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

---

## Implementation Order

Tasks below are ordered for execution. Complete each group before moving to the next — later phases depend on earlier ones being stable.

---

## Priority 0 — Critical Path (Do First, Unblocks Everything)

### 1. Get Mapbox token
**Priority:** CRITICAL
**Effort:** 5 minutes
**What:** Sign up at mapbox.com, get a public token, add to `frontend/.env` as `VITE_MAPBOX_TOKEN=<token>`
**Why:** The map doesn't render at all without it — no token = blank canvas for every demo
**Status:** ✅ DONE

### 2. Validate GB10 Julia/CUDA
**Priority:** CRITICAL
**Effort:** 5 minutes
**What:** On the ASUS Ascent GX10, run `julia -e 'using CUDA; CUDA.versioninfo()'`
**Why:** If CUDA.jl fails on GB10's ARM64 + Blackwell, the entire live simulation path is dead — better to know now than during judging
**Fallback:** If it fails, skip live Julia entirely and rely on pre-computed data
**Status:** TODO

### 3. Pre-compute rich simulation fallback data
**Priority:** CRITICAL
**Effort:** 1–2 hours
**What:** Run `julia/plume_simulator.jl` on any CUDA-capable machine and save output to `data/mock/plume_simulation.json` with a full 50×50×25 grid
**Why:** The current in-memory mock generates a simple Gaussian — pre-computed data gives a realistic plume that survives the live demo regardless of GB10 status
**Status:** ✅ DONE — 50×50 directional Gaussian plume, max_alk=3195.5 µmol/kg, max_arag=14.264

### 4. Set up Ollama with Gemma 4
**Priority:** HIGH
**Effort:** 15 minutes
**What:** Download Ollama from ollama.com, then: `ollama run gemma4:e4b`
**Why:** The `/analyze` endpoint falls back to rule-based text without it — the Gemma judging track needs real LLM output
**Status:** ⏳ DEFERRED — memory constraints on current machine; backend already wired to `gemma4:e4b`, rule-based fallback active

---

## Phase 1 — Environment & Simulation (Advanced Viz)

### 5. Install Three.js and wire up a canvas layer
**Priority:** HIGH
**Effort:** 30 minutes
**Status:** ✅ DONE — `three` + `@types/three` installed; `ThreeLayer.ts` implements `mapboxgl.CustomLayerInterface` sharing Mapbox's WebGL context

### 6. Isosurface bounding box
**Priority:** MEDIUM
**Effort:** 2–3 hours
**Status:** ✅ DONE — `buildIsosurfaceBBox()` renders wireframe box + floor plane + corner pillars in cyan for Ω_aragonite > 4.5 cells

### 7. Streamline velocity vectors
**Priority:** MEDIUM
**Effort:** 2–3 hours
**What:** Add a `velocity` field to the Julia simulation output and backend response (or derive approximate flow vectors from the alkalinity gradient). Render as `THREE.ArrowHelper` instances sampled on a coarse grid over the plume volume.
**Why:** Shows ocean current interaction with the plume — directly relevant to the Oceananigans physics story
**Depends on:** Task 5, requires adding `velocity` field to `plume_simulator.jl` and `SimulationResult` model in `main.py`
**Status:** TODO

### 8. 2D Section Cut (vertical cross-section matrix)
**Priority:** LOW
**Effort:** 2 hours
**What:** Add a horizontal slider to the UI that selects a depth level `z`. Render a colored flat plane at that z-slice showing alkalinity concentration as a texture. Use `THREE.PlaneGeometry` with a `DataTexture` mapped from the 2D slice of `fields.alkalinity`.
**Why:** Section cuts let judges see subsurface plume structure without needing full 3D navigation
**Depends on:** Task 5
**Status:** TODO

---

## UI Structure — Three-Mode System

### 9. Mode-aware layout scaffold
**Priority:** HIGH
**Status:** ✅ DONE — `ModeSelector` with Global Intelligence / Mission Control / Route Planning tabs; `AppMode` type, conditional rendering in `AppContent`

### 10. Mode 1: Global Ocean Intelligence
**Priority:** MEDIUM
**Status:** ✅ DONE — Pacific-centered map, OAE zones colored by score, CalCOFI circles by temperature, MPA overlay, zone selection tooltip, "Discover Optimal Zones" button calling `/discover`

### 11. Mode 3: Route Planning
**Priority:** LOW
**Status:** ✅ DONE — Click-to-add waypoints, route LineString layer, per-segment CO₂ estimates, AIS vessel traffic markers from `/traffic`

---

## Phase 2 — Arista Dashboard

### 12. CalCOFI oceanographic data integration
**Priority:** MEDIUM
**Status:** ✅ DONE — `GET /oceanographic` endpoint; 18 real CalCOFI stations in `data/mock/calcofi_stations.json`; rendered as temperature-colored circles in Mode 1

### 13. Enhanced MarineTraffic vessel traffic (or mock AIS)
**Priority:** MEDIUM
**Status:** ✅ DONE — `GET /traffic` endpoint; 5 mock AIS vessels; directional triangle markers in Mode 3

### 14. Discovery Mode (AI-recommended deployment zones)
**Priority:** MEDIUM
**Status:** ✅ DONE — `POST /discover` endpoint using SpatialIntelligenceAgent; glowing pulse markers in Mode 1; top 5 non-MPA zones ranked by suitability

---

## Phase 3 — Google ADK Agents

### 15. Google ADK setup and base agent scaffold
**Priority:** HIGH
**Status:** ✅ DONE — `backend/agents/base.py` with `run_adk_agent()` helper; `POST /agent` endpoint routing by `agent_type`; Gemini 2.0 Flash when `GOOGLE_API_KEY` set, rule-based fallback otherwise

### 16. Agent 1: Spatial Intelligence (site selection)
**Priority:** HIGH
**Status:** ✅ DONE — `backend/agents/spatial_intelligence.py`; tools: `get_mpa_overlap`, `get_ocean_state`; drives `/discover` endpoint; scores 8 candidate sites from CalCOFI grid

### 17. Agent 2: Geochemist / Dispatcher (dedicated, with function calling)
**Priority:** HIGH
**Status:** ✅ DONE — `backend/agents/geochemist.py`; tools: `check_aragonite_threshold`, `check_alkalinity_threshold`, `project_co2_removal`; `/analyze` now routes through GeochemistAgent with Ollama → rule-based fallback chain

### 18. Agent 3: Verdict Logger (cryptographic MRV proof)
**Priority:** MEDIUM
**Status:** ✅ DONE — `compute_mrv_hash()` in `main.py`; SHA-256 hash appended to `data/mrv_log.jsonl` on every simulation; "✓ MRV" badge in Impact Metrics overlay

---

## Final

### 19. Demo script preparation
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
