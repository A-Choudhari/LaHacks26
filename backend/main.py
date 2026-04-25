"""
FastAPI backend for The Tiered Edge Fleet
OAE Simulation Platform
"""

import json
import subprocess
import tempfile
import asyncio
from pathlib import Path
from typing import Optional
from datetime import datetime

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

app = FastAPI(
    title="The Tiered Edge Fleet",
    description="Ocean Alkalinity Enhancement Simulation Platform",
    version="0.1.0"
)

# CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Paths
PROJECT_ROOT = Path(__file__).parent.parent
JULIA_SCRIPT = PROJECT_ROOT / "julia" / "plume_simulator.jl"
MOCK_DATA_DIR = PROJECT_ROOT / "data" / "mock"

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
    source: str  # "live" or "mock"


class HealthResponse(BaseModel):
    status: str
    julia_available: bool
    mock_data_available: bool
    ollama_available: bool


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
        ollama_available=ollama_ok
    )


def load_mock_data() -> dict:
    """Load pre-computed mock simulation data"""
    mock_file = MOCK_DATA_DIR / "plume_simulation.json"
    if mock_file.exists():
        with open(mock_file) as f:
            return json.load(f)

    # Generate fallback mock data if file doesn't exist.
    # alkalinity and aragonite_saturation are 2D [ny][nx] surface slices
    # so the frontend heatmap can iterate them directly.
    import numpy as np

    nx, ny = 50, 50
    x = np.linspace(0, 500, nx)
    y = np.linspace(-250, 250, ny)
    z = np.linspace(-50, 0, 25)

    X, Y = np.meshgrid(x, y)  # Y is outer (row), X is inner (col) → [ny][nx]

    # Directional plume: ship moves east, plume elongates along x-axis
    sigma_x, sigma_y = 120, 60
    alkalinity_2d = 2300 + 900 * np.exp(
        -((X - 150)**2 / (2 * sigma_x**2) + Y**2 / (2 * sigma_y**2))
    )
    aragonite_2d = 3.0 + (alkalinity_2d - 2300) / 80

    return {
        "status": "safe",
        "safety_failures": [],
        "coordinates": {
            "x": x.tolist(),
            "y": y.tolist(),
            "z": z.tolist()
        },
        "fields": {
            "alkalinity": alkalinity_2d.tolist(),       # [ny][nx] — heatmap-ready
            "aragonite_saturation": aragonite_2d.tolist()
        },
        "summary": {
            "max_aragonite_saturation": float(aragonite_2d.max()),
            "max_total_alkalinity": float(alkalinity_2d.max()),
            "grid_size": [nx, ny, 25],
            "simulation_duration_s": 3600
        },
        "params": {
            "vessel_speed": 5.0,
            "discharge_rate": 0.1,
            "feedstock_type": "olivine",
            "temperature": 15.0,
            "salinity": 35.0
        }
    }


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
    Run OAE plume dispersion simulation

    Returns simulation results including:
    - 3D concentration fields (alkalinity, aragonite saturation)
    - Safety threshold checks
    - Summary statistics
    """

    timestamp = datetime.utcnow().isoformat() + "Z"

    if USE_MOCK:
        # Use mock/pre-computed data
        data = load_mock_data()
        return SimulationResult(
            status=data["status"],
            safety_failures=data["safety_failures"],
            coordinates=data["coordinates"],
            fields=data["fields"],
            summary=data["summary"],
            params=data["params"],
            timestamp=timestamp,
            source="mock"
        )

    # Run live Julia simulation
    data = await run_julia_simulation(request)

    return SimulationResult(
        status=data["status"],
        safety_failures=data["safety_failures"],
        coordinates=data["coordinates"],
        fields=data["fields"],
        summary=data["summary"],
        params=data["params"],
        timestamp=timestamp,
        source="live"
    )


# Fleet status endpoint for Arista "Connect the Dots" challenge
class ShipStatus(BaseModel):
    ship_id: str
    name: str
    position: dict  # lat, lon
    status: str  # "active", "idle", "deploying"
    last_simulation: Optional[str]
    co2_removed_tons: float
    alkalinity_deployed_kg: float


@app.get("/fleet", response_model=list[ShipStatus])
async def get_fleet_status():
    """
    Get status of all ships in the OAE fleet
    (Mock data for Arista challenge demonstration)
    """
    return [
        ShipStatus(
            ship_id="ship-001",
            name="Pacific Guardian",
            position={"lat": 34.0522, "lon": -118.2437},
            status="deploying",
            last_simulation=datetime.utcnow().isoformat() + "Z",
            co2_removed_tons=847.3,
            alkalinity_deployed_kg=12500.0
        ),
        ShipStatus(
            ship_id="ship-002",
            name="Ocean Sentinel",
            position={"lat": 33.7701, "lon": -118.1937},
            status="active",
            last_simulation=datetime.utcnow().isoformat() + "Z",
            co2_removed_tons=623.1,
            alkalinity_deployed_kg=9200.0
        ),
        ShipStatus(
            ship_id="ship-003",
            name="Reef Protector",
            position={"lat": 33.4484, "lon": -117.6557},
            status="idle",
            last_simulation=None,
            co2_removed_tons=0.0,
            alkalinity_deployed_kg=0.0
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
    AI-powered analysis of simulation results using Gemma 2

    Provides:
    - Safety assessment with threshold checking
    - CO2 removal projection
    - Deployment recommendations
    """
    sim = request.simulation_result
    summary = sim.get("summary", {})
    params = sim.get("params", {})

    # Extract values for prompts
    max_aragonite = summary.get("max_aragonite_saturation", 0)
    max_alkalinity = summary.get("max_total_alkalinity", 0)
    feedstock = params.get("feedstock_type", "olivine")
    temp = params.get("temperature", 15)
    discharge = params.get("discharge_rate", 0.1)

    # Check Ollama availability
    ollama_available = False
    try:
        import httpx
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get("http://localhost:11434/api/tags")
            ollama_available = resp.status_code == 200
    except:
        pass

    if ollama_available:
        # Generate AI analysis
        safety_prompt = SAFETY_PROMPT.format(
            max_aragonite=max_aragonite,
            max_alkalinity=max_alkalinity,
            feedstock_type=feedstock,
            temperature=temp,
            discharge_rate=discharge
        )

        co2_prompt = CO2_PROMPT.format(
            alkalinity_deployed=max_alkalinity,
            temperature=temp,
            area=25  # Estimated km²
        )

        # Run both queries in parallel
        safety_task = query_ollama(safety_prompt)
        co2_task = query_ollama(co2_prompt)

        safety_text, co2_text = await asyncio.gather(safety_task, co2_task)
        model_used = "gemma4:e4b"
    else:
        # Fallback to rule-based analysis
        is_safe = max_aragonite <= 30.0 and max_alkalinity <= 3500
        safety_text = (
            f"Deployment is {'SAFE' if is_safe else 'UNSAFE'}. "
            f"Aragonite saturation: {max_aragonite:.1f} (threshold: 30.0). "
            f"Total alkalinity: {max_alkalinity:.0f} µmol/kg (threshold: 3500)."
        )

        # Simple CO2 projection: ~0.8 mol CO2 per mol TA, 44g/mol CO2
        co2_tons = (max_alkalinity - 2300) * 0.8 * 44 * 25 * 1e6 / 1e12  # rough estimate
        co2_text = (
            f"Projected CO2 removal: {co2_tons:.1f} tons over 10 years. "
            f"Based on {feedstock} dissolution at {temp}°C with standard OAE efficiency."
        )
        model_used = "rule-based-fallback"

    # Generate recommendations
    recommendations = []
    if max_aragonite > 25:
        recommendations.append("Consider reducing discharge rate to lower aragonite saturation")
    if max_alkalinity > 3200:
        recommendations.append("Monitor for olivine toxicity effects on marine life")
    if temp > 25:
        recommendations.append("High temperature may accelerate dissolution but reduce CO2 solubility")
    if not recommendations:
        recommendations.append("Deployment parameters are within optimal ranges")

    return AnalysisResponse(
        safety_assessment=safety_text,
        co2_projection=co2_text,
        recommendations=recommendations,
        confidence=0.85 if ollama_available else 0.70,
        model_used=model_used
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
