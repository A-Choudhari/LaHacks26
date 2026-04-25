"""
Agent 2: Geochemist — safety analysis and CO₂ projection.

Function tools (always run deterministically):
  check_aragonite_threshold(value)                       → safe: bool, margin: float
  check_alkalinity_threshold(value)                      → safe: bool, margin: float
  project_co2_removal(alkalinity, temperature, area_km2) → co2_tons: float

Agent flow:
  1. Run all three tool functions to get hard numbers.
  2. Send tool results to local Gemma4 for natural-language synthesis.
  3. If Gemma4 unavailable, compose response deterministically from tool outputs.
"""

import json
import logging

from .base import query_gemma, extract_json

logger = logging.getLogger(__name__)

_ARAGONITE_LIMIT = 30.0
_ALKALINITY_LIMIT = 3500.0


# ── Tool functions (deterministic) ───────────────────────────────────────────

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
    area_m2 = area_km2 * 1e6
    co2_tons = delta_ta * temp_adj * 44 * area_m2 * 10 / 1e12
    return {
        "delta_alkalinity": round(delta_ta, 1),
        "efficiency": round(temp_adj, 3),
        "area_km2": area_km2,
        "co2_tons_10yr": round(co2_tons, 2),
        "message": f"{co2_tons:.2f} tons CO₂ removed over 10 years at {temperature}°C",
    }


# ── Rule-based synthesis (deterministic fallback) ─────────────────────────────

def _rule_based_synthesis(arag: dict, alk: dict, co2: dict, feedstock: str) -> dict:
    is_safe = arag["safe"] and alk["safe"]
    status = "SAFE" if is_safe else "UNSAFE"

    safety_text = (
        f"Deployment is {status}. "
        f"Aragonite saturation: {arag['value']:.2f} — {arag['message']}. "
        f"Total alkalinity: {alk['value']:.0f} µmol/kg — {alk['message']}."
    )
    co2_text = (
        f"{co2['message']}. "
        f"Based on {feedstock} dissolution with {co2['efficiency']:.0%} OAE efficiency "
        f"over {co2['area_km2']} km²."
    )

    recs = []
    if arag["value"] > 25.0:
        recs.append("Consider reducing discharge rate to lower aragonite saturation.")
    if alk["value"] > 3200.0:
        recs.append("Monitor for olivine toxicity effects on marine life.")
    if not recs:
        recs.append("Deployment parameters are within optimal ranges.")

    return {
        "safety_assessment": safety_text,
        "co2_projection": co2_text,
        "recommendations": recs,
        "confidence": 0.85,
        "tool_results": {"aragonite": arag, "alkalinity": alk, "co2": co2},
    }


# ── Public agent interface ────────────────────────────────────────────────────

class GeochemistAgent:
    """
    Geochemistry safety-analysis agent — runs locally via Gemma4/Ollama.
    Tool functions always execute deterministically; Gemma4 synthesises the narrative.
    """

    async def run(
        self,
        max_aragonite: float,
        max_alkalinity: float,
        temperature: float,
        feedstock: str,
        area_km2: float = 25.0,
    ) -> dict:
        # Always run tools deterministically
        arag_r = check_aragonite_threshold(max_aragonite)
        alk_r = check_alkalinity_threshold(max_alkalinity)
        co2_r = project_co2_removal(max_alkalinity, temperature, area_km2)

        # Try Gemma4 for richer natural-language synthesis
        try:
            system = (
                "You are a marine geochemistry expert analysing OAE (Ocean Alkalinity Enhancement) deployments. "
                "Given tool results, write a concise safety assessment and CO₂ projection. "
                "Respond ONLY with valid JSON containing: "
                "safety_assessment (string), co2_projection (string), recommendations (array of strings)."
            )
            prompt = (
                f"Tool results for an OAE deployment using {feedstock}:\n\n"
                f"Aragonite check: {json.dumps(arag_r)}\n"
                f"Alkalinity check: {json.dumps(alk_r)}\n"
                f"CO₂ projection: {json.dumps(co2_r)}\n\n"
                "Synthesise a JSON response with safety_assessment, co2_projection, and recommendations."
            )
            text = await query_gemma(prompt, system=system)
            parsed = extract_json(text)
            if parsed and "safety_assessment" in parsed:
                parsed["model_used"] = "gemma4:e4b (local)"
                parsed.setdefault("confidence", 0.92)
                parsed["tool_results"] = {"aragonite": arag_r, "alkalinity": alk_r, "co2": co2_r}
                return parsed
        except Exception as e:
            logger.info("Gemma4 synthesis unavailable, using rule-based: %s", e)

        result = _rule_based_synthesis(arag_r, alk_r, co2_r, feedstock)
        result["model_used"] = "rule-based-fallback"
        return result
