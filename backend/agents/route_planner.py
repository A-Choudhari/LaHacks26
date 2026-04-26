"""
Agent 3: Route Planner — MPA-avoiding, CO2-maximizing fleet routing.

Function tools (deterministic, always run):
  compute_segment_mpa_conflicts(ships, zones, mpa_features)
      → per-ship list of route segments with MPA hits and detour waypoints
  compute_zone_co2_potential(zones, ocean_states)
      → per-zone CO2 capture score combining OAE score + ocean conditions

Agent flow:
  1. Deterministic phase: score all zones by CO2 potential, detect MPA conflicts,
     compute detour waypoints for any conflicting segments.
  2. AI phase: Gemma4 receives all data and decides optimal zone ordering per ship
     and reasons about the fleet-level strategy.
  3. Fallback: greedy nearest-neighbor assignment if Gemma4 unavailable.
"""

import json
import math
import logging
from pathlib import Path
from typing import Optional

from .base import query_gemma, extract_json, is_ollama_available

logger = logging.getLogger(__name__)

_MPA_FILE = Path(__file__).parent.parent.parent / "data" / "real" / "mpas.json"


# ── Land / island obstacles (bounding boxes + clearance) ─────────────────────
# Each entry: (lon_min, lat_min, lon_max, lat_max, name, clearance_lon)
# clearance_lon = minimum longitude ships must stay west of when passing this obstacle
_LAND_OBSTACLES = [
    # California mainland coast (ships must stay west of this line)
    (-118.60, 33.40, -118.20, 34.10, "Palos Verdes / LA Coast", -118.80),
    # Santa Catalina Island
    (-118.65, 33.20, -118.25, 33.55, "Catalina Island", -118.80),
    # Channel Islands (San Miguel, Santa Rosa, Santa Cruz, Anacapa)
    (-120.55, 33.85, -119.25, 34.15, "Channel Islands", -120.75),
    # Santa Barbara Island
    (-119.10, 33.35, -118.95, 33.55, "Santa Barbara Island", -119.25),
    # San Clemente Island
    (-118.65, 32.75, -118.30, 33.10, "San Clemente Island", -118.85),
    # Farallon Islands (off SF)
    (-123.08, 37.60, -122.92, 37.80, "Farallon Islands", -123.20),
    # Point Conception / Vandenberg coast notch
    (-120.80, 34.35, -120.40, 34.60, "Point Conception Coast", -121.00),
    # Point Reyes headland
    (-123.05, 37.85, -122.80, 38.05, "Point Reyes", -123.20),
]

# Maritime corridor: when heading north of 34.5°N from southern CA,
# stay west of this longitude to avoid the coast and islands
_MARITIME_CORRIDOR_LON = -121.20  # clear of all Channel Islands + coast


# ── Geometry helpers ──────────────────────────────────────────────────────────

def _haversine_km(a: dict, b: dict) -> float:
    R = 6371
    φ1, φ2 = math.radians(a["lat"]), math.radians(b["lat"])
    dφ = math.radians(b["lat"] - a["lat"])
    dλ = math.radians(b["lon"] - a["lon"])
    h = math.sin(dφ / 2) ** 2 + math.cos(φ1) * math.cos(φ2) * math.sin(dλ / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(h), math.sqrt(1 - h))


def _point_in_ring(lon: float, lat: float, ring: list) -> bool:
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > lat) != (yj > lat)) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def _segment_hits_land(a: dict, b: dict, samples: int = 20) -> Optional[str]:
    """Check if a route segment crosses a known land/island obstacle."""
    for i in range(samples + 1):
        t = i / samples
        lon = a["lon"] + t * (b["lon"] - a["lon"])
        lat = a["lat"] + t * (b["lat"] - a["lat"])
        for (lo0, la0, lo1, la1, name, _) in _LAND_OBSTACLES:
            if lo0 <= lon <= lo1 and la0 <= lat <= la1:
                return name
    return None


def _ocean_safe_waypoints(a: dict, b: dict, obstacle_name: str) -> list[dict]:
    """
    Return waypoints that route around a land obstacle via an L-shaped ocean path:
      1. Go west to clear_lon at current latitude (stay south of obstacle).
      2. Travel north/south along clear_lon past the obstacle.
    This guarantees no sub-segment re-enters the obstacle.
    """
    for (lo0, la0, lo1, la1, name, clear_lon) in _LAND_OBSTACLES:
        if name != obstacle_name:
            continue
        buf = 0.12
        wps = []
        # Entry point: same latitude as `a` but at clearance longitude
        # If `a` is already west of clear_lon, no need for this step
        if a["lon"] > clear_lon:
            wps.append({
                "lat": round(a["lat"], 4),
                "lon": round(clear_lon - 0.05, 4),
                "label": f"Ocean corridor W ({name})",
                "is_detour": True,
            })
        # If b is north of the obstacle, travel north along clear_lon
        # If b is south, travel south along clear_lon
        if b["lat"] > la1 + buf:
            wps.append({
                "lat": round(la1 + buf, 4),
                "lon": round(clear_lon - 0.05, 4),
                "label": f"Ocean corridor N ({name})",
                "is_detour": True,
            })
        elif b["lat"] < la0 - buf:
            wps.append({
                "lat": round(la0 - buf, 4),
                "lon": round(clear_lon - 0.05, 4),
                "label": f"Ocean corridor S ({name})",
                "is_detour": True,
            })
        return wps
    return []


def _insert_ocean_waypoints(waypoints: list[dict], max_passes: int = 4) -> list[dict]:
    """
    Walk every segment; if it crosses a land obstacle, insert L-path waypoints.
    Repeats up to max_passes times so cascading obstacles are resolved.
    """
    for _ in range(max_passes):
        result = [waypoints[0]]
        changed = False
        for i in range(1, len(waypoints)):
            a, b = result[-1], waypoints[i]
            hit = _segment_hits_land(a, b)
            if hit:
                extras = _ocean_safe_waypoints(a, b, hit)
                if extras:
                    result.extend(extras)
                    changed = True
            result.append(waypoints[i])
        waypoints = result
        if not changed:
            break
    return waypoints


def _segment_mpa_hit(a: dict, b: dict, features: list, samples: int = 16) -> Optional[dict]:
    """Sample a route segment; return MPA feature if any sample falls inside one."""
    for i in range(samples + 1):
        t = i / samples
        lon = a["lon"] + t * (b["lon"] - a["lon"])
        lat = a["lat"] + t * (b["lat"] - a["lat"])
        for feat in features:
            geom = feat.get("geometry", {})
            rings = []
            if geom.get("type") == "Polygon":
                rings = geom["coordinates"]
            elif geom.get("type") == "MultiPolygon":
                rings = [r for poly in geom["coordinates"] for r in poly]
            for ring in rings:
                if _point_in_ring(lon, lat, ring):
                    return feat
    return None


def _polygon_centroid(coordinates: list) -> tuple[float, float]:
    ring = coordinates[0]
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    return sum(lons) / len(lons), sum(lats) / len(lats)


def _detour_waypoint(a: dict, b: dict, mpa_feat: dict) -> Optional[dict]:
    """
    Compute a detour waypoint around an MPA, always keeping the route in ocean water.
    For Pacific coast: route around the WESTERN (offshore) edge of the MPA.
    Verifies the detour itself doesn't cross land before returning it.
    """
    geom = mpa_feat.get("geometry", {})
    coords_list = []
    if geom.get("type") == "Polygon":
        coords_list = geom["coordinates"][0]
    elif geom.get("type") == "MultiPolygon":
        coords_list = geom["coordinates"][0][0]
    if not coords_list:
        return None

    lons = [p[0] for p in coords_list]
    lats = [p[1] for p in coords_list]
    mid_lat = (a["lat"] + b["lat"]) / 2

    # Candidates: go around each edge of the MPA with a buffer
    buf_lon, buf_lat = 0.18, 0.14
    wp_lat = max(min(lats) - buf_lat, min(max(lats) + buf_lat, mid_lat))
    candidates = [
        # West (offshore for Pacific coast) — strongly preferred
        {"lon": round(min(lons) - buf_lon, 4), "lat": round(wp_lat, 4), "priority": 0},
        # South
        {"lon": round(sum(lons) / len(lons), 4), "lat": round(min(lats) - buf_lat, 4), "priority": 1},
        # North
        {"lon": round(sum(lons) / len(lons), 4), "lat": round(max(lats) + buf_lat, 4), "priority": 2},
    ]

    # Pick first candidate that doesn't cross a land obstacle
    for c in sorted(candidates, key=lambda x: x["priority"]):
        wp = {"lat": c["lat"], "lon": c["lon"]}
        if not _segment_hits_land(a, wp) and not _segment_hits_land(wp, b):
            return wp

    # Last resort: go far west
    return {"lon": round(min(lons) - 0.5, 4), "lat": round(wp_lat, 4)}


# ── Tool 1: MPA conflict detection + detour computation ──────────────────────

def compute_segment_conflicts(ships: list, zones: list, mpa_features: list) -> list:
    """
    For each ship's route (ship → assigned zones in order), check every segment
    for MPA conflicts and compute detour waypoints.

    Returns list of per-ship conflict reports:
      [{ ship_id, ship_name, segments: [{from, to, mpa_name, detour_wp}] }]
    """
    reports = []
    for ship_route in ships:
        ship_id   = ship_route["ship_id"]
        ship_name = ship_route["ship_name"]
        waypoints = ship_route["waypoints"]  # [{"lat","lon","label"}, ...]
        seg_reports = []
        for i in range(len(waypoints) - 1):
            a, b = waypoints[i], waypoints[i + 1]
            hit = _segment_mpa_hit(a, b, mpa_features)
            if hit:
                detour = _detour_waypoint(a, b, hit)
                seg_reports.append({
                    "from": a.get("label", f"WP{i}"),
                    "to":   b.get("label", f"WP{i+1}"),
                    "mpa_name": hit.get("properties", {}).get("SITE_NAME", "MPA"),
                    "detour_wp": detour,
                })
        reports.append({
            "ship_id": ship_id,
            "ship_name": ship_name,
            "segments": seg_reports,
        })
    return reports


# ── Tool 2: Zone CO2 potential scoring ────────────────────────────────────────

def compute_zone_co2_potential(zones: list, ocean_states: dict) -> list:
    """
    Score each zone for CO2 capture potential combining:
      • OAE suitability score (40%)
      • SST score — cooler = more CO2 solubility (30%)
      • Mixed layer depth — deeper = more dispersal volume (20%)
      • Wind proxy via latitude (10%)
    Returns list of zones with 'co2_potential' and 'co2_reason' added.
    """
    scored = []
    for z in zones:
        key = f"{round(z['lat'], 1)},{round(z['lon'], 1)}"
        ocean = ocean_states.get(key, {})

        oae   = float(z.get("score", 0.7))
        sst   = ocean.get("temperature_c", 15.0)
        mld   = ocean.get("mixed_layer_depth_m", 60.0)

        sst_score = max(0.0, min(1.0, (22.0 - sst) / 14.0))
        mld_score = max(0.0, min(1.0, (mld - 30.0) / 80.0))
        lat_wind  = min(1.0, abs(z["lat"]) / 50.0)

        co2_pot = round(0.40 * oae + 0.30 * sst_score + 0.20 * mld_score + 0.10 * lat_wind, 3)
        scored.append({
            **z,
            "co2_potential": co2_pot,
            "co2_reason": (
                f"SST {sst:.1f}°C (score {sst_score:.2f}), "
                f"MLD {mld:.0f}m (score {mld_score:.2f}), "
                f"OAE {oae:.2f}"
            ),
        })
    scored.sort(key=lambda x: x["co2_potential"], reverse=True)
    return scored


# ── Greedy deterministic fallback ─────────────────────────────────────────────

def _greedy_assign(ships: list, zones: list) -> list:
    """
    Nearest-neighbor greedy assignment: each ship claims closest unassigned zone;
    last ship absorbs all remaining via TSP nearest-neighbor.
    Returns list of {ship_id, ship_name, assigned_zones}.
    """
    remaining = list(range(len(zones)))
    assignments = []

    for si, ship in enumerate(ships):
        if not remaining:
            assignments.append({**ship, "assigned_zones": []})
            continue

        pos = {"lat": ship["lat"], "lon": ship["lon"]}
        best_j = min(remaining, key=lambda j: _haversine_km(pos, {"lat": zones[j]["lat"], "lon": zones[j]["lon"]}))
        assigned = [zones[best_j]]
        remaining.remove(best_j)

        if si == len(ships) - 1:
            cur = assigned[-1]
            while remaining:
                nj = min(remaining, key=lambda j: _haversine_km(cur, {"lat": zones[j]["lat"], "lon": zones[j]["lon"]}))
                assigned.append(zones[nj])
                cur = zones[nj]
                remaining.remove(nj)

        assignments.append({**ship, "assigned_zones": assigned})
    return assignments


# ── Agentic route planning ────────────────────────────────────────────────────

async def plan_routes(
    ships: list,
    zones: list,
    ocean_states: dict,
    mpa_features: list,
) -> dict:
    """
    Main entry point. Runs deterministic tools then calls Gemma4 to reason
    about optimal fleet routing strategy.

    Args:
        ships:        [{"ship_id", "ship_name", "lat", "lon", "color"}]
        zones:        [{"lat", "lon", "score", "name", "reason"}]
        ocean_states: {key: ocean_dict} keyed by "lat,lon"
        mpa_features: GeoJSON features list from mpas.json

    Returns:
        {
          routes: [{ship_id, ship_name, color, waypoints, total_km,
                    co2_estimate_tons, detour_waypoints, mpa_warnings}],
          agent_reasoning: str,
          fleet_co2_estimate: float,
          model_used: str,
        }
    """
    # ── Phase 1: deterministic tools ─────────────────────────────────────────
    scored_zones = compute_zone_co2_potential(zones, ocean_states)

    # Start with greedy assignment as baseline
    greedy = _greedy_assign(ships, scored_zones)

    # Build initial waypoints per ship for conflict detection
    def make_waypoints(ship: dict, assigned: list) -> list:
        wps = [{"lat": ship["lat"], "lon": ship["lon"], "label": ship["ship_name"]}]
        for z in assigned:
            wps.append({"lat": z["lat"], "lon": z["lon"], "label": z.get("name", "Site")})
        return wps

    initial_routes = [
        {"ship_id": s["ship_id"], "ship_name": s["ship_name"],
         "waypoints": make_waypoints(s, s["assigned_zones"])}
        for s in greedy
    ]
    conflicts = compute_segment_conflicts(initial_routes, scored_zones, mpa_features)

    # ── Phase 2: Gemma4 reasoning ─────────────────────────────────────────────
    model_used = "rule-based-fallback"
    agent_reasoning = (
        "Greedy nearest-neighbor assignment. Each ship targets its closest high-CO₂ "
        "potential site. Remaining sites absorbed by last ship via TSP ordering."
    )

    if await is_ollama_available():
        zones_summary = "\n".join(
            f"  - {z.get('name','?')} (lat={z['lat']:.2f}, lon={z['lon']:.2f}): "
            f"CO₂ potential={z['co2_potential']:.3f}, {z['co2_reason']}"
            for z in scored_zones
        )
        ships_summary = "\n".join(
            f"  - {s['ship_name']} at ({s['lat']:.2f}, {s['lon']:.2f})"
            for s in ships
        )
        conflict_summary = ""
        for c in conflicts:
            if c["segments"]:
                for seg in c["segments"]:
                    conflict_summary += (
                        f"  - {c['ship_name']}: {seg['from']}→{seg['to']} "
                        f"crosses {seg['mpa_name']}"
                        + (f", detour via ({seg['detour_wp']['lat']:.2f},{seg['detour_wp']['lon']:.2f})"
                           if seg.get("detour_wp") else "")
                        + "\n"
                    )
        if not conflict_summary:
            conflict_summary = "  None — all direct routes are MPA-clear."

        prompt = f"""You are an expert ocean fleet routing agent for Ocean Alkalinity Enhancement (OAE).

SHIPS:
{ships_summary}

DEPLOYMENT SITES (sorted by CO2 capture potential, highest first):
{zones_summary}

MPA CONFLICTS ON DIRECT ROUTES:
{conflict_summary}

TASK: Assign each ship to 1+ sites to MAXIMIZE total fleet CO2 capture. Rules:
1. Assign higher CO2-potential sites first.
2. Minimize total travel distance (less fuel = more deployment time).
3. If a direct route crosses an MPA, use the provided detour waypoint.
4. Each site must be assigned to exactly one ship.
5. Provide a brief strategic rationale (2-3 sentences) for your fleet plan.

Return ONLY valid JSON:
{{
  "assignments": [
    {{"ship_name": "...", "site_order": ["Site A", "Site B"]}},
    ...
  ],
  "reasoning": "..."
}}"""

        try:
            raw = await query_gemma(
                prompt,
                system="You are a marine route planning AI. Return only valid JSON. No markdown.",
                timeout=60.0,
                num_predict=600,
            )
            parsed = extract_json(raw)
            if parsed and "assignments" in parsed and "reasoning" in parsed:
                agent_reasoning = parsed["reasoning"]
                model_used = "gemma4:31b (local)"

                # Re-order zones per ship according to agent decisions
                name_to_zone = {z.get("name", ""): z for z in scored_zones}
                new_greedy = []
                for s, asgn in zip(ships, parsed["assignments"]):
                    ordered = [name_to_zone[n] for n in asgn["site_order"] if n in name_to_zone]
                    # If agent returned unknown names, fall back to greedy for this ship
                    if not ordered:
                        gs = next((g for g in greedy if g["ship_id"] == s["ship_id"]), None)
                        ordered = gs["assigned_zones"] if gs else []
                    new_greedy.append({**s, "assigned_zones": ordered})
                greedy = new_greedy

                # Re-run conflict detection with agent-ordered routes
                initial_routes = [
                    {"ship_id": s["ship_id"], "ship_name": s["ship_name"],
                     "waypoints": make_waypoints(s, s["assigned_zones"])}
                    for s in greedy
                ]
                conflicts = compute_segment_conflicts(initial_routes, scored_zones, mpa_features)

        except Exception as e:
            logger.warning(f"RoutePlannerAgent: Gemma4 call failed: {e}")

    # ── Phase 3: assemble final routes with detours ───────────────────────────
    SHIP_COLORS = {
        "Pacific Guardian": "#00c8f0",
        "Ocean Sentinel":   "#4ade80",
        "Reef Protector":   "#fbbf24",
    }
    FALLBACK_COLORS = ["#a78bfa", "#f472b6", "#fb923c"]

    routes = []
    fleet_co2 = 0.0

    for si, ship in enumerate(greedy):
        color = SHIP_COLORS.get(ship["ship_name"], FALLBACK_COLORS[si % len(FALLBACK_COLORS)])
        conflict_map = {
            (seg["from"], seg["to"]): seg
            for cr in conflicts if cr["ship_id"] == ship["ship_id"]
            for seg in cr["segments"]
        }

        # Build waypoints with detour insertions
        raw_waypoints = make_waypoints(ship, ship["assigned_zones"])
        final_waypoints = [raw_waypoints[0]]
        mpa_warnings = []

        for i in range(1, len(raw_waypoints)):
            a_label = raw_waypoints[i - 1]["label"]
            b_label = raw_waypoints[i]["label"]
            seg_key = (a_label, b_label)
            conflict = conflict_map.get(seg_key)
            if conflict and conflict.get("detour_wp"):
                dw = conflict["detour_wp"]
                final_waypoints.append({
                    "lat": dw["lat"], "lon": dw["lon"],
                    "label": f"Detour ({conflict['mpa_name']})",
                    "is_detour": True,
                })
                mpa_warnings.append(
                    f"Rerouted around {conflict['mpa_name']} between {a_label} and {b_label}"
                )
            final_waypoints.append(raw_waypoints[i])

        # Final pass: insert ocean-corridor waypoints around any land obstacles
        final_waypoints = _insert_ocean_waypoints(final_waypoints)

        total_km = sum(
            _haversine_km(final_waypoints[i], final_waypoints[i + 1])
            for i in range(len(final_waypoints) - 1)
        )
        co2_estimate = total_km * 2.1
        fleet_co2 += co2_estimate

        routes.append({
            "ship_id":           ship["ship_id"],
            "ship_name":         ship["ship_name"],
            "color":             color,
            "waypoints":         final_waypoints,
            "total_km":          round(total_km, 1),
            "co2_estimate_tons": round(co2_estimate, 1),
            "sites":             ship["assigned_zones"],
            "mpa_warnings":      mpa_warnings,
        })

    return {
        "routes":              routes,
        "agent_reasoning":     agent_reasoning,
        "fleet_co2_estimate":  round(fleet_co2, 1),
        "model_used":          model_used,
    }
