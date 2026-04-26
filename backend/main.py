"""
FastAPI backend for OceanOps
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
    mpas_router,
    route_plan_router,
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

    # Start NATS connection and publishers
    health_pub = None
    fleet_pub = None
    try:
        from nats_client import get_nats, is_nats_available
        from publishers import HealthPublisher, FleetPublisher

        if await is_nats_available():
            logger.info("NATS connected - starting publishers")

            # Setup JetStream streams for message persistence
            try:
                from nats_config import setup_jetstream_streams, setup_jetstream_consumers
                await setup_jetstream_streams()
                await setup_jetstream_consumers()
            except Exception as e:
                logger.warning(f"JetStream setup failed (non-fatal): {e}")

            health_pub = HealthPublisher()
            await health_pub.start()
            fleet_pub = FleetPublisher()
            await fleet_pub.start()
        else:
            logger.info("NATS unavailable - streaming disabled, HTTP fallback active")
    except ImportError as e:
        logger.warning(f"NATS modules not available: {e}")
    except Exception as e:
        logger.warning(f"NATS startup failed (non-fatal): {e}")

    yield

    # Cleanup NATS on shutdown
    try:
        if health_pub:
            await health_pub.stop()
        if fleet_pub:
            await fleet_pub.stop()
        nats = get_nats()
        if nats.is_connected:
            await nats.disconnect()
    except Exception as e:
        logger.warning(f"NATS shutdown error: {e}")


app = FastAPI(
    title="OceanOps",
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
app.include_router(mpas_router)
app.include_router(route_plan_router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
