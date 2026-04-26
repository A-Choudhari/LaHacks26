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
