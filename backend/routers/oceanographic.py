"""
Oceanographic data endpoints (CalCOFI, SST, currents, hotspots).
"""

import json

from fastapi import APIRouter, BackgroundTasks

from config import MOCK_DATA_DIR
from data_fetcher import (
    fetch_calcofi, fetch_sst, fetch_chlorophyll,
    fetch_currents, compute_oae_scores, fetch_global_oae_hotspots,
    _load,
)

router = APIRouter()


@router.get("/oceanographic")
async def get_oceanographic_data(background_tasks: BackgroundTasks):
    """
    Real CalCOFI CTD hydrographic data from NOAA ERDDAP.
    Dataset: erdCalCOFINOAAhydros — temperature, salinity, dissolved oxygen.
    Falls back to mock data if ERDDAP is unavailable.
    """
    stations = fetch_calcofi()
    if stations:
        background_tasks.add_task(fetch_calcofi)
        return stations
    mock_file = MOCK_DATA_DIR / "calcofi_stations.json"
    if mock_file.exists():
        with open(mock_file) as f:
            return json.load(f)
    return []


@router.get("/sst")
async def get_sea_surface_temperature():
    """
    Real NOAA OISST v2.1 sea surface temperature for CA coastal waters.
    Dataset: ncdcOisst21Agg_LonPM180 — 0.25° resolution, near-daily updates.
    """
    return fetch_sst()


@router.get("/currents")
async def get_ocean_currents():
    """
    Real OSCAR 1/3° surface current data (u/v vectors).
    Dataset: jplOscar — climatological reference for CA coastal current patterns.
    Returns vectors with speed and direction for route optimization.
    """
    return fetch_currents()


@router.get("/global-hotspots")
async def get_global_hotspots():
    """
    Real global OAE suitability hotspots computed from NOAA OISST (8° coarse grid).
    Score = 55% SST (cooler = better CO2 solubility) + 45% latitude band
    (mid-latitudes 30-60° optimal for wind mixing, away from biologically hot tropics).
    Returns 400+ points covering the global ocean.
    """
    return fetch_global_oae_hotspots()


@router.get("/zone-scores")
async def get_zone_scores():
    """
    Real OAE zone suitability scores computed from ERDDAP SST + chlorophyll.
    Score components: SST (60% — cooler = better CO2 solubility) +
                      Chlorophyll (40% — lower = less biotic interference).
    """
    cached = _load("zone_scores")
    if cached:
        return cached
    sst = fetch_sst()
    chl = fetch_chlorophyll()
    if sst and chl:
        scores = compute_oae_scores(sst, chl)
        return scores
    return {}
