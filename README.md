# The Tiered Edge Fleet

**Ocean Alkalinity Enhancement (OAE) Simulation Platform**

A local-first platform for simulating and visualizing OAE chemical plume dispersion, designed to run on edge devices like ships operating in the open ocean.

Built for LA Hacks 2026 | Targeting: Sustainability Track, ASUS Challenge, Arista Networks, Best Use of Google Gemma

## Architecture

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│   React +    │ ←──→ │   FastAPI    │ ←──→ │ Oceananigans │
│   Mapbox     │      │   Backend    │      │    (Julia)   │
└──────────────┘      └──────────────┘      └──────────────┘
       │                     │                     │
       │                     │                     │
       ▼                     ▼                     ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│   2D Heatmap │      │  Gemma 2     │      │   GPU/CUDA   │
│   Overlay    │      │  via Ollama  │      │   Compute    │
└──────────────┘      └──────────────┘      └──────────────┘
```

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 20+
- Julia 1.10+ (optional, for live simulation)
- Ollama (for AI analysis)

### 1. Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --port 8001 --reload
```

Backend runs at http://localhost:8001

**Note:** The backend automatically falls back to pre-computed mock data if Julia isn't installed.

### 2. Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at http://localhost:3000

**Note:** You'll need a Mapbox token. Create `.env` in `frontend/`:
```
VITE_MAPBOX_TOKEN=your_mapbox_token_here
```

### 3. Ollama Setup (for AI Analysis)

```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Start Ollama server
ollama serve

# Pull Gemma 2 model (in another terminal)
ollama pull gemma2
```

### 4. Run Smoke Test

```bash
./smoke_test.sh
```

## Project Structure

```
├── backend/
│   ├── main.py          # FastAPI server
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.tsx      # Main React app
│   │   └── index.css    # Styles
│   └── package.json
├── julia/
│   └── plume_simulator.jl  # Oceananigans simulation
├── data/
│   └── mock/            # Pre-computed simulation data
└── smoke_test.sh        # Pre-demo verification
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | System health check |
| `/simulate` | POST | Run OAE plume simulation |
| `/fleet` | GET | Get fleet ship status |
| `/analyze` | POST | AI-powered safety analysis and CO₂ projection |

## Features

- **Real-time Plume Visualization**: 2D heatmap overlay showing alkalinity dispersion
- **Safety Threshold Detection**: Flags deployments exceeding Ω_aragonite > 30.0 or TA > 3500 µmol/kg
- **AI-Powered Analysis**: Gemma 2 explains safety assessments and projects CO2 uptake
- **Fleet Dashboard**: Monitor multiple ships for the Arista "Connect the Dots" challenge

## Hardware Target

ASUS Ascent GX10 with NVIDIA GB10 Grace Blackwell Superchip
- 128GB unified memory
- 1 petaFLOP AI performance
- Runs completely offline

## License

MIT
