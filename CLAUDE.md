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
│  │  • MPA Overlays • CalCOFI Stations • AIS Traffic       │               │
│  └────────────────────────────────────────────────────────┘               │
└─────────────────────────────────┬──────────────────────────────────────────┘
                                  │
                                  ▼ REST API
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Backend (FastAPI :8001)                           │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ Endpoints                                                           │    │
│  │ GET  /health       — system status                                  │    │
│  │ POST /simulate     — plume dispersion + MRV hash                    │    │
│  │ GET  /fleet        — OAE ship fleet status                          │    │
│  │ POST /analyze      — AI safety analysis (agent → Ollama → rules)    │    │
│  │ POST /agent        — dispatch to ADK agents                         │    │
│  │ POST /discover     — AI-recommended deployment zones                │    │
│  │ GET  /oceanographic— CalCOFI station data                           │    │
│  │ GET  /traffic      — AIS vessel traffic                             │    │
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
2. **Mission Control (Mode 2)**: Localized simulation view with 2D heatmap, 3D isosurface visualization, safety analysis, and impact metrics
3. **Route Planning (Mode 3)**: Click-to-add waypoints, route LineString layer, per-segment CO₂ estimates, AIS vessel traffic overlay

### Data Flow
1. **Mode 1**: Frontend calls `GET /oceanographic` and `POST /discover` → renders CalCOFI stations + AI-recommended zones
2. **Mode 2**: Frontend sends params to `POST /simulate` → Backend returns plume data with MRV hash → Frontend renders heatmap + Three.js isosurface → User clicks "Analyze" → `POST /analyze` → AI safety assessment
3. **Mode 3**: Frontend calls `GET /traffic` → renders AIS vessels; user builds route → per-segment CO₂ estimates

### Key Files
- `backend/main.py` - FastAPI server with /health, /simulate, /fleet, /analyze endpoints
- `frontend/src/App.tsx` - Single-file React app with all components
- `frontend/src/index.css` - All styles — design tokens live in `:root` at the top
- `frontend/src/lib/utils.ts` - `cn()` helper for class merging (clsx + tailwind-merge)
- `backend/main.py` - FastAPI server with all endpoints
- `backend/agents/spatial_intelligence.py` - Site selection scoring agent
- `backend/agents/geochemist.py` - Safety analysis agent with function calling
- `backend/agents/base.py` - ADK agent base class and helpers
- `frontend/src/App.tsx` - React app with three-mode UI system
- `frontend/src/ThreeLayer.ts` - Three.js Mapbox custom layer (isosurface bounding box, velocity arrows)
- `julia/plume_simulator.jl` - Oceananigans.jl LES simulation (requires Julia + CUDA)
- `data/mock/plume_simulation.json` - Pre-computed fallback plume data
- `data/mock/calcofi_stations.json` - CalCOFI oceanographic station data
- `data/mrv_log.jsonl` - MRV cryptographic hash log

### Safety Thresholds (from OAE research)
- Ω_aragonite > 30.0 → runaway carbonate precipitation (UNSAFE)
- Total alkalinity > 3500 µmol/kg → olivine toxicity (UNSAFE)

## UI Stack (phase:ui1)

Installed in `frontend/`:
- **Framer Motion** — all animations (`motion.*`, `AnimatePresence`, spring physics)
- **Radix UI Slider** (`@radix-ui/react-slider`) — custom styled range inputs
- **Tailwind CSS v4** + `@tailwindcss/postcss` — utility classes available but CSS variables are the primary styling approach
- **clsx + tailwind-merge** — `cn()` utility at `src/lib/utils.ts`
- **Radix UI** (tabs, select, tooltip, separator, progress) — installed, not yet wired

### Design Tokens (in `frontend/src/index.css` `:root`)
| Token | Value | Usage |
|---|---|---|
| `--bg` | `#0c0f14` | App background |
| `--panel-bg` | `rgba(12,15,20,0.96)` | Sidebar + overlay panels |
| `--accent` | `#ffffff` | Sliders, active states (white — minimal use) |
| `--deploy` | `#00c8f0` | Deploying ship status only |
| `--success` | `#4ade80` | Safe status, active ships |
| `--danger` | `#f87171` | Unsafe status, MPA zones |
| `--warning` | `#fbbf24` | Idle ships |
| `--text-1/2/3` | light→muted grey | Heading / body / label hierarchy |

### Animation Patterns
- Sidebars slide in from edges on mount (`x: ±280 → 0`, spring)
- Header staggers in element-by-element on load
- Result/analysis cards fade+slide up with `AnimatePresence`
- Ship cards stagger in with `0.07s` children delay
- Feedstock segmented control: indicator slides with `x` spring (`stiffness:500, damping:38`)
- Slider value number pops on change (`key={value}`, scale spring)
- Online dot breathes with CSS `@keyframes dot-breathe`
- Deploying ship markers pulse with CSS `@keyframes ring-out`

### Component Patterns
- **ParamSlider** — Radix Root/Track/Range/Thumb, animated value display
- **FeedstockPicker** — segmented control with sliding `motion.div` indicator
- **ShipMarker** — SVG top-down vessel with hull, superstructure, port/starboard lights
- **MPAOverlay** — 3 organic blob polygons (Channel Islands, Point Dume, Santa Monica Bay) with glow + dotted border layers
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
