"""
Plume simulation endpoint.
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from config import DEMO_MODE, USE_MOCK
from agents.geochemist import _compute_viability
from utils.ocean_physics import (
    fetch_ocean_state,
    generate_plume_from_conditions,
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
    use_manual_ocean: bool = False


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
    viability: Optional[dict] = None           # AI agent combined viability assessment


@router.post("/simulate", response_model=SimulationResult)
async def run_simulation(request: SimulationRequest):
    """Run the Julia solver when available, otherwise use the simplified plume model."""
    timestamp = datetime.now(timezone.utc).isoformat()
    conditions = None
    if not DEMO_MODE and not request.use_manual_ocean:
        try:
            conditions = await fetch_ocean_state(33.80, -119.50)
        except (OSError, ValueError, KeyError):
            pass

    if conditions is None:
        source = "manual" if request.use_manual_ocean else "demo"
        conditions = {
            "temperature_c": request.ocean.temperature,
            "salinity_psu": request.ocean.salinity,
            "mixed_layer_depth_m": request.ocean.mixed_layer_depth,
            "baseline_alkalinity_umol_kg": 2280.0,
            "source": source,
            "fetched_at": timestamp,
        }

    data = None
    source = "live"
    if not USE_MOCK:
        request.ocean.temperature = conditions["temperature_c"]
        request.ocean.salinity = conditions["salinity_psu"]
        request.ocean.mixed_layer_depth = conditions["mixed_layer_depth_m"]
        try:
            data = await run_julia_simulation(request)
        except (HTTPException, OSError, ValueError):
            pass

    if data is None:
        data = generate_plume_from_conditions(
            temperature_c=conditions["temperature_c"],
            salinity_psu=conditions["salinity_psu"],
            mld_m=conditions["mixed_layer_depth_m"],
            baseline_alk=conditions["baseline_alkalinity_umol_kg"],
            vessel_speed=request.vessel.vessel_speed,
            discharge_rate=request.vessel.discharge_rate,
            feedstock_type=request.feedstock.feedstock_type,
        )
        source = "mock" if conditions["source"] in {"demo", "defaults", "manual"} else "live-conditions"

    result = SimulationResult(
        **data,
        timestamp=timestamp,
        source=source,
        ocean_state_source=conditions["source"],
        ocean_conditions=conditions,
    )
    if not DEMO_MODE:
        result.mrv_hash = compute_mrv_hash(result)

    # Deterministic viability scoring — zero latency, no LLM in the hot path.
    # Gemma4 enrichment happens in the separate /analyze call the user triggers.
    try:
        max_arag = result.summary.get("max_aragonite_saturation", 0)
        max_alk  = result.summary.get("max_total_alkalinity", 2300)
        temp     = result.params.get("temperature", 15.0)
        feedstock = result.params.get("feedstock_type", "olivine")
        discharge = result.params.get("discharge_rate", 0.5)

        det = _compute_viability(max_arag, max_alk, temp, feedstock, discharge)

        lv = det["level"]
        if lv == "safe":
            summary = f"Viable — Ω {max_arag:.1f} and TA {max_alk:.0f} µmol/kg within safe limits."
        elif lv == "caution":
            primary = next(iter(det["factors"]), "chemistry")
            summary = f"Viable with caution — {primary} approaching threshold; monitor closely."
        elif lv == "warning":
            primary = "aragonite" if det["arag_risk"] >= det["alk_risk"] else "alkalinity"
            summary = f"Marginal — {primary} near critical limit; consider reducing discharge."
        else:
            summary = (
                f"Not viable — Ω {max_arag:.1f} and/or TA {max_alk:.0f} µmol/kg "
                f"exceed safe limits."
            )

        result.viability = {
            "viability_score": det["viability_score"],
            "level": det["level"],
            "summary": summary,
            "factors": det["factors"],
            "model_used": "rule-based",
        }
    except Exception:
        pass

    return result
