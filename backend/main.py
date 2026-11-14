"""
FastAPI backend for OceanOps
OAE Simulation Platform
"""

from dotenv import load_dotenv
load_dotenv()  # loads backend/.env into os.environ before anything else

import asyncio
import logging
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Real ocean data fetcher
from data_fetcher import refresh_all

# Real-time AIS vessel stream
import ais_stream

# Configuration
from config import CORS_ORIGINS, DEMO_MODE

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

    if DEMO_MODE:
        yield
        return

    threading.Thread(target=_warm, daemon=True).start()

    from nats_client import get_nats, is_nats_available
    from publishers import HealthPublisher
    from publishers.fleet_pub import get_fleet_publisher

    health_pub = None
    fleet_pub = None
    nats = get_nats()
    if await is_nats_available():
        from nats_config import setup_jetstream_streams, setup_jetstream_consumers

        await setup_jetstream_streams()
        await setup_jetstream_consumers()
        health_pub = HealthPublisher()
        fleet_pub = get_fleet_publisher()
        await health_pub.start()
        await fleet_pub.start()
    else:
        logger.info("NATS unavailable - using HTTP polling")

    ais_task = asyncio.create_task(ais_stream.stream_forever())
    try:
        yield
    finally:
        ais_task.cancel()
        with suppress(asyncio.CancelledError):
            await ais_task
        await ais_stream.stop_stream()
        if health_pub:
            await health_pub.stop()
        if fleet_pub:
            await fleet_pub.stop()
        await nats.disconnect()


app = FastAPI(
    title="OceanOps",
    description="Ocean Alkalinity Enhancement Simulation Platform",
    version="0.1.0",
    lifespan=lifespan,
)

# Prometheus metrics — exposes /metrics for Grafana scraping.
# The kube-prometheus-stack picks this up via the prometheus.io/scrape pod annotation.
try:
    from prometheus_fastapi_instrumentator import Instrumentator
    Instrumentator().instrument(app).expose(app)
except ImportError:
    logger.warning("prometheus-fastapi-instrumentator not installed; /metrics disabled")

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
