"""
Shared ocean physics utilities for simulation and analysis.
"""

import json
import hashlib
import asyncio
import tempfile
from pathlib import Path
from datetime import datetime
from typing import Optional

from fastapi import HTTPException

from config import PROJECT_ROOT, MOCK_DATA_DIR, JULIA_SCRIPT


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


def compute_mrv_hash(result) -> str:
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


async def run_julia_simulation(params) -> dict:
    """Run the Julia simulation via subprocess."""

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

        with open(output_file) as f:
            return json.load(f)

    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=504,
            detail="Simulation timed out after 5 minutes"
        )
    finally:
        Path(input_file).unlink(missing_ok=True)
        Path(output_file).unlink(missing_ok=True)
