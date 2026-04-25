"""
FastAPI backend for The Tiered Edge Fleet
OAE Simulation Platform
"""

from dotenv import load_dotenv
load_dotenv()  # loads backend/.env into os.environ before anything else

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Real ocean data fetcher
from data_fetcher import refresh_all

# Real-time AIS vessel stream
import ais_stream

# Configuration
from config import CORS_ORIGINS

# Routers
from routers import (
    health_router,
    fleet_router,
    traffic_router,
    oceanographic_router,
    discovery_router,
    analysis_router,
    simulation_router,
    hotspot_router,
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Pre-cache all ocean datasets at startup so first requests are fast."""
    import threading

    def _warm():
        try:
            logger.info("Startup: pre-caching ocean data...")
            refresh_all()
            logger.info("Startup: ocean data cache ready")
        except Exception as exc:
            logger.warning(f"Startup cache warmup failed (non-fatal): {exc}")

    threading.Thread(target=_warm, daemon=True).start()

    # Start real-time AIS stream in background
    asyncio.create_task(ais_stream.stream_forever())

    yield


app = FastAPI(
    title="The Tiered Edge Fleet",
    description="Ocean Alkalinity Enhancement Simulation Platform",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(health_router)
app.include_router(fleet_router)
app.include_router(traffic_router)
app.include_router(oceanographic_router)
app.include_router(discovery_router)
app.include_router(analysis_router)
app.include_router(simulation_router)
app.include_router(hotspot_router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
