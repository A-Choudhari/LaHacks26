"""
AI analysis and agent dispatch endpoints.
"""

import asyncio

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from config import SAFETY_PROMPT, CO2_PROMPT
from agents import get_spatial_agent, get_geochemist_agent

router = APIRouter()


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


async def query_ollama(prompt: str, model: str = "gemma4:31b") -> str:
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


@router.post("/analyze", response_model=AnalysisResponse)
async def analyze_simulation(request: AnalysisRequest):
    """
    AI-powered analysis of simulation results.

    Routes through the Geochemist agent (local Gemma4/Ollama) then falls
    back to rule-based logic — all returning the same response shape.
    """
    sim = request.simulation_result
    summary = sim.get("summary", {})
    params = sim.get("params", {})

    max_aragonite = summary.get("max_aragonite_saturation", 0)
    max_alkalinity = summary.get("max_total_alkalinity", 0)
    feedstock = params.get("feedstock_type", "olivine")
    temp = params.get("temperature", 15)

    # Try Geochemist agent first (local Gemma4)
    try:
        agent = get_geochemist_agent()
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
    except Exception:
        pass  # fall through to direct Ollama

    # Direct Ollama / Gemma4 fallback
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
            model_used="gemma4:31b",
        )

    # Pure rule-based fallback
    from agents.geochemist import (
        check_aragonite_threshold,
        check_alkalinity_threshold,
        project_co2_removal,
        _rule_based_synthesis,
    )
    arag_r = check_aragonite_threshold(max_aragonite)
    alk_r = check_alkalinity_threshold(max_alkalinity)
    co2_r = project_co2_removal(max_alkalinity, temp, 25.0)
    result = _rule_based_synthesis(arag_r, alk_r, co2_r, feedstock)
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


@router.post("/agent", response_model=AgentResponse)
async def run_agent(request: AgentRequest):
    """
    Route a request to the named agent.
    agent_type = "spatial"    → SpatialIntelligenceAgent
    agent_type = "geochemist" → GeochemistAgent
    """
    if request.agent_type == "spatial":
        agent = get_spatial_agent()
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
        agent = get_geochemist_agent()
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


# ── Parameter Optimization ────────────────────────────────────────────────────

class OptimizeRequest(BaseModel):
    simulation_result: dict
    current_params: dict
    objective: str = Field("maximize_co2", pattern="^(maximize_co2|minimize_risk|balance)$")


class OptimizeResponse(BaseModel):
    suggested_vessel_speed: float
    suggested_discharge_rate: float
    suggested_feedstock: str
    reasoning: str
    projected_improvement_pct: float
    model_used: str


def _deterministic_optimize(summary: dict, params: dict, objective: str) -> dict:
    """Rule-based parameter optimizer — always runs before LLM synthesis."""
    max_arag = summary.get("max_aragonite_saturation", 0.0)
    max_alk = summary.get("max_total_alkalinity", 2300.0)

    arag_headroom = 30.0 - max_arag       # positive = safe margin
    alk_headroom = 3500.0 - max_alk
    # Safety factor: 0 = at limit, 1 = very safe
    safety_factor = min(max(arag_headroom / 30.0, 0), max(alk_headroom / 3500.0, 0))

    current_speed = params.get("vessel_speed", 5.0)
    current_discharge = params.get("discharge_rate", 0.5)
    current_feedstock = params.get("feedstock_type", "olivine")
    temp = params.get("temperature", 15.0)

    suggested_speed = current_speed
    suggested_discharge = current_discharge
    suggested_feedstock = current_feedstock
    improvement_pct = 0.0

    if objective == "maximize_co2":
        if safety_factor > 0.30:
            # Safe headroom — increase discharge to push more TA into ocean
            scale = min(1.5, 1.0 + safety_factor * 0.9)
            suggested_discharge = round(min(1.0, current_discharge * scale), 2)
            # Slow the vessel slightly to allow more mixing time
            suggested_speed = round(max(2.0, current_speed * 0.88), 1)
            improvement_pct = round((suggested_discharge / current_discharge - 1.0) * 85, 1)
        elif safety_factor < 0.05:
            # Very close to threshold — back off
            suggested_discharge = round(current_discharge * 0.65, 2)
            improvement_pct = -25.0
        # High-temperature preference: olivine dissolves better above 18°C
        if temp > 18.0:
            suggested_feedstock = "olivine"

    elif objective == "minimize_risk":
        if max_arag > 22.0:
            suggested_discharge = round(current_discharge * (22.0 / max_arag) * 0.85, 2)
        if max_arag > 26.0:
            # Speed up to dilute the plume
            suggested_speed = round(min(15.0, current_speed * 1.25), 1)
        improvement_pct = round(min(40.0, (1.0 - safety_factor) * 50.0), 1)

    elif objective == "balance":
        # Target ~60% safety headroom
        target_arag = 30.0 * 0.40  # 40% of limit = comfortable
        if max_arag > 0:
            scale = target_arag / max_arag
            suggested_discharge = round(min(1.0, max(0.01, current_discharge * scale)), 2)
        improvement_pct = round(abs(suggested_discharge - current_discharge) / current_discharge * 55, 1)

    reasoning = (
        f"Current conditions: Ω_aragonite={max_arag:.2f} (headroom {arag_headroom:.1f}), "
        f"TA={max_alk:.0f} µmol/kg (headroom {alk_headroom:.0f}). "
    )
    if objective == "maximize_co2":
        reasoning += f"Safety factor {safety_factor:.0%} — {'increasing discharge for higher CO₂ uptake' if improvement_pct > 0 else 'reducing discharge to restore safe margin'}."
    elif objective == "minimize_risk":
        reasoning += "Reducing discharge and increasing speed to dilute plume concentration below critical thresholds."
    else:
        reasoning += "Balancing deployment for ~60% headroom below aragonite saturation limit."

    return {
        "suggested_vessel_speed": suggested_speed,
        "suggested_discharge_rate": suggested_discharge,
        "suggested_feedstock": suggested_feedstock,
        "reasoning": reasoning,
        "projected_improvement_pct": improvement_pct,
    }


@router.post("/optimize", response_model=OptimizeResponse)
async def optimize_params(request: OptimizeRequest):
    """
    Suggest optimal deployment parameters given current simulation results.

    Deterministic optimizer always runs first (safety + efficiency rules),
    then Gemma4 can refine the reasoning with marine chemistry context.
    """
    summary = request.simulation_result.get("summary", {})
    params = request.current_params
    objective = request.objective

    core = _deterministic_optimize(summary, params, objective)

    # Try Gemma4 for enriched reasoning
    try:
        from agents.base import query_gemma, extract_json, is_ollama_available
        if is_ollama_available():
            system = (
                "You are a marine chemistry expert advising on Ocean Alkalinity Enhancement deployments. "
                "Given deterministic optimization results and simulation data, refine the reasoning. "
                "Respond ONLY with valid JSON: reasoning (string, 1-2 sentences), projected_improvement_pct (number)."
            )
            prompt = (
                f"OAE optimization for objective '{objective}':\n"
                f"Simulation: {summary}\n"
                f"Current params: {params}\n"
                f"Deterministic suggestion: speed={core['suggested_vessel_speed']} m/s, "
                f"discharge={core['suggested_discharge_rate']} m³/s, feedstock={core['suggested_feedstock']}\n"
                f"Initial reasoning: {core['reasoning']}\n"
                "Provide refined reasoning and projected improvement percentage."
            )
            text = await query_gemma(prompt, system=system)
            parsed = extract_json(text)
            if parsed and "reasoning" in parsed:
                core["reasoning"] = parsed["reasoning"]
                if "projected_improvement_pct" in parsed:
                    core["projected_improvement_pct"] = float(parsed["projected_improvement_pct"])
                return OptimizeResponse(**core, model_used="gemma4:e4b (local)")
    except Exception:
        pass

    return OptimizeResponse(**core, model_used="rule-based")
