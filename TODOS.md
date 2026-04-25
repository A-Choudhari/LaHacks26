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

## Critical Path (Do First)

### Validate GB10 Julia/CUDA
**Priority:** CRITICAL
**Effort:** 5 minutes
**What:** Run `julia -e 'using CUDA; CUDA.versioninfo()'` on the GB10 to verify Julia/CUDA works on ARM64 + Blackwell.
**Why:** The outside voice flagged this as a hackathon-ending risk. 5 minutes of validation saves potentially 8+ hours of debugging.
**Context:** If CUDA.jl fails on GB10, pivot immediately to pre-computed data and skip live simulation entirely.
**Depends on:** Access to the GB10 hardware
**Status:** TODO

### Get Mapbox token
**Priority:** HIGH
**Effort:** 5 minutes
**What:** Sign up at mapbox.com, get a token, add to `frontend/.env`
**Why:** Map won't render without it
**Status:** TODO

### Pre-compute simulation data as fallback
**Priority:** HIGH
**Effort:** 1-2 hours
**What:** Run Oceananigans.jl on a known-working machine (cloud VM with NVIDIA GPU, or laptop with CUDA) and save the JSON output.
**Why:** Insurance policy. Demo always works regardless of GB10 GPU status.
**Context:** Do this early so you have the fallback ready before demo day.
**Depends on:** Access to any CUDA-capable machine
**Status:** TODO (using minimal mock data currently)

## Should Do (Before Demo)

### ~~Add MPA overlay to map~~ DONE
**Priority:** MEDIUM
**What:** Add Marine Protected Area polygons to the map so judges can see deployment avoids sensitive zones.
**Status:** COMPLETED

### Set up Ollama with Gemma 2
**Priority:** MEDIUM
**Effort:** 15 minutes
**What:** Install Ollama, run `ollama pull gemma2`
**Why:** Enables AI-powered analysis instead of rule-based fallback
**Status:** TODO (rule-based fallback works for demo)

### Demo script preparation
**Priority:** MEDIUM
**Effort:** 30 minutes
**What:** Write a 3-minute demo script hitting all 4 judging tracks (Sustainability, ASUS, Arista, Gemma)
**Why:** Design doc Hour 26-30: "Demo script rehearsal, fallback paths if anything breaks"
**Status:** TODO

## Stretch Goals (If Time Permits)

### Three-mode UI
**Priority:** LOW
**What:** Add Global Intelligence and Route Planning modes beyond Mission Control.
**Status:** DEFERRED

### Three separate AI agents
**Priority:** LOW
**What:** Split combined agent into Spatial Intelligence, Geochemist, and Verdict Logger.
**Status:** DEFERRED

### 3D volumetric visualization
**Priority:** LOW
**What:** Three.js custom shaders for true 3D plume rendering.
**Status:** DEFERRED (using 2D Mapbox heatmap instead)

### Marine health score
**Priority:** LOW
**What:** Add marine ecosystem health metric to impact display
**Status:** DEFERRED
