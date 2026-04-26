"""
FastAPI routers for OceanOps backend.
"""

from .health import router as health_router
from .fleet import router as fleet_router
from .traffic import router as traffic_router
from .oceanographic import router as oceanographic_router
from .discovery import router as discovery_router
from .analysis import router as analysis_router
from .simulation import router as simulation_router
from .hotspot import router as hotspot_router
from .mpas import router as mpas_router
from .route_plan import router as route_plan_router

__all__ = [
    "health_router",
    "fleet_router",
    "traffic_router",
    "oceanographic_router",
    "discovery_router",
    "analysis_router",
    "simulation_router",
    "hotspot_router",
    "mpas_router",
    "route_plan_router",
]
