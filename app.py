"""Sample-only FastAPI entrypoint for the public portfolio demo."""

import os
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

os.environ["OCEANOPS_DEMO"] = "true"
sys.path.insert(0, str(Path(__file__).resolve().parent / "backend"))

from routers import (
    analysis_router,
    discovery_router,
    fleet_router,
    health_router,
    hotspot_router,
    mpas_router,
    oceanographic_router,
    simulation_router,
    traffic_router,
)

app = FastAPI(title="OceanOps Demo", docs_url=None, redoc_url=None, openapi_url=None)

for router in (
    health_router,
    fleet_router,
    traffic_router,
    mpas_router,
    oceanographic_router,
    simulation_router,
    discovery_router,
    hotspot_router,
    analysis_router,
):
    app.include_router(router, prefix="/api")


app.mount("/", StaticFiles(directory=Path(__file__).parent / "frontend" / "dist", html=True, check_dir=False))
