"""
AI-recommended deployment zone discovery endpoint.
"""

import json
import time
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agents.spatial_intelligence import (
    score_sites_batch,
    get_ocean_state,
    get_mpa_overlap,
    _compute_score,
)

router = APIRouter()

_CANDIDATES = [
    (36.47, -122.44), (35.21, -122.09), (34.02, -121.50),
    (34.97, -121.55), (33.78, -120.95), (32.82, -120.91),
    (31.62, -120.32), (30.42, -119.73),
]

# Cache for the non-streaming fallback endpoint
_discover_cache: dict = {}
_DISCOVER_CACHE_TTL = 300


class DiscoveryZone(BaseModel):
    lat: float
    lon: float
    score: float
    reason: str
    mpa_conflict: bool
    name: Optional[str] = None


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


@router.get("/discover/stream")
async def discover_stream():
    """
    SSE endpoint — streams zones as they are scored so the frontend can draw
    routes progressively before the full AI analysis completes.

    Phase 1 (fast, ~50 ms): deterministic rule-based scores, one event per
    non-MPA candidate.  Client can render provisional routes immediately.

    Phase 2 (AI, ~5-15 s): single Gemma4 batch call; enriched scores/reasons
    stream in as update events.

    Each SSE event is JSON with shape:
      { phase: "fast"|"ai", lat, lon, score, reason, mpa_conflict }
    Control events:
      { event: "fast_done" }  — all provisional sites sent; safe to draw routes
      { event: "done" }       — AI enrichment complete
    """
    async def generate():
        # ── Phase 1: deterministic scoring ──────────────────────────────────
        viable: list[tuple[float, float]] = []
        for lat, lon in _CANDIDATES:
            ocean = get_ocean_state(lat, lon)
            mpa   = get_mpa_overlap(lat, lon, radius_km=30.0)
            score, reason = _compute_score(ocean, mpa)
            if not mpa["overlaps"]:
                viable.append((lat, lon))
                yield _sse({
                    "phase": "fast",
                    "lat": lat, "lon": lon,
                    "score": score,
                    "reason": reason,
                    "mpa_conflict": False,
                })

        yield _sse({"event": "fast_done"})

        # ── Phase 2: Gemma4 batch enrichment ─────────────────────────────────
        try:
            ai_results = await score_sites_batch(viable, radius_km=30.0)
            for r in ai_results:
                yield _sse({
                    "phase": "ai",
                    "lat": r["lat"], "lon": r["lon"],
                    "score": r["suitability_score"],
                    "reason": r["reason"],
                    "mpa_conflict": r["mpa_conflict"],
                    "model_used": r.get("model_used", ""),
                })
        except Exception:
            pass  # keep provisional fast scores if Gemma4 fails

        yield _sse({"event": "done"})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/discover", response_model=list[DiscoveryZone])
async def discover_zones():
    """Non-streaming fallback (used by GlobalIntelligence page)."""
    now = time.monotonic()
    if _discover_cache.get("ts") and now - _discover_cache["ts"] < _DISCOVER_CACHE_TTL:
        return _discover_cache["zones"]

    results = await score_sites_batch(_CANDIDATES, radius_km=30.0)
    zones = [
        DiscoveryZone(
            lat=r["lat"], lon=r["lon"],
            score=r["suitability_score"],
            reason=r["reason"],
            mpa_conflict=r["mpa_conflict"],
        )
        for r in results
    ]
    zones.sort(key=lambda z: z.score, reverse=True)
    filtered = [z for z in zones if not z.mpa_conflict][:5]
    for i, z in enumerate(filtered):
        z.name = f"Site {chr(65 + i)}"

    _discover_cache["zones"] = filtered
    _discover_cache["ts"] = now
    return filtered
