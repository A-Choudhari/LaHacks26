"""
Agent 2: Geochemist / Dispatcher — safety analysis with function calling.

Function tools:
  check_aragonite_threshold(value)                  → safe: bool, margin: float
  check_alkalinity_threshold(value)                 → safe: bool, margin: float
  project_co2_removal(alkalinity, temperature, area_km2) → co2_tons: float

ADK path: Gemini 2.0 Flash calls all three tools then synthesises the report.
Fallback: tools are called directly; response is composed deterministically.
"""

import json
import logging
import re
from typing import Any

from .base import ADK_AVAILABLE, run_adk_agent

logger = logging.getLogger(__name__)

# Safety thresholds from OAE research (CLAUDE.md)
_ARAGONITE_LIMIT = 30.0
_ALKALINITY_LIMIT = 3500.0


# ── ADK function tools ────────────────────────────────────────────────────────

def check_aragonite_threshold(value: float) -> dict:
    """Check whether Ω_aragonite is within the safe operational limit (< 30.0)."""
    margin = _ARAGONITE_LIMIT - value
    return {
        "value": value,
        "limit": _ARAGONITE_LIMIT,
        "safe": value < _ARAGONITE_LIMIT,
        "margin": round(margin, 3),
        "message": (
            f"SAFE — {margin:.2f} units below limit"
            if value < _ARAGONITE_LIMIT
            else f"UNSAFE — exceeds limit by {-margin:.2f} units (runaway carbonate precipitation risk)"
        ),
    }


def check_alkalinity_threshold(value: float) -> dict:
    """Check whether total alkalinity is within the safe operational limit (< 3500 µmol/kg)."""
    margin = _ALKALINITY_LIMIT - value
    return {
        "value": value,
        "limit": _ALKALINITY_LIMIT,
        "safe": value < _ALKALINITY_LIMIT,
        "margin": round(margin, 3),
        "message": (
            f"SAFE — {margin:.0f} µmol/kg below limit"
            if value < _ALKALINITY_LIMIT
            else f"UNSAFE — exceeds limit by {-margin:.0f} µmol/kg (olivine toxicity risk)"
        ),
    }


def project_co2_removal(alkalinity: float, temperature: float, area_km2: float) -> dict:
    """
    Project CO₂ removal over 10 years using the standard OAE efficiency ratio.
    Olivine dissolution: ~0.8 mol CO₂ removed per mol TA added.
    Temperature adjustment: efficiency decreases ~1.2% per °C above 15°C.
    """
    delta_ta = max(0.0, alkalinity - 2300.0)
    base_eff = 0.8
    temp_adj = max(0.5, base_eff - 0.012 * max(0.0, temperature - 15.0))
    # mol TA × efficiency × CO2 molar mass (44 g/mol) × area in m² × depth proxy (10 m) / 1e12 → Mtons → tons
    area_m2 = area_km2 * 1e6
    co2_tons = delta_ta * temp_adj * 44 * area_m2 * 10 / 1e12
    return {
        "delta_alkalinity": round(delta_ta, 1),
        "efficiency": round(temp_adj, 3),
        "area_km2": area_km2,
        "co2_tons_10yr": round(co2_tons, 2),
        "message": f"{co2_tons:.2f} tons CO₂ removed over 10 years at {temperature}°C",
    }


# ── Rule-based synthesis (fallback) ──────────────────────────────────────────

def _build_response(arag_result: dict, alk_result: dict, co2_result: dict, feedstock: str) -> dict:
    is_safe = arag_result["safe"] and alk_result["safe"]
    status = "SAFE" if is_safe else "UNSAFE"

    safety_text = (
        f"Deployment is {status}. "
        f"Aragonite saturation: {arag_result['value']:.2f} — {arag_result['message']}. "
        f"Total alkalinity: {alk_result['value']:.0f} µmol/kg — {alk_result['message']}."
    )

    co2_text = (
        f"{co2_result['message']}. "
        f"Based on {feedstock} dissolution with {co2_result['efficiency']:.0%} OAE efficiency "
        f"over {co2_result['area_km2']} km²."
    )

    recs = []
    if arag_result["value"] > 25.0:
        recs.append("Consider reducing discharge rate to lower aragonite saturation.")
    if alk_result["value"] > 3200.0:
        recs.append("Monitor for olivine toxicity effects on marine life.")
    if not recs:
        recs.append("Deployment parameters are within optimal ranges.")

    return {
        "safety_assessment": safety_text,
        "co2_projection": co2_text,
        "recommendations": recs,
        "confidence": 0.85,
        "tool_results": {
            "aragonite": arag_result,
            "alkalinity": alk_result,
            "co2": co2_result,
        },
    }


# ── Public agent interface ────────────────────────────────────────────────────

class GeochemistAgent:
    """Geochemistry safety-analysis agent wrapping Google ADK with rule-based fallback."""

    def __init__(self) -> None:
        self._adk_agent: Any = None
        if ADK_AVAILABLE:
            try:
                from google.adk import Agent
                self._adk_agent = Agent(
                    name="geochemist",
                    model="gemini-2.0-flash",
                    description="OAE safety analysis and CO₂ projection agent",
                    instruction=(
                        "You are a marine geochemistry expert. When given OAE simulation results, "
                        "call check_aragonite_threshold, check_alkalinity_threshold, and project_co2_removal "
                        "with the provided values. Then synthesise the results into a JSON with fields: "
                        "safety_assessment (string), co2_projection (string), recommendations (list of strings)."
                    ),
                    tools=[
                        check_aragonite_threshold,
                        check_alkalinity_threshold,
                        project_co2_removal,
                    ],
                )
            except Exception as e:
                logger.warning("Failed to build ADK geochemist agent: %s", e)

    async def run(
        self,
        max_aragonite: float,
        max_alkalinity: float,
        temperature: float,
        feedstock: str,
        area_km2: float = 25.0,
    ) -> dict:
        """Analyse simulation results and return safety + CO₂ assessment."""

        if self._adk_agent is not None:
            try:
                prompt = (
                    f"Analyse this OAE deployment:\n"
                    f"  max_aragonite_saturation = {max_aragonite}\n"
                    f"  max_total_alkalinity = {max_alkalinity} µmol/kg\n"
                    f"  temperature = {temperature}°C\n"
                    f"  feedstock = {feedstock}\n"
                    f"  deployment_area = {area_km2} km²\n\n"
                    "Call all three tools then return JSON with safety_assessment, "
                    "co2_projection, and recommendations."
                )
                text = await run_adk_agent(self._adk_agent, prompt)
                m = re.search(r"\{.*\}", text, re.DOTALL)
                if m:
                    parsed = json.loads(m.group())
                    parsed["model_used"] = "gemini-2.0-flash (ADK)"
                    parsed.setdefault("confidence", 0.92)
                    return parsed
            except Exception as e:
                logger.warning("ADK geochemist agent failed, using fallback: %s", e)

        # Rule-based fallback — call tools directly
        arag_r = check_aragonite_threshold(max_aragonite)
        alk_r = check_alkalinity_threshold(max_alkalinity)
        co2_r = project_co2_removal(max_alkalinity, temperature, area_km2)
        result = _build_response(arag_r, alk_r, co2_r, feedstock)
        result["model_used"] = "rule-based-fallback"
        return result
