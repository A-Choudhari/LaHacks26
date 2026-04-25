# TODOS

## Completed

- [x] FastAPI backend with /health, /simulate, /fleet, /analyze endpoints
- [x] React + Mapbox frontend with Mission Control layout
- [x] 2D heatmap visualization for plume dispersion
- [x] Fleet dashboard for Arista "Connect the Dots" challenge
- [x] AI analysis endpoint with Gemma 2 / rule-based fallback
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
**Status:** TODO

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
**Status:** TODO (in-memory Gaussian fallback exists but is thin)

### 4. Set up Ollama with Gemma 2
**Priority:** HIGH
**Effort:** 15 minutes
**What:** `ollama serve` in Terminal 1, `ollama pull gemma2` in Terminal 2
**Why:** The `/analyze` endpoint falls back to rule-based text without it — the Gemma judging track needs real LLM output
**Status:** TODO (rule-based fallback works but won't impress the Gemma judges)

---

## Phase 1 — Environment & Simulation (Advanced Viz)

### 5. Install Three.js and wire up a canvas layer
**Priority:** HIGH
**Effort:** 30 minutes
**What:** `npm install three @types/three` in `frontend/`. Add a `<canvas>` element overlaid on the Mapbox map. Create `frontend/src/ThreeCanvas.tsx` that syncs camera projection with Mapbox viewport on each `move` event.
**Why:** All three advanced viz items (isosurface, streamlines, section cut) need a shared Three.js canvas that co-registers with the map. This is the foundation — nothing else in Phase 1 advanced viz is buildable without it.
**Status:** TODO

### 6. Isosurface bounding box
**Priority:** MEDIUM
**Effort:** 2–3 hours
**What:** In `ThreeCanvas.tsx`, render a wireframe bounding box around the plume's Ω_aragonite > threshold isosurface. Use `simulation.coordinates` (x/y/z arrays) and `simulation.fields.aragonite_saturation` from the `/simulate` response to compute the bounding volume. Map x/y to lat/lon offsets from the ship position and z to altitude.
**Why:** Gives judges a 3D spatial intuition for how far the plume spreads — more impressive than the 2D heatmap alone
**Depends on:** Task 5
**Status:** TODO

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
**Effort:** 1 hour
**What:** Wrap `AppContent` in a mode context. Add a top-nav with three buttons: **Global Intelligence** | **Mission Control** | **Route Planning**. The current layout becomes Mode 2 (Mission Control). Modes 1 and 3 render placeholder panels initially.
**Why:** Judges will expect to see a mode switcher — even with only Mode 2 fully implemented, showing the navigation frame makes the vision legible
**Status:** TODO

### 10. Mode 1: Global Ocean Intelligence
**Priority:** MEDIUM
**Effort:** 3–4 hours
**What:** Global view centered on the Pacific. Show candidate OAE deployment zones as colored polygons (high TA uptake potential, away from MPAs). Pull CalCOFI station data (or mock it) to overlay temperature/salinity gradients. Add a "Best Zones" highlight layer driven by the Spatial Intelligence agent (Task 15).
**Why:** Addresses the "site selection" gap in Phase 3 Agent 1 and satisfies the sustainability judging track with a global picture
**Depends on:** Task 9, can stub agent output
**Status:** TODO

### 11. Mode 3: Route Planning
**Priority:** LOW
**Effort:** 3–4 hours
**What:** Allow the user to click waypoints on the map. Draw a route line. For each waypoint show the projected alkalinity discharge and cumulative CO₂ removal along the route. Add an "Optimize Route" button that calls a new `POST /route` endpoint returning the highest-efficiency path between waypoints.
**Why:** Directly addresses the Arista "Connect the Dots" challenge — ships connected by an optimized route is a compelling network story
**Depends on:** Task 9
**Status:** TODO

---

## Phase 2 — Arista Dashboard

### 12. CalCOFI oceanographic data integration
**Priority:** MEDIUM
**Effort:** 2–3 hours
**What:** Add a `GET /oceanographic` backend endpoint. Fetch CalCOFI station data from `calcofi.io/api` (or load from `data/mock/calcofi_stations.json`). Return temperature, salinity, and chlorophyll at each station. Render as colored circles on the map in Mode 1.
**Why:** Makes the platform data-backed rather than purely synthetic — judges in the sustainability track will look for real oceanographic grounding
**Offline fallback:** Save 20–30 station records to `data/mock/calcofi_stations.json` so the demo works without internet
**Status:** TODO

### 13. Enhanced MarineTraffic vessel traffic (or mock AIS)
**Priority:** MEDIUM
**Effort:** 1–2 hours
**What:** Add a `GET /traffic` backend endpoint returning mock AIS vessel positions near the deployment zone (container ships, tankers with lat/lon/heading). Render as directional triangle markers on the map. Show a "Conflict Zone" warning if a vessel track intersects the plume bounding box.
**Why:** Demonstrates the fleet coordination story for the Arista challenge — the network connects ships intelligently by avoiding traffic conflicts
**Status:** TODO

### 14. Discovery Mode (AI-recommended deployment zones)
**Priority:** MEDIUM
**Effort:** 2 hours
**What:** Add a `POST /discover` endpoint that takes ocean state params and returns a list of `{lat, lon, score, reason}` objects. Drive the scoring with a simple rule set (high MLD → better mixing, away from MPAs, low existing TA → more headroom) or delegate to the Spatial Intelligence agent (Task 15). Render as glowing pulses on the map.
**Why:** Turns the platform from a passive simulator into an active recommender — much stronger demo narrative
**Depends on:** Task 10 (Mode 1 map canvas)
**Status:** TODO

---

## Phase 3 — Google ADK Agents

### 15. Google ADK setup and base agent scaffold
**Priority:** HIGH
**Effort:** 1–2 hours
**What:** `pip install google-adk` (already in requirements). In `backend/`, create `agents/base.py` with an `ADKAgent` base class wrapping `google.adk.Agent`. Wire a `POST /agent` endpoint that routes requests to the right agent by `agent_type` field.
**Why:** ADK is listed in requirements but not used — without the scaffold, Agents 1–3 can't be built. This unblocks everything in Phase 3.
**Status:** TODO (in requirements, not integrated)

### 16. Agent 1: Spatial Intelligence (site selection)
**Priority:** HIGH
**Effort:** 2–3 hours
**What:** Create `agents/spatial_intelligence.py`. The agent takes `{lat, lon, radius_km}` and calls two function tools: `get_mpa_overlap(lat, lon, radius)` → bool and `get_ocean_state(lat, lon)` → temperature/salinity/MLD. Returns a `suitability_score` (0–1) and a `reason` string. Call this agent from the `POST /discover` endpoint (Task 14).
**Why:** Fills the "site selection logic missing" gap. A proper ADK agent with function calling is a much stronger story for the Google Gemma judging track than a single prompt.
**Depends on:** Task 15
**Status:** TODO

### 17. Agent 2: Geochemist / Dispatcher (dedicated, with function calling)
**Priority:** HIGH
**Effort:** 2–3 hours
**What:** Refactor `POST /analyze` to call `agents/geochemist.py` instead of inline prompt logic. The agent calls three function tools: `check_aragonite_threshold(value)`, `check_alkalinity_threshold(value)`, and `project_co2_removal(alkalinity, temp, area)`. Returns structured `{safety_assessment, co2_projection, recommendations}`. Keep the rule-based fallback if ADK call fails.
**Why:** Separates the combined `/analyze` endpoint into a proper agent with observable tool calls — the judging demo becomes "watch the agent reason step by step" rather than "here is text"
**Depends on:** Task 15
**Status:** TODO (currently combined into a single prompt in `/analyze`)

### 18. Agent 3: Verdict Logger (cryptographic MRV proof)
**Priority:** MEDIUM
**Effort:** 2–3 hours
**What:** Create `agents/verdict_logger.py`. After each simulation, the agent: (1) hashes the full `SimulationResult` dict with SHA-256, (2) appends `{timestamp, hash, params_summary, verdict}` to `data/mrv_log.jsonl`, (3) returns the hash to the frontend. Display the hash in the Impact Metrics overlay as a "MRV Proof" badge.
**Why:** Addresses the cryptographic MRV logging gap. A tamper-evident audit trail is compelling for the sustainability track — carbon credits need verifiable records.
**Depends on:** Task 15
**Status:** TODO

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
