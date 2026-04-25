"""
Base agent utilities — fully local via Ollama/Gemma4.

All agents run on Gemma4 through Ollama (no cloud dependency).
Fallback chain: Ollama/Gemma4 → rule-based deterministic computation.
"""

import os
import json
import logging
try:
    import httpx
    _HTTPX_AVAILABLE = True
except ImportError:
    _HTTPX_AVAILABLE = False

logger = logging.getLogger(__name__)

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
GEMMA_MODEL = os.getenv("GEMMA_MODEL", "gemma4:e4b")


async def is_ollama_available() -> bool:
    """Check if Ollama is running and the Gemma4 model is loaded."""
    if not _HTTPX_AVAILABLE:
        return False
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            resp = await client.get(f"{OLLAMA_URL}/api/tags")
            if resp.status_code != 200:
                return False
            tags = resp.json().get("models", [])
            return any(GEMMA_MODEL.split(":")[0] in m.get("name", "") for m in tags)
    except Exception:
        return False


async def query_gemma(prompt: str, system: str = "", timeout: float = 45.0) -> str:
    """
    Send a prompt to local Gemma4 via Ollama and return the response text.
    Raises on connection failure so callers can fall back to rule-based logic.
    """
    if not _HTTPX_AVAILABLE:
        raise RuntimeError("httpx not installed — Ollama unavailable")
    payload = {
        "model": GEMMA_MODEL,
        "prompt": prompt,
        "system": system,
        "stream": False,
        "options": {
            "temperature": 0.3,   # low temp for structured JSON output
            "num_predict": 512,
        },
    }
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(f"{OLLAMA_URL}/api/generate", json=payload)
        resp.raise_for_status()
        return resp.json().get("response", "")


def extract_json(text: str) -> dict | None:
    """Extract first JSON object from a string (LLM responses often wrap JSON in text)."""
    import re
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group())
        except json.JSONDecodeError:
            pass
    return None
