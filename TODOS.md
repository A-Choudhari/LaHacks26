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
- [x] **phase:ui1** — Full UI overhaul (Framer Motion, Radix Slider, minimal dark theme, custom ship SVG markers, organic MPA blobs, sliding feedstock control, spring animations throughout)
- [x] **U1** — Mode switcher: sliding segmented control in header (`mode-seg` / `mode-seg-track` / `mode-seg-btn`), spring-animated pill indicator, `header-center` absolutely positioned
- [x] **U4** — Global Intelligence UI: organic OAE zone blobs with glow layers, zone cards matching ship-card style (pip + name + label + score + chevron), stagger animations, CalCOFI stat-cards, zone detail popup (top-center AnimatePresence slide-down), discovery zone cards clickable, `zoneTier()` handles string/number scores from Mapbox
- [x] **U5** — Route Planning UI: three-panel layout (controls + map + AIS Traffic right sidebar), animated hint card, CO₂ estimate banner, Undo Last + Clear All buttons, staggered segment cards with cyan numbered circles, SVG arrow traffic markers, glow+dashed route line layers, clickable waypoint removal
- [x] App split into separate page/component files (`types.ts`, `constants.ts`, `pages/`, `components/ui/`, `components/shared/`, `components/mission/`)
- [x] CORS fix — added `localhost:3001` to allowed origins in `backend/main.py`
- [x] `package.json` fixed — removed duplicate `@tanstack/react-query`, added missing comma before `three`
- [x] Mission Control map zoom on load changed from 8.5 → 7 (shows more Pacific coast context)
- [x] Favicon — custom sailboat + waves SVG at `frontend/public/favicon.svg`; cache-busted via `?v=2` in `index.html`
- [x] **GB10 Julia/CUDA validated** — Julia 1.12.5 + CUDA 13.0 local toolkit confirmed on ASUS Ascent GX10 (driver 580, sm_121 Blackwell, 113 GiB). Fix: `CUDA.set_runtime_version!(v"13.0", local_toolkit=true)` to resolve 12.6→13.0 mismatch. Live simulation path is go.

---

## UI Phase 2 — Completed

- [x] **U2** — Ship marker tooltips: `ShipMarker` accepts `name/lat/lon/co2` props; `AnimatePresence` tooltip above marker shows name, status badge, CO₂, coordinates on hover
- [x] **U3** — AI typewriter: `TypewriterText` component in `AIPanel.tsx` types each character at 12ms/char with blinking `▌` cursor; recommendations stagger in as list items after typewriter finishes
- [x] **U6** — Loading skeletons: `FleetPanel` accepts `isLoading` prop; shows 3 shimmer skeleton cards (CSS `@keyframes shimmer`) while fleet data loads; stat tiles also shimmer
- [x] **U7** — Count-up animation: `useCountUp` hook in `ImpactMetrics.tsx` animates from previous value to new value with cubic ease-out over 700ms using `requestAnimationFrame`
- [x] **U8** — Header status chips: `/health` polled every 5s; shows latency (ms), Gemma ✓/✗, Live/Mock data source as small color-coded chips; fade-in on first load
- [x] **U9** — Responsive: at 1100px sidebar narrows to 240px and chips hide; at 860px sidebars collapse entirely so map takes full width
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
**Status:** ✅ DONE — GB10 CUDA validated. Julia 1.12.5 + CUDA 13.0 local toolkit, driver 580, sm_121 Blackwell, 113 GiB available. Required `CUDA.set_runtime_version!(v"13.0", local_toolkit=true)` to resolve 12.6→13.0 version mismatch. Live simulation path is confirmed working.

---

## Remaining Tasks

### 2D Section Cut (vertical cross-section matrix)
**Priority:** LOW
**Effort:** 2 hours
**What:** Add a horizontal slider to the UI that selects a depth level `z`. Render a colored flat plane at that z-slice showing alkalinity concentration as a texture. Use `THREE.PlaneGeometry` with a `DataTexture` mapped from the 2D slice of `fields.alkalinity`.
**Why:** Section cuts let judges see subsurface plume structure without needing full 3D navigation
**Depends on:** ThreeLayer.ts (complete)
**Status:** ✅ DONE — Added depth slider in Mission Control "3D Visualization" panel; `buildSectionCut()` renders a colored plane at the selected depth with alkalinity mapped to a gradient texture (blue→cyan→green→yellow→orange)

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
