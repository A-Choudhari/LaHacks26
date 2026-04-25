"""
FastAPI backend for The Tiered Edge Fleet
OAE Simulation Platform
"""

from dotenv import load_dotenv
load_dotenv()  # loads backend/.env into os.environ before anything else

import json
import hashlib
import subprocess
import tempfile
import asyncio
import time
import math
import logging
from pathlib import Path
from typing import Optional
from datetime import datetime

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Real ocean data fetcher
from data_fetcher import (
    fetch_calcofi, fetch_sst, fetch_chlorophyll,
    fetch_currents, compute_oae_scores, fetch_global_oae_hotspots,
    _load, refresh_all
)
# Real-time AIS vessel stream
import ais_stream

logger = logging.getLogger(__name__)

# ADK agents (imported lazily to avoid startup crash if deps are broken)
_spatial_agent = None
_geochemist_agent = None

def _get_spatial_agent():
    global _spatial_agent
    if _spatial_agent is None:
        from agents.spatial_intelligence import SpatialIntelligenceAgent
        _spatial_agent = SpatialIntelligenceAgent()
    return _spatial_agent

def _get_geochemist_agent():
    global _geochemist_agent
    if _geochemist_agent is None:
        from agents.geochemist import GeochemistAgent
        _geochemist_agent = GeochemistAgent()
    return _geochemist_agent

app = FastAPI(
    title="The Tiered Edge Fleet",
    description="Ocean Alkalinity Enhancement Simulation Platform",
    version="0.1.0"
)

@app.on_event("startup")
async def _startup():
    """Start real-time AIS stream in background on server boot."""
    asyncio.create_task(ais_stream.stream_forever())

# CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Paths
PROJECT_ROOT = Path(__file__).parent.parent
JULIA_SCRIPT = PROJECT_ROOT / "julia" / "plume_simulator.jl"
MOCK_DATA_DIR = PROJECT_ROOT / "data" / "mock"
REAL_DATA_DIR = PROJECT_ROOT / "data" / "real"

# Check if Julia is actually installed
def is_julia_available() -> bool:
    try:
        result = subprocess.run(["julia", "--version"], capture_output=True, timeout=5)
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False

JULIA_INSTALLED = is_julia_available()
USE_MOCK = not JULIA_SCRIPT.exists() or not JULIA_INSTALLED


class VesselParams(BaseModel):
    """Vessel and discharge parameters"""
    vessel_speed: float = Field(5.0, ge=0.1, le=30.0, description="Speed over ground (m/s)")
    waterline_length: float = Field(100.0, ge=10.0, le=500.0, description="Waterline length (m)")
    discharge_rate: float = Field(0.1, ge=0.01, le=10.0, description="Volume discharge rate (m³/s)")
    flow_velocity: float = Field(2.0, ge=0.1, le=20.0, description="Flow velocity at injection (m/s)")
    discharge_diameter: float = Field(0.5, ge=0.1, le=5.0, description="Discharge diameter (m)")


class FeedstockParams(BaseModel):
    """Feedstock chemistry parameters"""
    particle_radius: float = Field(1e-5, ge=1e-7, le=1e-2, description="Particle radius (m)")
    particle_density: float = Field(3300.0, ge=1000.0, le=5000.0, description="Particle density (kg/m³)")
    feedstock_type: str = Field("olivine", pattern="^(olivine|sodium_hydroxide)$")


class OceanParams(BaseModel):
    """Ocean state parameters"""
    temperature: float = Field(15.0, ge=-2.0, le=35.0, description="Temperature (°C)")
    salinity: float = Field(35.0, ge=30.0, le=40.0, description="Salinity (PSU)")
    mixed_layer_depth: float = Field(50.0, ge=10.0, le=200.0, description="Mixed layer depth (m)")
    aragonite_saturation: float = Field(3.0, ge=0.5, le=10.0, description="Baseline Ω_aragonite")


class SimulationRequest(BaseModel):
    """Full simulation request"""
    vessel: VesselParams = Field(default_factory=VesselParams)
    feedstock: FeedstockParams = Field(default_factory=FeedstockParams)
    ocean: OceanParams = Field(default_factory=OceanParams)


class SimulationResult(BaseModel):
    """Simulation result structure"""
    status: str
    safety_failures: list[str]
    coordinates: dict
    fields: dict
    summary: dict
    params: dict
    timestamp: str
    source: str                          # "live" | "live-conditions" | "mock"
    mrv_hash: Optional[str] = None       # SHA-256 tamper-evident MRV proof
    ocean_state_source: Optional[str] = None   # "noaa_erddap+calcofi" | "calcofi" | "mock"
    ocean_conditions: Optional[dict] = None    # real T/S/MLD values used in simulation


class HealthResponse(BaseModel):
    status: str
    julia_available: bool
    mock_data_available: bool
    ollama_available: bool
    ais_live: bool = False
    ais_vessels: int = 0


def compute_mrv_hash(result: "SimulationResult") -> str:
    """Compute SHA-256 hash of simulation result for tamper-evident MRV logging."""
    record = {
        "timestamp": result.timestamp,
        "status": result.status,
        "max_aragonite": result.summary.get("max_aragonite_saturation"),
        "max_alkalinity": result.summary.get("max_total_alkalinity"),
        "params": result.params,
        "source": result.source,
    }
    digest = hashlib.sha256(
        json.dumps(record, sort_keys=True).encode()
    ).hexdigest()

    log_entry = {
        "timestamp": result.timestamp,
        "hash": digest,
        "verdict": result.status,
        "params_summary": result.params,
    }
    log_file = PROJECT_ROOT / "data" / "mrv_log.jsonl"
    log_file.parent.mkdir(parents=True, exist_ok=True)
    with open(log_file, "a") as f:
        f.write(json.dumps(log_entry) + "\n")

    return digest


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Check system health and component availability"""
    julia_ok = JULIA_SCRIPT.exists() and JULIA_INSTALLED
    mock_ok = MOCK_DATA_DIR.exists() and any(MOCK_DATA_DIR.glob("*.json"))

    # Check Ollama
    ollama_ok = False
    try:
        result = subprocess.run(
            ["curl", "-s", "http://localhost:11434/api/tags"],
            capture_output=True, timeout=2
        )
        ollama_ok = result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass

    return HealthResponse(
        status="ok",
        julia_available=julia_ok,
        mock_data_available=mock_ok,
        ollama_available=ollama_ok,
        ais_live=ais_stream.is_connected(),
        ais_vessels=ais_stream.vessel_count(),
    )


# In-memory cache for NOAA ERDDAP ocean-state responses (10-minute TTL)
_ocean_state_cache: dict = {}
_OCEAN_CACHE_TTL = 600  # seconds


async def fetch_ocean_state(lat: float, lon: float) -> dict:
    """
    Fetch real ocean conditions for a deployment site.

    Data sources (priority order):
      1. NOAA ERDDAP MUR SST (jplMURSST41) — daily 1km global SST, no auth
      2. Nearest CalCOFI station — salinity, MLD, baseline alkalinity
      3. Hardcoded fallback defaults

    Returns dict with temperature_c, salinity_psu, mixed_layer_depth_m,
    baseline_alkalinity_umol_kg, source.
    """
    import httpx
    import math

    cache_key = (round(lat, 2), round(lon, 2))
    cached = _ocean_state_cache.get(cache_key)
    if cached and (datetime.utcnow().timestamp() - cached["_fetched_at"] < _OCEAN_CACHE_TTL):
        return {k: v for k, v in cached.items() if k != "_fetched_at"}

    temperature_c: Optional[float] = None
    sst_source = "missing"

    # ── 1. NOAA ERDDAP: MUR Sea Surface Temperature ──────────────────────────
    # jplMURSST41: GHRSST L4 MUR global SST, 0.01° grid, daily.
    # URL: griddap query for a 0.04° box around the deployment point.
    erddap_url = (
        "https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.json"
        f"?analysed_sst[(last)][({lat - 0.02:.4f}):({lat + 0.02:.4f})][({lon - 0.02:.4f}):({lon + 0.02:.4f})]"
    )
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(erddap_url)
        if resp.status_code == 200:
            rows = resp.json().get("table", {}).get("rows", [])
            if rows:
                sst_values = [r[3] for r in rows if r[3] is not None]
                if sst_values:
                    temperature_c = round(sum(sst_values) / len(sst_values), 2)
                    sst_source = "noaa_erddap"
    except Exception:
        pass  # network unavailable — fall through to CalCOFI

    # ── 2. CalCOFI nearest station: salinity, MLD, alkalinity ────────────────
    salinity_psu = 35.0
    mld_m = 60.0
    baseline_alk = 2280.0
    calcofi_source = "defaults"

    mock_file = MOCK_DATA_DIR / "calcofi_stations.json"
    if mock_file.exists():
        with open(mock_file) as f:
            stations = json.load(f)
        nearest = min(
            stations,
            key=lambda s: math.sqrt((s["lat"] - lat) ** 2 + (s["lon"] - lon) ** 2),
        )
        salinity_psu = nearest["salinity_psu"]
        mld_m = nearest["mixed_layer_depth_m"]
        baseline_alk = nearest["alkalinity_umol_kg"]
        calcofi_source = "calcofi"
        if temperature_c is None:
            temperature_c = nearest["temperature_c"]
            sst_source = "calcofi"

    if temperature_c is None:
        temperature_c = 15.0
        sst_source = "defaults"

    combined_source = (
        f"{sst_source}+{calcofi_source}" if sst_source != calcofi_source
        else sst_source
    )

    result = {
        "lat": lat,
        "lon": lon,
        "temperature_c": temperature_c,
        "salinity_psu": salinity_psu,
        "mixed_layer_depth_m": mld_m,
        "baseline_alkalinity_umol_kg": baseline_alk,
        "source": combined_source,
        "fetched_at": datetime.utcnow().isoformat() + "Z",
    }
    _ocean_state_cache[cache_key] = {**result, "_fetched_at": datetime.utcnow().timestamp()}
    return result


def generate_plume_from_conditions(
    temperature_c: float,
    salinity_psu: float,
    mld_m: float,
    baseline_alk: float,
    vessel_speed: float,
    discharge_rate: float,
    feedstock_type: str,
    nx: int = 50,
    ny: int = 50,
) -> dict:
    """
    Generate a physically-parameterized 2D plume field from real ocean conditions.

    Physics:
    - MLD controls cross-track spread (sigma_y ≈ mld/2)
    - Vessel speed controls along-track plume length
    - Temperature drives olivine dissolution rate (+2% per °C above 12°C)
    - NaOH dissolves ~60% faster than olivine at same discharge rate
    - Baseline alkalinity is derived from real salinity (linear T/A/S relationship)
    """
    import numpy as np

    # Grid extents driven by real conditions
    along_m = max(300.0, vessel_speed * 100.0)
    cross_m = max(100.0, mld_m * 3.0)

    x = np.linspace(0, along_m, nx)
    y = np.linspace(-cross_m, cross_m, ny)
    z = np.linspace(-mld_m, 0, 25)

    X, Y = np.meshgrid(x, y)

    # Spread: MLD drives lateral diffusion, vessel speed drives along-track extent
    sigma_x = max(50.0, along_m * 0.22)
    sigma_y = max(30.0, mld_m * 0.55)
    cx = along_m * 0.28  # injection point at ~28% along track

    # Dissolution rate factor
    temp_factor = 1.0 + max(0.0, temperature_c - 12.0) * 0.02
    if feedstock_type == "sodium_hydroxide":
        temp_factor *= 1.6

    peak_delta_alk = min(1400.0, discharge_rate * 1100.0 * temp_factor)

    alkalinity_2d = baseline_alk + peak_delta_alk * np.exp(
        -((X - cx) ** 2 / (2 * sigma_x ** 2) + Y ** 2 / (2 * sigma_y ** 2))
    )

    # Aragonite saturation: baseline rises with temperature, falls with excess salinity
    baseline_sat = 1.5 + (temperature_c - 5.0) * 0.12 + (35.0 - salinity_psu) * 0.04
    aragonite_2d = baseline_sat + (alkalinity_2d - baseline_alk) / 75.0

    max_alk = float(alkalinity_2d.max())
    max_arag = float(aragonite_2d.max())

    safety_failures = []
    if max_arag > 30.0:
        safety_failures.append(f"Ω_aragonite {max_arag:.1f} exceeds safe limit of 30.0")
    if max_alk > 3500.0:
        safety_failures.append(f"Total alkalinity {max_alk:.0f} µmol/kg exceeds 3500 µmol/kg")

    return {
        "status": "safe" if not safety_failures else "unsafe",
        "safety_failures": safety_failures,
        "coordinates": {"x": x.tolist(), "y": y.tolist(), "z": z.tolist()},
        "fields": {
            "alkalinity": alkalinity_2d.tolist(),
            "aragonite_saturation": aragonite_2d.tolist(),
        },
        "summary": {
            "max_aragonite_saturation": max_arag,
            "max_total_alkalinity": max_alk,
            "grid_size": [nx, ny, len(z)],
            "simulation_duration_s": 3600,
            "plume_sigma_x_m": sigma_x,
            "plume_sigma_y_m": sigma_y,
            "along_extent_m": along_m,
            "cross_extent_m": cross_m,
        },
        "params": {
            "vessel_speed": vessel_speed,
            "discharge_rate": discharge_rate,
            "feedstock_type": feedstock_type,
            "temperature": temperature_c,
            "salinity": salinity_psu,
            "mixed_layer_depth": mld_m,
        },
    }


def load_mock_data() -> dict:
    """Load pre-computed mock data as last-resort offline fallback only."""
    mock_file = MOCK_DATA_DIR / "plume_simulation.json"
    if mock_file.exists():
        with open(mock_file) as f:
            return json.load(f)
    # Hardcoded static fallback — only if no file and no network
    return generate_plume_from_conditions(
        temperature_c=15.0, salinity_psu=35.0, mld_m=60.0,
        baseline_alk=2280.0, vessel_speed=5.0, discharge_rate=0.1,
        feedstock_type="olivine",
    )


async def run_julia_simulation(params: SimulationRequest) -> dict:
    """Run the Julia simulation via subprocess"""

    # Create input JSON
    input_data = {
        "vessel_speed": params.vessel.vessel_speed,
        "waterline_length": params.vessel.waterline_length,
        "discharge_rate": params.vessel.discharge_rate,
        "flow_velocity": params.vessel.flow_velocity,
        "discharge_diameter": params.vessel.discharge_diameter,
        "particle_radius": params.feedstock.particle_radius,
        "particle_density": params.feedstock.particle_density,
        "feedstock_type": params.feedstock.feedstock_type,
        "temperature": params.ocean.temperature,
        "salinity": params.ocean.salinity,
        "mixed_layer_depth": params.ocean.mixed_layer_depth,
        "aragonite_saturation": params.ocean.aragonite_saturation,
    }

    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f_in:
        json.dump(input_data, f_in)
        input_file = f_in.name

    output_file = tempfile.mktemp(suffix='.json')

    try:
        # Run Julia simulation (timeout after 5 minutes)
        process = await asyncio.create_subprocess_exec(
            "julia", str(JULIA_SCRIPT), input_file, output_file,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        stdout, stderr = await asyncio.wait_for(
            process.communicate(),
            timeout=300  # 5 minute timeout
        )

        if process.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=f"Julia simulation failed: {stderr.decode()}"
            )

        # Read output
        with open(output_file) as f:
            return json.load(f)

    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=504,
            detail="Simulation timed out after 5 minutes"
        )
    finally:
        # Cleanup temp files
        Path(input_file).unlink(missing_ok=True)
        Path(output_file).unlink(missing_ok=True)


@app.post("/simulate", response_model=SimulationResult)
async def run_simulation(request: SimulationRequest):
    """
    Run OAE plume dispersion simulation.

    When Julia is unavailable (USE_MOCK=True), fetches real ocean conditions
    from NOAA ERDDAP and CalCOFI, then generates a physically-parameterized
    plume field driven by actual SST, salinity, and mixed-layer depth.

    source values:
      "live"             — Julia/Oceananigans ran on real GB10 hardware
      "live-conditions"  — physics-based plume seeded with NOAA/CalCOFI data
      "mock"             — static fallback (no network, no Julia)
    """
    timestamp = datetime.utcnow().isoformat() + "Z"

    # Pacific Guardian deployment position — actual OAE site off Channel Islands
    SHIP_LAT, SHIP_LON = 33.80, -119.50

    if USE_MOCK:
        # Try to fetch real ocean conditions, generate physics-based plume
        ocean_state = None
        try:
            ocean_state = await fetch_ocean_state(SHIP_LAT, SHIP_LON)
        except Exception:
            pass

        if ocean_state:
            data = generate_plume_from_conditions(
                temperature_c=ocean_state["temperature_c"],
                salinity_psu=ocean_state["salinity_psu"],
                mld_m=ocean_state["mixed_layer_depth_m"],
                baseline_alk=ocean_state["baseline_alkalinity_umol_kg"],
                vessel_speed=request.vessel.vessel_speed,
                discharge_rate=request.vessel.discharge_rate,
                feedstock_type=request.feedstock.feedstock_type,
            )
            result = SimulationResult(
                **data,
                timestamp=timestamp,
                source="live-conditions",
                ocean_state_source=ocean_state["source"],
                ocean_conditions={
                    "temperature_c": ocean_state["temperature_c"],
                    "salinity_psu": ocean_state["salinity_psu"],
                    "mixed_layer_depth_m": ocean_state["mixed_layer_depth_m"],
                    "baseline_alkalinity_umol_kg": ocean_state["baseline_alkalinity_umol_kg"],
                    "fetched_at": ocean_state["fetched_at"],
                },
            )
        else:
            # Full offline fallback
            data = load_mock_data()
            result = SimulationResult(
                status=data["status"],
                safety_failures=data["safety_failures"],
                coordinates=data["coordinates"],
                fields=data["fields"],
                summary=data["summary"],
                params=data["params"],
                timestamp=timestamp,
                source="mock",
                ocean_state_source="mock",
            )
    else:
        # Julia live simulation — pass real ocean conditions as inputs
        ocean_state = None
        try:
            ocean_state = await fetch_ocean_state(SHIP_LAT, SHIP_LON)
            request.ocean.temperature = ocean_state["temperature_c"]
            request.ocean.salinity = ocean_state["salinity_psu"]
            request.ocean.mixed_layer_depth = ocean_state["mixed_layer_depth_m"]
        except Exception:
            pass

        data = await run_julia_simulation(request)
        result = SimulationResult(
            status=data["status"],
            safety_failures=data["safety_failures"],
            coordinates=data["coordinates"],
            fields=data["fields"],
            summary=data["summary"],
            params=data["params"],
            timestamp=timestamp,
            source="live",
            ocean_state_source=ocean_state["source"] if ocean_state else "mock",
            ocean_conditions=ocean_state,
        )

    result.mrv_hash = compute_mrv_hash(result)
    return result


@app.get("/ocean-state")
async def get_ocean_state_endpoint(lat: float = 33.80, lon: float = -119.50):
    """
    Real-time ocean conditions for a deployment site.
    SST from NOAA ERDDAP MUR (jplMURSST41), salinity + MLD from nearest CalCOFI station.
    Cached for 10 minutes per location.
    """
    return await fetch_ocean_state(lat, lon)


# Fleet status endpoint for Arista "Connect the Dots" challenge
class ShipStatus(BaseModel):
    ship_id: str
    name: str
    position: dict           # lat, lon
    status: str              # "active", "idle", "deploying"
    last_simulation: Optional[str]
    co2_removed_tons: float
    alkalinity_deployed_kg: float
    heading: float = 0.0     # degrees true north
    speed_kn: float = 0.0    # knots


@app.get("/fleet", response_model=list[ShipStatus])
async def get_fleet_status():
    """
    Get status of all ships in the OAE fleet.
    Positions are in open Pacific water (Santa Barbara Channel / SoCal Bight).
    Includes heading + speed so the frontend can animate live movement.
    """
    return [
        ShipStatus(
            ship_id="ship-001",
            name="Pacific Guardian",
            # Santa Barbara Channel — open Pacific, deep water, OAE Zone Alpha
            position={"lat": 33.80, "lon": -119.50},
            status="deploying",
            last_simulation=datetime.utcnow().isoformat() + "Z",
            co2_removed_tons=847.3,
            alkalinity_deployed_kg=12500.0,
            heading=262.0,   # west-southwest along Channel
            speed_kn=6.2,
        ),
        ShipStatus(
            ship_id="ship-002",
            name="Ocean Sentinel",
            # Offshore San Diego — open ocean, OAE Zone Beta corridor
            position={"lat": 32.50, "lon": -119.20},
            status="active",
            last_simulation=datetime.utcnow().isoformat() + "Z",
            co2_removed_tons=623.1,
            alkalinity_deployed_kg=9200.0,
            heading=198.0,   # south-southwest transit
            speed_kn=9.4,
        ),
        ShipStatus(
            ship_id="ship-003",
            name="Reef Protector",
            # Offshore Pt. Conception — far offshore, standby
            position={"lat": 35.10, "lon": -121.90},
            status="idle",
            last_simulation=None,
            co2_removed_tons=189.6,
            alkalinity_deployed_kg=2800.0,
            heading=90.0,    # drifting east on current
            speed_kn=1.1,
        ),
    ]


# AI Analysis endpoint using Ollama/Gemma 2
class AnalysisRequest(BaseModel):
    """Request for AI analysis of simulation results"""
    simulation_result: dict
    analysis_type: str = Field("full", pattern="^(safety|co2_projection|full)$")


class AnalysisResponse(BaseModel):
    """AI-generated analysis of simulation results"""
    safety_assessment: str
    co2_projection: str
    recommendations: list[str]
    confidence: float
    model_used: str


SAFETY_PROMPT = """You are a marine geochemistry expert analyzing Ocean Alkalinity Enhancement (OAE) deployment results.

Given these simulation results:
- Maximum aragonite saturation: {max_aragonite}
- Maximum total alkalinity: {max_alkalinity} µmol/kg
- Feedstock type: {feedstock_type}
- Ocean temperature: {temperature}°C
- Discharge rate: {discharge_rate} m³/s

Safety thresholds:
- Ω_aragonite > 30.0 = runaway carbonate precipitation (UNSAFE)
- Total alkalinity > 3500 µmol/kg = olivine toxicity risk (UNSAFE)

Provide a brief (2-3 sentences) safety assessment. Be specific about which thresholds are met or exceeded."""

CO2_PROMPT = """You are a climate scientist projecting CO2 removal from Ocean Alkalinity Enhancement.

Given this deployment:
- Total alkalinity deployed: {alkalinity_deployed} µmol/kg
- Ocean temperature: {temperature}°C
- Deployment area (estimated): {area} km²

Using the standard OAE efficiency ratio (approximately 0.8 mol CO2 removed per mol alkalinity added for olivine dissolution):

Calculate and explain the projected CO2 removal over 10 years. Give a specific number in tons."""


async def query_ollama(prompt: str, model: str = "gemma4:e4b") -> str:
    """Query Ollama API with a prompt"""
    import httpx

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                "http://localhost:11434/api/generate",
                json={
                    "model": model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {
                        "temperature": 0.3,
                        "num_predict": 300
                    }
                }
            )
            if response.status_code == 200:
                return response.json().get("response", "")
            return f"Ollama error: {response.status_code}"
    except Exception as e:
        return f"Ollama unavailable: {str(e)}"


@app.post("/analyze", response_model=AnalysisResponse)
async def analyze_simulation(request: AnalysisRequest):
    """
    AI-powered analysis of simulation results.

    Routes through the Geochemist ADK agent (Gemini 2.0 Flash) when
    GOOGLE_API_KEY is set, then falls back to Ollama/Gemma4, then
    falls back to rule-based logic — all returning the same shape.
    """
    sim = request.simulation_result
    summary = sim.get("summary", {})
    params = sim.get("params", {})

    max_aragonite = summary.get("max_aragonite_saturation", 0)
    max_alkalinity = summary.get("max_total_alkalinity", 0)
    feedstock = params.get("feedstock_type", "olivine")
    temp = params.get("temperature", 15)

    # Try ADK Geochemist agent first
    try:
        agent = _get_geochemist_agent()
        result = await agent.run(
            max_aragonite=max_aragonite,
            max_alkalinity=max_alkalinity,
            temperature=temp,
            feedstock=feedstock,
            area_km2=25.0,
        )
        return AnalysisResponse(
            safety_assessment=result["safety_assessment"],
            co2_projection=result["co2_projection"],
            recommendations=result["recommendations"],
            confidence=result.get("confidence", 0.85),
            model_used=result.get("model_used", "geochemist-agent"),
        )
    except Exception as e:
        pass  # fall through to Ollama

    # Ollama / Gemma4 fallback
    ollama_available = False
    try:
        import httpx
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get("http://localhost:11434/api/tags")
            ollama_available = resp.status_code == 200
    except Exception:
        pass

    if ollama_available:
        safety_prompt = SAFETY_PROMPT.format(
            max_aragonite=max_aragonite,
            max_alkalinity=max_alkalinity,
            feedstock_type=feedstock,
            temperature=temp,
            discharge_rate=params.get("discharge_rate", 0.1),
        )
        co2_prompt = CO2_PROMPT.format(
            alkalinity_deployed=max_alkalinity,
            temperature=temp,
            area=25,
        )
        safety_text, co2_text = await asyncio.gather(
            query_ollama(safety_prompt),
            query_ollama(co2_prompt),
        )
        recommendations = []
        if max_aragonite > 25:
            recommendations.append("Consider reducing discharge rate to lower aragonite saturation")
        if max_alkalinity > 3200:
            recommendations.append("Monitor for olivine toxicity effects on marine life")
        if not recommendations:
            recommendations.append("Deployment parameters are within optimal ranges")
        return AnalysisResponse(
            safety_assessment=safety_text,
            co2_projection=co2_text,
            recommendations=recommendations,
            confidence=0.85,
            model_used="gemma4:e4b",
        )

    # Pure rule-based fallback
    from agents.geochemist import (
        check_aragonite_threshold,
        check_alkalinity_threshold,
        project_co2_removal,
        _build_response,
    )
    arag_r = check_aragonite_threshold(max_aragonite)
    alk_r = check_alkalinity_threshold(max_alkalinity)
    co2_r = project_co2_removal(max_alkalinity, temp, 25.0)
    result = _build_response(arag_r, alk_r, co2_r, feedstock)
    return AnalysisResponse(
        safety_assessment=result["safety_assessment"],
        co2_projection=result["co2_projection"],
        recommendations=result["recommendations"],
        confidence=result.get("confidence", 0.70),
        model_used="rule-based-fallback",
    )


# ── Generic agent dispatcher ──────────────────────────────────────────────────

class AgentRequest(BaseModel):
    agent_type: str = Field(..., pattern="^(spatial|geochemist)$")
    payload: dict


class AgentResponse(BaseModel):
    agent_type: str
    result: dict
    model_used: str


@app.post("/agent", response_model=AgentResponse)
async def run_agent(request: AgentRequest):
    """
    Route a request to the named ADK agent.
    agent_type = "spatial"    → SpatialIntelligenceAgent
    agent_type = "geochemist" → GeochemistAgent
    """
    if request.agent_type == "spatial":
        agent = _get_spatial_agent()
        lat = request.payload.get("lat", 34.05)
        lon = request.payload.get("lon", -118.24)
        radius = request.payload.get("radius_km", 25.0)
        result = await agent.run(lat=lat, lon=lon, radius_km=radius)
        return AgentResponse(
            agent_type="spatial",
            result=result,
            model_used=result.get("model_used", "unknown"),
        )

    if request.agent_type == "geochemist":
        agent = _get_geochemist_agent()
        p = request.payload
        result = await agent.run(
            max_aragonite=p.get("max_aragonite", 0),
            max_alkalinity=p.get("max_alkalinity", 2300),
            temperature=p.get("temperature", 15),
            feedstock=p.get("feedstock", "olivine"),
            area_km2=p.get("area_km2", 25.0),
        )
        return AgentResponse(
            agent_type="geochemist",
            result=result,
            model_used=result.get("model_used", "unknown"),
        )

    raise HTTPException(status_code=400, detail=f"Unknown agent_type: {request.agent_type}")


# ── Discovery Mode ────────────────────────────────────────────────────────────

class DiscoveryZone(BaseModel):
    lat: float
    lon: float
    score: float
    reason: str
    mpa_conflict: bool


@app.post("/discover", response_model=list[DiscoveryZone])
async def discover_zones():
    """
    AI-recommended OAE deployment zones.

    The Spatial Intelligence agent evaluates candidate sites from the
    CalCOFI grid and returns the top sites ranked by suitability.
    """
    # Candidate sites drawn from CalCOFI station positions
    candidates = [
        (36.47, -122.44), (35.21, -122.09), (34.02, -121.50),
        (34.97, -121.55), (33.78, -120.95), (32.82, -120.91),
        (31.62, -120.32), (30.42, -119.73),
    ]

    agent = _get_spatial_agent()
    tasks = [agent.run(lat=lat, lon=lon, radius_km=30.0) for lat, lon in candidates]
    results = await asyncio.gather(*tasks)

    zones: list[DiscoveryZone] = []
    for (lat, lon), r in zip(candidates, results):
        zones.append(DiscoveryZone(
            lat=lat,
            lon=lon,
            score=r.get("suitability_score", 0.5),
            reason=r.get("reason", ""),
            mpa_conflict=r.get("mpa_conflict", False),
        ))

    # Return top 5 by score, filter out MPA conflicts
    zones.sort(key=lambda z: z.score, reverse=True)
    return [z for z in zones if not z.mpa_conflict][:5]


@app.get("/oceanographic")
async def get_oceanographic_data(background_tasks: BackgroundTasks):
    """
    Real CalCOFI CTD hydrographic data from NOAA ERDDAP.
    Dataset: erdCalCOFINOAAhydros — temperature, salinity, dissolved oxygen.
    Falls back to mock data if ERDDAP is unavailable.
    """
    stations = fetch_calcofi()
    if stations:
        # Trigger background refresh if cache is getting stale
        background_tasks.add_task(fetch_calcofi)
        return stations
    # Fallback to mock
    mock_file = MOCK_DATA_DIR / "calcofi_stations.json"
    if mock_file.exists():
        with open(mock_file) as f:
            return json.load(f)
    return []


@app.get("/sst")
async def get_sea_surface_temperature():
    """
    Real NOAA OISST v2.1 sea surface temperature for CA coastal waters.
    Dataset: ncdcOisst21Agg_LonPM180 — 0.25° resolution, near-daily updates.
    """
    return fetch_sst()


@app.get("/currents")
async def get_ocean_currents():
    """
    Real OSCAR 1/3° surface current data (u/v vectors).
    Dataset: jplOscar — climatological reference for CA coastal current patterns.
    Returns vectors with speed and direction for route optimization.
    """
    return fetch_currents()


@app.get("/global-hotspots")
async def get_global_hotspots():
    """
    Real global OAE suitability hotspots computed from NOAA OISST (8° coarse grid).
    Score = 55% SST (cooler = better CO2 solubility) + 45% latitude band
    (mid-latitudes 30-60° optimal for wind mixing, away from biologically hot tropics).
    Returns 400+ points covering the global ocean.
    """
    return fetch_global_oae_hotspots()


@app.get("/zone-scores")
async def get_zone_scores():
    """
    Real OAE zone suitability scores computed from ERDDAP SST + chlorophyll.
    Score components: SST (60% — cooler = better CO2 solubility) +
                      Chlorophyll (40% — lower = less biotic interference).
    """
    cached = _load("zone_scores")
    if cached:
        return cached
    # Compute fresh
    sst = fetch_sst()
    chl = fetch_chlorophyll()
    if sst and chl:
        scores = compute_oae_scores(sst, chl)
        return scores
    return {}


class VesselTraffic(BaseModel):
    vessel_id: str
    name: str
    vessel_type: str
    lat: float
    lon: float
    heading: float
    speed_kn: float


# ── Live AIS Vessel Simulation ─────────────────────────────────────────────────

_vessel_state: dict = {"vessels": [], "last_update": 0.0}


def _load_base_vessels() -> list[dict]:
    """Load real AIS vessel data (curated from NOAA AIS 2024-01-01, CA coastal waters)."""
    # Prefer real data, fall back to mock
    for ais_file in [REAL_DATA_DIR / "ais_vessels.json", MOCK_DATA_DIR / "ais_vessels.json"]:
        if ais_file.exists():
            with open(ais_file) as f:
                return json.load(f)
    return []


def _simulate_vessel_movement(vessel: dict, elapsed_seconds: float) -> dict:
    """
    Move vessel along heading at speed.
    1 knot ≈ 1.852 km/h ≈ 0.0003 degrees/second at ~34°N latitude.
    """
    # Convert speed from knots to degrees/second (approximate)
    speed_deg_per_sec = vessel["speed_kn"] * 0.0003 / 3600
    distance = speed_deg_per_sec * elapsed_seconds

    heading_rad = math.radians(vessel["heading"])
    new_lat = vessel["lat"] + distance * math.cos(heading_rad)
    new_lon = vessel["lon"] + distance * math.sin(heading_rad)

    # Boundary check - reverse heading if out of Southern California area
    if new_lat < 33.0 or new_lat > 34.5 or new_lon < -119.5 or new_lon > -117.5:
        vessel["heading"] = (vessel["heading"] + 180) % 360

    vessel["lat"] = new_lat
    vessel["lon"] = new_lon
    return vessel


@app.get("/traffic", response_model=list[VesselTraffic])
async def get_vessel_traffic():
    """
    Real-time global AIS vessel traffic via aisstream.io WebSocket.
    Falls back to simulated movement of curated NOAA AIS vessels when
    AISSTREAM_API_KEY is not set or the stream is disconnected.

    Live mode: returns all vessels seen in the last 30 minutes globally.
    Fallback mode: returns 12 curated vessels from NOAA AIS 2024 CA data
                   with simulated position updates based on heading/speed.
    """
    # Prefer live AIS stream
    live = ais_stream.get_vessels()
    if live:
        return [VesselTraffic(**{k: v for k, v in vessel.items()
                                 if k in VesselTraffic.model_fields})
                for vessel in live]

    # Fallback: curated data with simulated movement
    global _vessel_state
    now = time.time()

    if not _vessel_state["vessels"] or now - _vessel_state["last_update"] > 300:
        _vessel_state["vessels"] = _load_base_vessels()
        _vessel_state["last_update"] = now
        return [VesselTraffic(**{k: v for k, v in vessel.items()
                                 if k in VesselTraffic.model_fields})
                for vessel in _vessel_state["vessels"]]

    elapsed = now - _vessel_state["last_update"]
    _vessel_state["last_update"] = now
    for vessel in _vessel_state["vessels"]:
        _simulate_vessel_movement(vessel, elapsed)

    return [VesselTraffic(**{k: v for k, v in vessel.items()
                             if k in VesselTraffic.model_fields})
            for vessel in _vessel_state["vessels"]]


# ── Hotspot Impact Analysis ───────────────────────────────────────────────────

class HotspotImpactRequest(BaseModel):
    lat: float
    lon: float
    discharge_rate: float = 0.5
    vessel_speed: float = 6.0
    feedstock_type: str = Field("olivine", pattern="^(olivine|sodium_hydroxide)$")
    duration_years: int = Field(10, ge=1, le=100)


@app.post("/hotspot-impact")
async def hotspot_impact(request: HotspotImpactRequest):
    """
    Deep-dive metric analysis for a candidate OAE deployment hot spot.

    Fetches real ocean conditions at the site, runs the physics-based plume
    model, then calculates the full impact suite:
      - CO₂ removal projections (1 / 5 / 10 / 50 yr)
      - Ocean chemistry changes (pH, aragonite saturation)
      - Plume geometry (area, depth)
      - Economic metrics (carbon credits @ $65/t CO₂)
      - Safety assessment against OAE thresholds
    """
    import math

    ocean_state = await fetch_ocean_state(request.lat, request.lon)
    plume = generate_plume_from_conditions(
        temperature_c=ocean_state["temperature_c"],
        salinity_psu=ocean_state["salinity_psu"],
        mld_m=ocean_state["mixed_layer_depth_m"],
        baseline_alk=ocean_state["baseline_alkalinity_umol_kg"],
        vessel_speed=request.vessel_speed,
        discharge_rate=request.discharge_rate,
        feedstock_type=request.feedstock_type,
    )

    summary = plume["summary"]
    temp = ocean_state["temperature_c"]
    baseline_alk = ocean_state["baseline_alkalinity_umol_kg"]
    max_alk = summary["max_total_alkalinity"]
    max_arag = summary["max_aragonite_saturation"]
    sigma_x = summary["plume_sigma_x_m"]
    sigma_y = summary["plume_sigma_y_m"]

    # Plume geometry
    plume_area_m2 = math.pi * sigma_x * sigma_y      # 1-σ ellipse
    plume_area_km2 = plume_area_m2 / 1e6

    # TA increase above background
    delta_ta = max(0.0, max_alk - baseline_alk)

    # CO₂ removal (moles TA → moles CO₂ → kg CO₂)
    # OAE efficiency: 0.8 mol CO₂ per mol TA, T-adjusted
    temp_eff = max(0.4, 0.8 - 0.012 * max(0.0, temp - 15.0))
    # Moles TA in plume volume = delta_ta [µmol/kg] × vol [kg]
    # vol = area_m2 × MLD [m] × density [kg/m³ ≈ 1025]
    mld = ocean_state["mixed_layer_depth_m"]
    vol_kg = plume_area_m2 * mld * 1025.0
    moles_ta = delta_ta * 1e-6 * vol_kg              # µmol/kg → mol
    moles_co2_per_yr = moles_ta * temp_eff / 10.0    # assume 10yr equilibration
    kg_co2_per_yr = moles_co2_per_yr * 44.01e-3
    tons_co2_per_yr = kg_co2_per_yr / 1000.0

    # pH change: ΔpH ≈ 0.0013 per µmol/kg TA increase (Revelle approximation)
    ph_increase = delta_ta * 0.0013

    # CO₂ solubility improvement: each 0.1 pH unit → ~10% more CO₂ absorbed
    co2_solubility_pct = ph_increase * 100.0

    # Aragonite baseline (site)
    baseline_arag = 1.5 + (temp - 5.0) * 0.12 + (35.0 - ocean_state["salinity_psu"]) * 0.04
    arag_increase = max_arag - baseline_arag

    # Carbon credits @ $65/ton CO₂ (mid-range voluntary market)
    CREDIT_PRICE = 65.0
    def _credits(yrs: int) -> dict:
        tons = tons_co2_per_yr * yrs
        return {"tons_co2": round(tons, 2), "usd": round(tons * CREDIT_PRICE, 0)}

    # Olivine feedstock cost: ~$180/ton rock, ~0.8t CO₂/t olivine → $225/ton CO₂
    feedstock_cost_per_ton = 225.0 if request.feedstock_type == "olivine" else 380.0
    net_value_per_ton = CREDIT_PRICE - feedstock_cost_per_ton

    # Safety
    risk_level = "low"
    if max_arag > 20.0 or max_alk > 3200:
        risk_level = "medium"
    if max_arag > 27.0 or max_alk > 3400:
        risk_level = "high"

    # Suitability score (mirrors spatial agent logic)
    suitability = ocean_state.get("suitability_score_approx",
        min(1.0, 0.5 + mld / 140.0 + (35.0 - ocean_state["salinity_psu"]) * 0.01))

    return {
        "lat": request.lat,
        "lon": request.lon,
        "ocean_state": {
            "temperature_c": ocean_state["temperature_c"],
            "salinity_psu": ocean_state["salinity_psu"],
            "mixed_layer_depth_m": mld,
            "baseline_alkalinity_umol_kg": baseline_alk,
            "source": ocean_state["source"],
        },
        "plume": {
            "peak_ta_increase_umol_kg": round(delta_ta, 1),
            "plume_area_km2": round(plume_area_km2, 2),
            "plume_depth_m": round(mld, 0),
            "sigma_x_m": round(sigma_x, 0),
            "sigma_y_m": round(sigma_y, 0),
            "max_aragonite_saturation": round(max_arag, 3),
            "aragonite_increase": round(arag_increase, 3),
        },
        "co2_removal": {
            "year_1": _credits(1),
            "year_5": _credits(5),
            "year_10": _credits(10),
            "year_50": _credits(50),
            "annual_tons": round(tons_co2_per_yr, 3),
            "oae_efficiency": round(temp_eff, 3),
        },
        "chemistry": {
            "ph_increase": round(ph_increase, 4),
            "ph_baseline_approx": 8.1,
            "ph_after_approx": round(8.1 + ph_increase, 4),
            "co2_solubility_improvement_pct": round(co2_solubility_pct, 2),
            "aragonite_saturation_before": round(baseline_arag, 2),
            "aragonite_saturation_after": round(max_arag, 2),
        },
        "economics": {
            "carbon_credit_price_usd_per_ton": CREDIT_PRICE,
            "feedstock_cost_usd_per_ton_co2": feedstock_cost_per_ton,
            "net_value_usd_per_ton_co2": round(net_value_per_ton, 0),
            "revenue_10yr_usd": round(tons_co2_per_yr * 10 * CREDIT_PRICE, 0),
            "revenue_50yr_usd": round(tons_co2_per_yr * 50 * CREDIT_PRICE, 0),
        },
        "safety": {
            "risk_level": risk_level,
            "max_aragonite": round(max_arag, 2),
            "max_alkalinity_umol_kg": round(max_alk, 0),
            "aragonite_threshold": 30.0,
            "alkalinity_threshold": 3500.0,
            "within_safe_thresholds": plume["status"] == "safe",
            "safety_failures": plume["safety_failures"],
        },
        "suitability_score": round(min(1.0, suitability), 3),
        "feedstock_type": request.feedstock_type,
        "data_source": ocean_state["source"],
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
