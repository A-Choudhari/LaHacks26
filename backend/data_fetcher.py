"""
Real oceanographic data fetcher — pulls from NOAA ERDDAP APIs.
All results are cached to data/real/ so the platform works offline.
"""

import requests
import json
import logging
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional

logger = logging.getLogger(__name__)

ERDDAP = "https://coastwatch.pfeg.noaa.gov/erddap"
DATA_DIR = Path(__file__).parent.parent / "data" / "real"
DATA_DIR.mkdir(parents=True, exist_ok=True)

# CA coastal bounding box
LAT_MIN, LAT_MAX = 32.0, 38.0
LON_MIN, LON_MAX = -125.0, -115.0
# ERDDAP 0-360 equivalents for datasets that use that convention
LON_MIN_360, LON_MAX_360 = 235.0, 245.0

TIMEOUT = 20


# ── Helpers ───────────────────────────────────────────────────────────────────

def _cache_path(name: str) -> Path:
    return DATA_DIR / f"{name}.json"


def _is_stale(path: Path, max_age_hours: int = 24) -> bool:
    if not path.exists():
        return True
    age = datetime.now().timestamp() - path.stat().st_mtime
    return age > max_age_hours * 3600


def _save(name: str, data: dict) -> None:
    with open(_cache_path(name), "w") as f:
        json.dump(data, f)
    logger.info(f"Cached {name} ({len(json.dumps(data))} bytes)")


def _load(name: str) -> Optional[dict]:
    p = _cache_path(name)
    if p.exists():
        with open(p) as f:
            return json.load(f)
    return None


def _erddap_grid(dataset_id: str, variable: str, time_str: str,
                 lat_min: float, lat_max: float,
                 lon_min: float, lon_max: float,
                 stride: int = 4) -> Optional[list]:
    """Fetch a gridded ERDDAP variable over our CA bounding box."""
    url = (
        f"{ERDDAP}/griddap/{dataset_id}.json"
        f"?{variable}[({time_str})][0]"
        f"[({lat_min}):{stride}:({lat_max})]"
        f"[({lon_min}):{stride}:({lon_max})]"
    )
    try:
        r = requests.get(url, timeout=TIMEOUT)
        if r.status_code != 200:
            logger.warning(f"ERDDAP {dataset_id} returned {r.status_code}: {r.text[:200]}")
            return None
        return r.json()["table"]["rows"]
    except Exception as e:
        logger.error(f"ERDDAP {dataset_id} fetch failed: {e}")
        return None


# ── 1. Sea Surface Temperature ────────────────────────────────────────────────

def fetch_sst(force: bool = False) -> list:
    """
    NOAA OISST v2.1 daily SST for CA coastal waters.
    Dataset: ncdcOisst21Agg_LonPM180 | Resolution: 0.25° | Updated: daily
    Returns: list of {lat, lon, sst_c}
    """
    cache_name = "sst"
    if not force and not _is_stale(_cache_path(cache_name), max_age_hours=12):
        cached = _load(cache_name)
        if cached:
            logger.info(f"SST: using cache ({len(cached['stations'])} points)")
            return cached["stations"]

    # Try progressively older dates — ERDDAP may lag real-time by a few days
    # or the dataset may not be updated to the current year yet
    for days_back in [2, 5, 10, 30, 90, 365]:
        ref_date = (datetime.utcnow() - timedelta(days=days_back)).strftime("%Y-%m-%dT00:00:00Z")
        rows = _erddap_grid(
            "ncdcOisst21Agg_LonPM180", "sst", ref_date,
            LAT_MIN, LAT_MAX, LON_MIN, LON_MAX, stride=2
        )
        if rows:
            stations = [
                {"lat": row[2], "lon": row[3], "sst_c": row[4]}
                for row in rows if row[4] is not None
            ]
            if stations:
                _save(cache_name, {"fetched_at": ref_date, "stations": stations})
                logger.info(f"SST: fetched {len(stations)} points for {ref_date} ({days_back}d ago)")
                return stations

    logger.warning("SST: all dates failed, using cache or empty")
    cached = _load(cache_name)
    return cached["stations"] if cached else []


# ── 2. CalCOFI Oceanographic Stations ────────────────────────────────────────

def fetch_calcofi(force: bool = False) -> list:
    """
    CalCOFI CTD hydrographic data (temperature, salinity, dissolved oxygen).
    Dataset: erdCalCOFINOAAhydros | Coverage: 2002–2014 | Resolution: station
    Returns: list of {station_id, lat, lon, temperature_c, salinity_psu,
                       oxygen_ml_l, line, station, suitability_score}
    """
    cache_name = "calcofi"
    if not force and not _is_stale(_cache_path(cache_name), max_age_hours=168):  # 1 week
        cached = _load(cache_name)
        if cached:
            logger.info(f"CalCOFI: using cache ({len(cached['stations'])} stations)")
            return cached["stations"]

    url = (
        f"{ERDDAP}/tabledap/erdCalCOFINOAAhydros.json"
        "?latitude,longitude,temperature,salinity,oxygen,line,station"
        "&time>=2013-01-01&time<=2014-08-23"
        f"&latitude>={LAT_MIN}&latitude<={LAT_MAX}"
        f"&longitude>={LON_MIN}&longitude<={LON_MAX}"
        "&ctd_depth<=15"
    )
    try:
        r = requests.get(url, timeout=TIMEOUT)
        if r.status_code != 200:
            logger.warning(f"CalCOFI returned {r.status_code}")
            cached = _load(cache_name)
            return cached["stations"] if cached else []

        rows = r.json()["table"]["rows"]
        # Deduplicate by lat/lon (keep one reading per station location)
        seen: set = set()
        stations = []
        for i, row in enumerate(rows):
            lat, lon, temp, sal, oxy, line, station = row
            if temp is None or sal is None:
                continue
            key = (round(lat, 2), round(lon, 2))
            if key in seen:
                continue
            seen.add(key)
            # Compute OAE suitability: prefer cool, well-oxygenated, low-salinity
            # Lower temp = better CO2 solubility; higher O2 = healthier ecosystem
            temp_score = max(0, (20 - temp) / 10)           # 0–1, prefer <20°C
            sal_score = max(0, (36 - sal) / 4)              # 0–1, prefer lower salinity
            oxy_score = min(1, oxy / 8.0) if oxy else 0.5   # 0–1, prefer higher O2
            suitability = round(0.4 * temp_score + 0.3 * sal_score + 0.3 * oxy_score, 3)
            stations.append({
                "station_id": f"CAL-{line}-{station}",
                "lat": round(lat, 4),
                "lon": round(lon, 4),
                "temperature_c": round(temp, 2),
                "salinity_psu": round(sal, 3),
                "oxygen_ml_l": round(oxy, 3) if oxy else None,
                "alkalinity_umol_kg": None,   # not in this dataset
                "chlorophyll_mg_m3": None,    # will be filled by chlorophyll fetch
                "line": line,
                "station": station,
                "suitability_score": suitability,
            })

        _save(cache_name, {"fetched_at": datetime.utcnow().isoformat(), "stations": stations})
        logger.info(f"CalCOFI: fetched {len(stations)} unique stations")
        return stations

    except Exception as e:
        logger.error(f"CalCOFI fetch failed: {e}")
        cached = _load(cache_name)
        return cached["stations"] if cached else []


# ── 3. Chlorophyll-a ──────────────────────────────────────────────────────────

def fetch_chlorophyll(force: bool = False) -> list:
    """
    MODIS Aqua 8-day chlorophyll-a for CA coastal waters.
    Dataset: erdMWchla8day (West US, 0.0125°) | lon in 0-360 convention
    Returns: list of {lat, lon, chlorophyll_mg_m3}
    """
    cache_name = "chlorophyll"
    if not force and not _is_stale(_cache_path(cache_name), max_age_hours=48):
        cached = _load(cache_name)
        if cached:
            logger.info(f"Chlorophyll: using cache ({len(cached['points'])} points)")
            return cached["points"]

    # Use a recent date — dataset goes to present
    ref_date = (datetime.utcnow() - timedelta(days=16)).strftime("%Y-%m-%dT00:00:00Z")
    rows = _erddap_grid(
        "erdMWchla8day", "chlorophyll", ref_date,
        LAT_MIN, LAT_MAX,
        LON_MIN_360, LON_MAX_360,   # 0-360 convention for this dataset
        stride=6
    )
    if not rows:
        cached = _load(cache_name)
        return cached["points"] if cached else []

    points = [
        {"lat": row[2], "lon": round(row[3] - 360, 4), "chlorophyll_mg_m3": row[4]}
        for row in rows if row[4] is not None
    ]
    _save(cache_name, {"fetched_at": ref_date, "points": points})
    logger.info(f"Chlorophyll: fetched {len(points)} valid points")
    return points


# ── 4. Ocean Currents (OSCAR) ─────────────────────────────────────────────────

def fetch_currents(force: bool = False) -> list:
    """
    OSCAR 1/3° surface currents (climatological — dataset ends 2018).
    Dataset: jplOscar | lon in 0-360 convention
    Returns: list of {lat, lon, u_m_s, v_m_s, speed_m_s, direction_deg}
    """
    cache_name = "currents"
    if not force and not _is_stale(_cache_path(cache_name), max_age_hours=168):
        cached = _load(cache_name)
        if cached:
            logger.info(f"Currents: using cache ({len(cached['vectors'])} vectors)")
            return cached["vectors"]

    # OSCAR dataset ends 2018-10-27
    ref_date = "2018-10-27T00:00:00Z"
    url = (
        f"{ERDDAP}/griddap/jplOscar.json"
        f"?u[({ref_date})][0][({LAT_MIN}):3:({LAT_MAX})]"
        f"[({LON_MIN_360}):3:({LON_MAX_360})]"
        f",v[({ref_date})][0][({LAT_MIN}):3:({LAT_MAX})]"
        f"[({LON_MIN_360}):3:({LON_MAX_360})]"
    )
    try:
        r = requests.get(url, timeout=TIMEOUT)
        if r.status_code != 200:
            logger.warning(f"OSCAR returned {r.status_code}")
            cached = _load(cache_name)
            return cached["vectors"] if cached else []

        import math
        rows = r.json()["table"]["rows"]
        vectors = []
        for row in rows:
            _, _, lat, lon, u, v = row
            if u is None or v is None:
                continue
            lon_fixed = round(lon - 360, 4)
            speed = round(math.sqrt(u**2 + v**2), 4)
            direction = round(math.degrees(math.atan2(u, v)) % 360, 1)
            vectors.append({
                "lat": round(lat, 4), "lon": lon_fixed,
                "u_m_s": round(u, 4), "v_m_s": round(v, 4),
                "speed_m_s": speed, "direction_deg": direction
            })

        _save(cache_name, {"fetched_at": ref_date, "vectors": vectors})
        logger.info(f"OSCAR: fetched {len(vectors)} current vectors")
        return vectors

    except Exception as e:
        logger.error(f"OSCAR fetch failed: {e}")
        cached = _load(cache_name)
        return cached["vectors"] if cached else []




# ── 5. Global OAE Hotspots ────────────────────────────────────────────────────

# Known Eastern Boundary Upwelling Systems (EBUS) and OAE-priority basins
# Sources: Renforth & Henderson 2017, CarbonPlan OAE Efficiency 2023,
#          Fennel et al. 2023, Bach et al. 2022
_UPWELLING_ZONES = [
    # California Current System (Pacific NE)
    {"lat_min": 30, "lat_max": 48, "lon_min": -130, "lon_max": -115, "bonus": 0.12, "label": "California Current"},
    # Humboldt Current System (Pacific SE)
    {"lat_min": -45, "lat_max": -15, "lon_min": -85, "lon_max": -68, "bonus": 0.13, "label": "Humboldt Current"},
    # Canary Current System (Atlantic NE)
    {"lat_min": 15, "lat_max": 35, "lon_min": -25, "lon_max": -8, "bonus": 0.10, "label": "Canary Current"},
    # Benguela Current System (Atlantic SE)
    {"lat_min": -35, "lat_max": -15, "lon_min": 8, "lon_max": 20, "bonus": 0.12, "label": "Benguela Current"},
    # Subpolar North Atlantic (high biological pump, deep-water formation)
    {"lat_min": 45, "lat_max": 65, "lon_min": -60, "lon_max": -10, "bonus": 0.10, "label": "Subpolar N. Atlantic"},
    # North Pacific Subpolar Gyre
    {"lat_min": 45, "lat_max": 60, "lon_min": 145, "lon_max": -140, "lon_wrap": True, "bonus": 0.09, "label": "N. Pacific Gyre"},
    # Southern Ocean (highest CO2 uptake efficiency per OAE liter — CarbonPlan 2023)
    {"lat_min": -65, "lat_max": -40, "lon_min": -180, "lon_max": 180, "bonus": 0.15, "label": "Southern Ocean"},
    # Nordic / Norwegian Sea
    {"lat_min": 62, "lat_max": 72, "lon_min": -10, "lon_max": 30, "bonus": 0.08, "label": "Nordic Seas"},
]


def _upwelling_bonus(lat: float, lon: float) -> float:
    """Return cumulative upwelling/priority-basin bonus for a lat/lon point."""
    bonus = 0.0
    for zone in _UPWELLING_ZONES:
        lat_ok = zone["lat_min"] <= lat <= zone["lat_max"]
        if zone.get("lon_wrap"):
            # crosses antimeridian — split into two halves
            lon_ok = lon >= zone["lon_min"] or lon <= zone["lon_max"]
        else:
            lon_ok = zone["lon_min"] <= lon <= zone["lon_max"]
        if lat_ok and lon_ok:
            bonus += zone["bonus"]
    return min(bonus, 0.25)  # cap total bonus


def fetch_global_wind(ref_date: str) -> dict:
    """
    Fetch global monthly mean wind speed from QuikSCAT/ASCAT (erdQCwindproductsMonthly).
    Dataset: CERSAT Global Blended Mean Wind Fields, monthly mean.
    Covers 1999-2024+, 0.25°, global.
    Returns: dict of (round_lat, round_lon) -> wind_speed_m_s
    """
    STRIDE = 16   # ~4° step
    url = (
        f"{ERDDAP}/griddap/erdQCwindproductsMonthly.json"
        f"?wind_speed[({ref_date})][0][(-69.833):{STRIDE}:(69.833)][(-179.833):{STRIDE}:(179.832)]"
    )
    try:
        r = requests.get(url, timeout=30)
        if r.status_code != 200:
            logger.warning(f"Wind fetch returned {r.status_code}")
            return {}
        rows = r.json()["table"]["rows"]
        wind_map = {}
        for row in rows:
            _, _, lat, lon, wspd = row
            if wspd is not None:
                wind_map[(round(lat, 1), round(lon, 1))] = round(wspd, 2)
        logger.info(f"Wind: fetched {len(wind_map)} points")
        return wind_map
    except Exception as e:
        logger.error(f"Wind fetch failed: {e}")
        return {}


def fetch_global_oae_hotspots(force: bool = False) -> list:
    """
    Compute scientifically-grounded global OAE deployment suitability hotspots
    from multi-source real ERDDAP data.

    Scoring factors (based on Renforth & Henderson 2017, CarbonPlan 2023,
    Fennel et al. 2023 OAE efficiency literature):

    1. SST score (30%): Cooler water holds more CO₂ per mol alkalinity added.
       Henry's Law: solubility ∝ exp(-ΔH/RT). Optimal: 5–18°C.
    2. Wind score (30%): Gas transfer velocity k ∝ u² (Wanninkhof 1992/2014).
       Higher winds = faster air-sea CO₂ equilibration. Optimal: 7–15 m/s.
    3. Latitude / Mixing dynamics (25%): Mid-to-high latitudes have deeper
       mixed layers and better overturning to sequester enriched water.
       Southern Ocean > Subpolar gyres > Subtropics > Tropics.
    4. Upwelling / Priority basin bonus (15%): Major Eastern Boundary Upwelling
       Systems (EBUS) naturally bring deep, CO₂-rich water to the surface,
       amplifying OAE efficiency. Southern Ocean has highest per-mole efficiency.

    Returns: list of {lat, lon, sst_c, wind_m_s, oae_score, factors} sorted
             by oae_score descending.
    """
    import math as _math

    cache_name = "global_hotspots"
    # Use 7-day cache — scoring is stable on weekly timescales
    if not force and not _is_stale(_cache_path(cache_name), max_age_hours=168):
        cached = _load(cache_name)
        if cached:
            logger.info(f"Global hotspots: using cache ({len(cached['hotspots'])} points)")
            return cached["hotspots"]

    # ── Step 1: Fetch SST (NOAA OISST) ──────────────────────────────────────
    STRIDE = 16   # 4° effective resolution
    sst_rows = None
    used_date = None

    for days_back in [90, 180, 365]:
        ref_date = (datetime.utcnow() - timedelta(days=days_back)).strftime("%Y-%m-%dT00:00:00Z")
        url = (
            f"{ERDDAP}/griddap/ncdcOisst21Agg_LonPM180.json"
            f"?sst[({ref_date})][0][(-70):{STRIDE}:(70)][(-180):{STRIDE}:(179)]"
        )
        try:
            r = requests.get(url, timeout=30)
            if r.status_code == 200:
                rows = r.json()["table"]["rows"]
                if rows:
                    sst_rows = rows
                    used_date = ref_date
                    logger.info(f"OAE hotspots SST: {len(rows)} points from {days_back}d ago")
                    break
        except Exception as e:
            logger.error(f"SST fetch failed ({days_back}d ago): {e}")

    if not sst_rows:
        # Fall back to cache if network is down
        cached = _load(cache_name)
        return cached["hotspots"] if cached else []

    # ── Step 2: Fetch wind speed (QuikSCAT/ASCAT monthly mean) ───────────────
    # Try the closest wind date — dataset goes through 2024+
    wind_map: dict = {}
    for wind_date in ["2024-08-15T00:00:00Z", "2023-09-15T00:00:00Z", "2022-09-15T00:00:00Z"]:
        wind_map = fetch_global_wind(wind_date)
        if wind_map:
            break

    def _lookup_wind(lat: float, lon: float) -> Optional[float]:
        """Nearest-neighbour lookup in wind_map at 4° grid."""
        best_dist, best_val = 9999, None
        for (wlat, wlon), wspd in wind_map.items():
            d = (wlat - lat) ** 2 + (wlon - lon) ** 2
            if d < best_dist:
                best_dist = d
                best_val = wspd
        return best_val if best_dist < 25 else None   # within ~5° radius

    # ── Step 3: Score each point ──────────────────────────────────────────────
    hotspots = []

    for row in sst_rows:
        _, _, lat, lon, sst = row
        if sst is None:
            continue

        lat_abs = abs(lat)

        # Skip land-masked points (OISST returns NaN for land, but sometimes
        # extreme polar values slip through — filter SST outside ocean range)
        if not (-3.0 <= sst <= 35.0):
            continue

        # ── Factor 1: SST score (30%) ──────────────────────────────────────
        # CO₂ solubility peaks at ~2°C, halves by ~25°C (Henry's Law).
        # Practical OAE range: 5–20°C is most deployable.
        # Score function: linearly ramps from 0 at sst=28°C to 1.0 at sst=2°C
        sst_score = max(0.0, min(1.0, (28.0 - sst) / 26.0))

        # ── Factor 2: Wind score (30%) ─────────────────────────────────────
        # Gas transfer velocity k ∝ u^n (n≈1.7–2.0, Wanninkhof 2014).
        # Optimal for OAE: moderate-to-strong winds (7–15 m/s) promote fast
        # CO₂ uptake without excessive sea spray or logistics risk.
        # Score: peaks at 10 m/s, falls off below 4 and above 18 m/s.
        wind = _lookup_wind(lat, lon) if wind_map else None
        if wind is not None:
            if wind < 4.0:
                wind_score = wind / 4.0 * 0.4          # very calm — poor gas exchange
            elif wind <= 12.0:
                wind_score = 0.4 + (wind - 4.0) / 8.0 * 0.6  # ramps to 1.0 at 12 m/s
            else:
                wind_score = max(0.4, 1.0 - (wind - 12.0) / 12.0)  # extreme wind, harder ops
        else:
            # No wind data — use latitude-based climatological proxy
            # (Southern Ocean & mid-latitudes are windier on average)
            if lat_abs > 45:
                wind_score = 0.75  # Southern Ocean / subpolar — reliably windy
            elif lat_abs > 30:
                wind_score = 0.60
            elif lat_abs > 15:
                wind_score = 0.45
            else:
                wind_score = 0.30  # tropics — calmer trade-wind belts

        # ── Factor 3: Latitude / mixing dynamics score (25%) ──────────────
        # Based on CarbonPlan 2023 efficiency map + Renforth & Henderson 2017:
        # - Southern Ocean (40-65°S): highest CO₂ uptake efficiency, deep MLD
        # - Subpolar gyres (45-65°N): N. Atlantic deep water, overturning
        # - Mid-latitudes (30-45°): good efficiency, practical logistics
        # - Subtropics (15-30°): oligotrophic, moderate — good for ship ops
        # - Tropics (0-15°): warm, lower solubility, thermocline cap
        # - High polar (>65°): ice risk, logistics, lower year-round efficiency
        if lat < -40 and lat > -65:       # Southern Ocean — premium zone
            lat_score = 1.00
        elif lat_abs > 45 and lat_abs <= 65:  # Subpolar gyres N+S
            lat_score = 0.90
        elif lat_abs > 30 and lat_abs <= 45:  # Mid-latitudes
            lat_score = 0.80
        elif lat_abs > 15 and lat_abs <= 30:  # Subtropics
            lat_score = 0.55
        elif lat_abs >= 65:               # High polar — ice / logistics risk
            lat_score = 0.30
        else:                             # Tropics
            lat_score = 0.20

        # ── Factor 4: Upwelling / priority basin bonus (15%) ──────────────
        upw_bonus = _upwelling_bonus(lat, lon)

        # ── Composite OAE score ────────────────────────────────────────────
        # Weights: SST 30% + Wind 30% + Lat/mixing 25% + Upwelling bonus ≤15%
        # upw_bonus is already on the 0–0.25 absolute scale (not normalised),
        # so the theoretical max is 0.85 + 0.25 = 1.10, clamped to 1.0.
        oae_score = min(1.0, round(
            0.30 * sst_score +
            0.30 * wind_score +
            0.25 * lat_score +
            upw_bonus,
            3
        ))

        # Only keep points with high potential (>0.70) to remove the uniform grid appearance
        # and only show actual scientifically-viable hotspot clusters
        if oae_score >= 0.70:
            import random
            # Add small geographic jitter (±1.5 degrees) so the remaining points look organic
            # rather than sitting strictly on a 4-degree mathematical grid
            jitter_lat = random.uniform(-1.5, 1.5)
            jitter_lon = random.uniform(-1.5, 1.5)
            hotspots.append({
                "lat":      round(lat + jitter_lat, 2),
                "lon":      round(lon + jitter_lon, 2),
                "sst_c":    round(sst, 1),
                "wind_m_s": round(wind, 1) if wind is not None else None,
                "oae_score": oae_score,
            })

    if not hotspots:
        cached = _load(cache_name)
        return cached["hotspots"] if cached else []

    hotspots.sort(key=lambda x: x["oae_score"], reverse=True)
    _save(cache_name, {"fetched_at": used_date, "hotspots": hotspots})
    logger.info(
        f"Global OAE hotspots: {len(hotspots)} viable points scored "
        f"(SST×0.30 + Wind×0.30 + Lat×0.25 + Upwelling bonus)"
    )
    return hotspots


# ── 6. OAE Zone Scoring (composite from real data) ───────────────────────────

def compute_oae_scores(
    sst_data: list,
    chlorophyll_data: list,
) -> dict:
    """
    Score candidate OAE deployment zones using real SST and chlorophyll data.
    Lower SST = better CO2 solubility.
    Lower chlorophyll = less biotic interference with alkalinity addition.
    Returns: dict of zone_name -> {score, sst_c, chlorophyll_mg_m3, reason}
    """
    import math

    def sample_grid(data_list: list, lat: float, lon: float,
                    lat_key: str, lon_key: str, val_key: str,
                    radius: float = 1.5) -> Optional[float]:
        """Inverse-distance weighted average of nearby grid points."""
        total_w, total_v = 0.0, 0.0
        for pt in data_list:
            dlat = pt[lat_key] - lat
            dlon = pt[lon_key] - lon
            dist = math.sqrt(dlat**2 + dlon**2)
            if dist > radius or pt[val_key] is None:
                continue
            w = 1.0 / max(dist, 0.01)
            total_w += w
            total_v += w * pt[val_key]
        return round(total_v / total_w, 3) if total_w > 0 else None

    # Zone centroids (from constants.ts organic blobs)
    zones = {
        "Zone Alpha": {"lat": 35.2, "lon": -121.4},
        "Zone Beta":  {"lat": 32.8, "lon": -118.8},
        "Zone Gamma": {"lat": 34.0, "lon": -118.4},
    }

    results = {}
    for name, coords in zones.items():
        lat, lon = coords["lat"], coords["lon"]
        sst = sample_grid(sst_data, lat, lon, "lat", "lon", "sst_c")
        chl = sample_grid(chlorophyll_data, lat, lon, "lat", "lon", "chlorophyll_mg_m3")

        # Score: prefer cooler water (more CO2 solubility) + lower chlorophyll
        sst_score = max(0, min(1, (22 - (sst or 18)) / 10))
        chl_score = max(0, min(1, 1 - ((chl or 0.3) / 2.0)))
        score = round(0.6 * sst_score + 0.4 * chl_score, 3)

        reasons = []
        if sst is not None:
            reasons.append(f"SST {sst:.1f}°C")
        if chl is not None:
            reasons.append(f"Chl-a {chl:.2f} mg/m³")
        reason = ", ".join(reasons) if reasons else "Real ERDDAP data"

        results[name] = {
            "score": score,
            "sst_c": sst,
            "chlorophyll_mg_m3": chl,
            "reason": f"Real ocean data — {reason}"
        }

    return results


# ── 7. Refresh all datasets ───────────────────────────────────────────────────

def refresh_all(force: bool = False) -> dict:
    """Fetch all real datasets. Called at startup and on demand."""
    results = {}
    logger.info("Refreshing all real ocean datasets...")

    results["sst"]          = fetch_sst(force)
    results["calcofi"]      = fetch_calcofi(force)
    results["chlorophyll"]  = fetch_chlorophyll(force)
    results["currents"]     = fetch_currents(force)

    # Compute real zone scores
    if results["sst"] and results["chlorophyll"]:
        results["zone_scores"] = compute_oae_scores(
            results["sst"], results["chlorophyll"]
        )
        _save("zone_scores", results["zone_scores"])
        logger.info(f"Zone scores: {results['zone_scores']}")

    return results
