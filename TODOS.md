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

---

## UI Phase 2 — Remaining UI Polish

### U2. Ship marker tooltips on hover
**Priority:** HIGH
**What:** On hover over a ship SVG marker on the map, show a floating tooltip with ship name, status, position (lat/lon), and CO₂ removed. Use a `motion.div` that fades in with scale.
**Why:** The map markers are now visually rich but carry no readable info on hover
**Status:** TODO

### U3. AI Analysis panel — streaming / typewriter text
**Priority:** MEDIUM
**What:** When Gemma returns analysis text, animate it in character-by-character (typewriter effect) using a `useEffect` + `useState` interval. Add a blinking cursor while typing.
**Why:** Makes the AI feel alive and responsive rather than text popping in all at once
**Status:** TODO

### U6. Loading skeletons
**Priority:** MEDIUM
**What:** While fleet data is loading, show 3 pulsing skeleton ship cards in the right panel. While simulation is running, show a shimmer placeholder in the result area. Use CSS `@keyframes` shimmer (no extra lib needed).
**Why:** Currently panels either show nothing or snap in — skeletons make the loading state feel intentional
**Status:** TODO

### U7. Impact metrics — animated number count-up
**Priority:** LOW
**What:** When CO₂ numbers change (fleet load, new simulation), animate the value counting up from the previous value using Framer Motion's `useMotionValue` + `animate()`. Duration ~0.6s with easeOut.
**Why:** Numbers that count up read as live data, not static labels
**Status:** TODO

### U8. Header system status indicators
**Priority:** LOW
**What:** Add small status chips next to "System Online": backend latency (ms), Ollama status (online/offline), data source (live/mock). Poll `/health` every 5s. Each chip fades in/out on status change.
**Why:** Makes the header feel like mission control monitoring rather than just a title bar
**Status:** TODO

### U9. Responsive / narrow viewport
**Priority:** LOW
**What:** Below 1200px width, collapse sidebars into bottom sheet drawers that slide up on a tab press. Map takes full screen. Uses `AnimatePresence` + `y` spring for the drawer.
**Why:** Judges may demo on a laptop — the three-panel layout breaks below ~1100px
**Status:** TODO
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
