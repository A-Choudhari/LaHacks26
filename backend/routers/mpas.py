from fastapi import APIRouter
from config import DEMO_MODE
from data_fetcher import fetch_mpas

router = APIRouter()

@router.get("/mpas")
def get_marine_protected_areas():
    """
    Real Marine Protected Areas — Pacific coast + Hawaii (NOAA MPA Inventory).
    21 features: 5 National Marine Sanctuaries, Papahānaumokuākea, Hawaiian Islands
    Humpback Whale NMS, and 14 California MLPA State Marine Reserves.
    Cached 7 days. Returns GeoJSON FeatureCollection ready for Mapbox.
    """
    if DEMO_MODE:
        return {"type": "FeatureCollection", "features": []}
    return fetch_mpas()
