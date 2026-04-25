"""
Base ADK agent scaffold.

When GOOGLE_API_KEY is set, agents run via Google ADK → Gemini 2.0 Flash.
Otherwise they execute their function tools directly and return the same
structured output (rule-based fallback — no external dependencies).
"""

import os
import logging
import uuid
from typing import Any

logger = logging.getLogger(__name__)

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY", "")

# Try to import ADK; degrade gracefully if key is missing or package absent
try:
    from google.adk import Agent
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai import types as genai_types
    ADK_AVAILABLE = bool(GOOGLE_API_KEY)
    if not ADK_AVAILABLE:
        logger.info("google-adk imported but GOOGLE_API_KEY not set — rule-based fallback active")
except ImportError:
    ADK_AVAILABLE = False
    logger.warning("google-adk import failed — rule-based fallback active")


async def run_adk_agent(agent: Any, prompt: str) -> str:
    """
    Run an ADK agent with a text prompt and return the final response text.
    Requires ADK_AVAILABLE=True and a valid GOOGLE_API_KEY.
    """
    session_service = InMemorySessionService()
    app_name = agent.name
    user_id = "oae_demo"

    session = await session_service.create_session(app_name=app_name, user_id=user_id)

    runner = Runner(
        agent=agent,
        app_name=app_name,
        session_service=session_service,
    )

    message = genai_types.Content(
        role="user",
        parts=[genai_types.Part(text=prompt)]
    )

    final_text = ""
    async for event in runner.run_async(
        user_id=user_id,
        session_id=session.id,
        new_message=message,
    ):
        if hasattr(event, "content") and event.content:
            for part in (event.content.parts or []):
                if hasattr(part, "text") and part.text:
                    final_text = part.text  # keep last complete response

    return final_text
