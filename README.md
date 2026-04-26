# OceanOps

**Ocean Alkalinity Enhancement (OAE) Simulation Platform**

A local-first platform for simulating and visualizing OAE chemical plume dispersion, designed to run on edge devices like ships operating in the open ocean.

Built for LA Hacks 2026 | Targeting: Sustainability Track, ASUS Challenge, Arista Networks, Best Use of Google Gemma

## Architecture

```
┌──────────────┐      ┌─────────────────────────┐      ┌──────────────┐
│   React +    │ ←──→ │    FastAPI Backend      │ ←──→ │ Oceananigans │
│   Mapbox     │      │  (Modular Architecture) │      │    (Julia)   │
└──────────────┘      └─────────────────────────┘      └──────────────┘
       │                     │         │                       │
       │                     │         │                       │
       ▼                     ▼         ▼                       ▼
┌──────────────┐    ┌────────────┐ ┌──────────────┐    ┌──────────────┐
│  2D Heatmap  │    │ Multi-Agent│ │   Real-Time  │    │   GPU/CUDA   │
│  & AI Routes │    │  Ollama AI │ │  AIS Traffic │    │   Compute    │
└──────────────┘    └────────────┘ └──────────────┘    └──────────────┘
```

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 20+
- Julia 1.10+ (optional, for live high-fidelity simulation)
- Ollama (for offline AI analysis)

### 1. Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --port 8001 --reload
```

Backend runs at `http://localhost:8001`. On startup, the backend automatically pre-caches ocean data and connects to a real-time AIS vessel stream via WebSockets.

**Note:** The backend automatically falls back to pre-computed mock data if Julia isn't installed.

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at `http://localhost:3000` (or the Vite port printed in your console).

**Note:** You'll need a Mapbox token. Create a `.env` file in the `frontend/` directory:

```
VITE_MAPBOX_TOKEN=your_mapbox_token_here
```

### 3. Ollama Setup (for AI Analysis)

```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Start Ollama server
ollama serve

# Pull Gemma 2 models (in another terminal)
ollama pull gemma2
```

## Project Structure

The project has recently been refactored into a scalable, modular architecture:

```
├── backend/
│   ├── agents/          # Multi-agent system (Geochemist, Spatial Intelligence)
│   ├── routers/         # Modular FastAPI endpoints
│   │   ├── analysis.py
│   │   ├── discovery.py
│   │   ├── fleet.py
│   │   ├── oceanographic.py
│   │   ├── simulation.py
│   │   ├── traffic.py
│   │   └── ...
│   ├── utils/           # Physics calculations, haversine, etc.
│   ├── main.py          # App entrypoint and startup orchestration
│   └── data_fetcher.py  # Live CalCOFI/NOAA oceanographic data integration
├── frontend/
│   ├── src/
│   │   ├── components/  # React components (Mission Control, Map Overlays)
│   │   ├── pages/       # High-level views (Route Planning, Global Intelligence)
│   │   └── App.tsx      # Main routing and layout
├── julia/               # Oceananigans simulation scripts
└── data/                # Mock and pre-cached dataset storage
```

## API Modules

The FastAPI backend is separated into modular routers:

| Router      | Description                                     |
| ----------- | ----------------------------------------------- |
| `/health`   | System health and Julia engine status           |
| `/simulate` | Run OAE plume physics simulations               |
| `/fleet`    | Fleet ship status and hardware telemetry        |
| `/analyze`  | Multi-agent AI safety analysis & CO₂ projection |
| `/traffic`  | Real-time streaming AIS marine traffic          |
| `/discover` | Identifies ideal high-impact OAE zones          |
| `/ocean`    | Fetches real-world temperature & salinity data  |

## Key Features

- **Live Ocean Physics Visualization**: High-performance 2D heatmap overlay showing precise alkalinity dispersion.
- **AI Fleet Routing**: Analyzes oceanic conditions via CalCOFI & NOAA data to discover optimal deployment zones and routes ships dynamically.
- **Live Marine Traffic Engine**: GPU-accelerated GeoJSON rendering of thousands of active vessels using real-time WebSocket AIS streams to avoid deployment conflicts.
- **Multi-Agent Intelligence**: Specialized Gemma-powered agents (`GeochemistAgent` and `SpatialIntelligenceAgent`) evaluate safety thresholds (e.g., Ω_aragonite > 30.0) and optimize spatial operations.
- **Pre-Caching & Orchestration**: Fully offline-capable design with boot-time dataset warming to ensure immediate responsiveness in low-connectivity edge environments.

## Hardware Target

Designed for the **ASUS Ascent GX10** with the **NVIDIA GB10 Grace Blackwell Superchip**:

- 128GB unified memory
- 1 petaFLOP AI performance
- Built to run complex physics and LLMs completely offline at the edge.

## License

MIT
