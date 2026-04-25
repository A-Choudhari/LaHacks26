"""
Plume simulation endpoint.
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from config import USE_MOCK
from utils.ocean_physics import (
    fetch_ocean_state,
    generate_plume_from_conditions,
    load_mock_data,
    run_julia_simulation,
    compute_mrv_hash,
)

router = APIRouter()


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


@router.post("/simulate", response_model=SimulationResult)
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
