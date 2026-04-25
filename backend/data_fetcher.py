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


# ── 5. OAE Zone Scoring (composite from real data) ───────────────────────────

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


# ── 6. Refresh all datasets ───────────────────────────────────────────────────

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
