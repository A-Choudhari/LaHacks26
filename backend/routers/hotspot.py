"""
Hotspot impact analysis endpoint.
"""

import math

from fastapi import APIRouter
from pydantic import BaseModel, Field

from utils.ocean_physics import fetch_ocean_state, generate_plume_from_conditions

router = APIRouter()


class HotspotImpactRequest(BaseModel):
    lat: float
    lon: float
    discharge_rate: float = 0.5
    vessel_speed: float = 6.0
    feedstock_type: str = Field("olivine", pattern="^(olivine|sodium_hydroxide)$")
    duration_years: int = Field(10, ge=1, le=100)


@router.post("/hotspot-impact")
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
