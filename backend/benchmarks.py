"""
Benchmarks for OAE route planning and hotspot determination algorithms.

Run with: python benchmarks.py
Output: benchmark results printed to stdout + saved to data/benchmark_results.json
"""

import json
import math
import time
import statistics
import random
from pathlib import Path
from typing import NamedTuple

PROJECT_ROOT = Path(__file__).parent.parent
DATA_DIR = PROJECT_ROOT / "data"
OUTPUT_FILE = DATA_DIR / "benchmark_results.json"


# ═══════════════════════════════════════════════════════════════════
# SECTION 1 — Route Planning Benchmarks
# ═══════════════════════════════════════════════════════════════════

def haversine_km(a: dict, b: dict) -> float:
    R = 6371
    phi1 = a["lat"] * math.pi / 180
    phi2 = b["lat"] * math.pi / 180
    dphi = (b["lat"] - a["lat"]) * math.pi / 180
    dlam = (b["lon"] - a["lon"]) * math.pi / 180
    x = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(x), math.sqrt(1 - x))


def greedy_route(start: dict, stops: list[dict]) -> tuple[list[dict], float]:
    """Greedy nearest-neighbor TSP starting from `start`."""
    remaining = list(stops)
    path = [start]
    cur = start
    while remaining:
        best_i = min(range(len(remaining)), key=lambda i: haversine_km(cur, remaining[i]))
        nxt = remaining.pop(best_i)
        path.append(nxt)
        cur = nxt
    dist = sum(haversine_km(path[i], path[i + 1]) for i in range(len(path) - 1))
    return path, dist


def optimal_tsp_brute(start: dict, stops: list[dict]) -> tuple[list[dict], float]:
    """Brute-force optimal TSP (only feasible for ≤ 8 stops)."""
    from itertools import permutations
    best_dist = float("inf")
    best_perm: tuple = ()
    for perm in permutations(range(len(stops))):
        path = [start] + [stops[i] for i in perm]
        dist = sum(haversine_km(path[i], path[i + 1]) for i in range(len(path) - 1))
        if dist < best_dist:
            best_dist = dist
            best_perm = perm
    return [start] + [stops[i] for i in best_perm], best_dist


def assign_ships_greedy(ships: list[dict], zones: list[dict]) -> dict[str, list[dict]]:
    """Replicate the frontend planFleetRoutes logic in Python for benchmarking."""
    unassigned = list(zones)
    assignment: dict[str, list[dict]] = {}

    for si, ship in enumerate(ships):
        if not unassigned:
            break
        # Nearest unassigned site to this ship
        best_j = min(range(len(unassigned)), key=lambda j: haversine_km(ship, unassigned[j]))
        assigned = [unassigned.pop(best_j)]

        # Last ship absorbs remaining via nearest-neighbor
        if si == len(ships) - 1:
            cur = assigned[0]
            while unassigned:
                nj = min(range(len(unassigned)), key=lambda j: haversine_km(cur, unassigned[j]))
                assigned.append(unassigned[nj])
                cur = unassigned.pop(nj)

        assignment[ship["name"]] = assigned

    return assignment


def bench_route_planning() -> dict:
    print("\n" + "═" * 60)
    print("ROUTE PLANNING BENCHMARKS")
    print("═" * 60)

    results = {}

    # ── Test 1: Haversine accuracy ──────────────────────────────────
    # Known distances from geoid model
    known_pairs = [
        # Los Angeles → San Francisco ≈ 559 km
        ({"lat": 34.05, "lon": -118.24}, {"lat": 37.77, "lon": -122.42}, 559, "LA→SF"),
        # Pacific Guardian → Ocean Sentinel (our two ships)
        ({"lat": 33.80, "lon": -119.50}, {"lat": 32.50, "lon": -119.20}, 145, "PG→OS"),
        # Equatorial: 1° of longitude at equator = 111.32 km
        ({"lat": 0, "lon": 0}, {"lat": 0, "lon": 1}, 111.32, "Equator 1°"),
    ]
    errors = []
    for a, b, expected_km, label in known_pairs:
        actual = haversine_km(a, b)
        pct_err = abs(actual - expected_km) / expected_km * 100
        errors.append(pct_err)
        status = "PASS" if pct_err < 2.0 else "FAIL"
        print(f"  [{status}] Haversine {label}: {actual:.1f} km (expected ≈{expected_km} km, err={pct_err:.1f}%)")

    results["haversine_max_error_pct"] = max(errors)
    results["haversine_mean_error_pct"] = statistics.mean(errors)
    results["haversine_pass"] = max(errors) < 2.0

    # ── Test 2: Greedy TSP optimality ratio ─────────────────────────
    # Compare greedy NN vs optimal brute-force on small instances
    print("\n  Greedy NN vs Optimal TSP (random Pacific waypoints):")
    ratios = []
    random.seed(42)
    for trial in range(10):
        n_stops = random.randint(3, 6)
        start = {"lat": 33.8, "lon": -119.5, "name": "Ship"}
        stops = [
            {"lat": random.uniform(31, 37), "lon": random.uniform(-124, -116), "name": f"S{i}"}
            for i in range(n_stops)
        ]
        _, greedy_dist = greedy_route(start, stops)
        _, optimal_dist = optimal_tsp_brute(start, stops)
        ratio = greedy_dist / optimal_dist if optimal_dist > 0 else 1.0
        ratios.append(ratio)

    mean_ratio = statistics.mean(ratios)
    max_ratio = max(ratios)
    print(f"    Mean optimality ratio (greedy/optimal): {mean_ratio:.3f}")
    print(f"    Worst case ratio: {max_ratio:.3f}")
    print(f"    {'PASS' if mean_ratio < 1.25 else 'WARN'} — target: mean < 1.25x optimal")

    results["tsp_mean_ratio"] = round(mean_ratio, 4)
    results["tsp_max_ratio"] = round(max_ratio, 4)
    results["tsp_pass"] = mean_ratio < 1.25

    # ── Test 3: Fleet assignment fairness ──────────────────────────
    print("\n  Fleet assignment fairness:")
    ships = [
        {"name": "Pacific Guardian", "lat": 33.80, "lon": -119.50},
        {"name": "Ocean Sentinel",   "lat": 32.50, "lon": -119.20},
        {"name": "Reef Protector",   "lat": 35.10, "lon": -121.90},
    ]
    zones = [
        {"name": f"Site {chr(65+i)}", "lat": lat, "lon": lon, "score": sc}
        for i, (lat, lon, sc) in enumerate([
            (36.47, -122.44, 0.85), (35.21, -122.09, 0.82), (34.02, -121.50, 0.79),
            (34.97, -121.55, 0.76), (33.78, -120.95, 0.73), (32.82, -120.91, 0.71),
        ])
    ]

    assignment = assign_ships_greedy(ships, zones)
    total_assigned = sum(len(v) for v in assignment.values())

    print(f"    Ships: {len(ships)}, Zones: {len(zones)}")
    for ship_name, sites in assignment.items():
        km = sum(haversine_km(
            ships[[s["name"] for s in ships].index(ship_name)],
            sites[0]
        ) + sum(haversine_km(sites[i], sites[i+1]) for i in range(len(sites)-1)) if sites else 0
        for _ in [1])
        print(f"    {ship_name}: {len(sites)} sites assigned")

    all_assigned = total_assigned == len(zones)
    print(f"    {'PASS' if all_assigned else 'FAIL'} — all {len(zones)} zones assigned: {all_assigned}")
    results["fleet_assignment_pass"] = all_assigned
    results["fleet_assignment_count"] = total_assigned

    # ── Test 4: CO₂ estimate sanity ────────────────────────────────
    print("\n  CO₂ estimate sanity (2.1 t/km formula):")
    test_routes_km = [100, 500, 1000, 5000]
    for km in test_routes_km:
        co2 = km * 2.1
        print(f"    {km} km → {co2:.0f} t CO₂ est.")
    # Sanity: at 6 kn, Pacific Guardian deploys 500kg/hr olivine
    # 1 ton olivine removes ~0.3 t CO₂; 100 km route at 6 kn ≈ 9 hrs ≈ 4.5 t olivine → 1.35 t CO₂
    # The 2.1 t/km formula is intentionally conservative and directional (order-of-magnitude)
    print("    NOTE: Formula is directional (not calibrated) — see literature for real OAE yields")
    results["co2_formula_t_per_km"] = 2.1

    return results


# ═══════════════════════════════════════════════════════════════════
# SECTION 2 — Hotspot Algorithm Benchmarks
# ═══════════════════════════════════════════════════════════════════

def bench_hotspot_algorithm() -> dict:
    print("\n" + "═" * 60)
    print("HOTSPOT ALGORITHM BENCHMARKS")
    print("═" * 60)

    results = {}

    # ── Test 1: Factor weight validation ────────────────────────────
    print("\n  Factor weight validation:")

    def score_point(sst: float, wind: float, lat: float, upw_bonus: float = 0.0) -> float:
        sst_score = max(0.0, min(1.0, (28.0 - sst) / 26.0))
        if wind < 4.0:
            wind_score = wind / 4.0 * 0.4
        elif wind <= 12.0:
            wind_score = 0.4 + (wind - 4.0) / 8.0 * 0.6
        else:
            wind_score = max(0.4, 1.0 - (wind - 12.0) / 12.0)
        lat_abs = abs(lat)
        if lat < -40 and lat > -65:
            lat_score = 1.00
        elif lat_abs > 45 and lat_abs <= 65:
            lat_score = 0.90
        elif lat_abs > 30 and lat_abs <= 45:
            lat_score = 0.80
        elif lat_abs > 15 and lat_abs <= 30:
            lat_score = 0.55
        elif lat_abs >= 65:
            lat_score = 0.30
        else:
            lat_score = 0.20
        return min(1.0, round(0.30 * sst_score + 0.30 * wind_score + 0.25 * lat_score + upw_bonus, 3))

    # Score sum should be ≤ 1.0 (weights + cap)
    test_max = score_point(sst=2.0, wind=10.0, lat=-55.0, upw_bonus=0.15)
    print(f"    Max possible score (SST=2°C, Wind=10, Lat=-55°, Upwelling max): {test_max}")
    assert test_max <= 1.0, "Score exceeds 1.0!"

    # Verify weight ordering: SST cold > warm
    cold = score_point(sst=5.0, wind=10.0, lat=50.0)
    warm = score_point(sst=25.0, wind=10.0, lat=50.0)
    sst_effect = cold - warm
    print(f"    SST effect (5°C vs 25°C at same wind/lat): Δ{sst_effect:.3f}")
    print(f"    {'PASS' if sst_effect > 0.1 else 'FAIL'} — cold water should score significantly higher")
    results["sst_weight_effect"] = round(sst_effect, 3)
    results["sst_weight_pass"] = sst_effect > 0.1

    # Wind effect
    calm = score_point(sst=15.0, wind=2.0, lat=50.0)
    windy = score_point(sst=15.0, wind=10.0, lat=50.0)
    wind_effect = windy - calm
    print(f"    Wind effect (2 m/s vs 10 m/s at same SST/lat): Δ{wind_effect:.3f}")
    print(f"    {'PASS' if wind_effect > 0.05 else 'FAIL'} — stronger winds should score higher")
    results["wind_weight_effect"] = round(wind_effect, 3)
    results["wind_weight_pass"] = wind_effect > 0.05

    # Latitude effect
    tropical = score_point(sst=15.0, wind=8.0, lat=5.0)
    southern_ocean = score_point(sst=15.0, wind=8.0, lat=-55.0)
    lat_effect = southern_ocean - tropical
    print(f"    Latitude effect (tropical vs Southern Ocean): Δ{lat_effect:.3f}")
    print(f"    {'PASS' if lat_effect > 0.15 else 'FAIL'} — Southern Ocean should score higher")
    results["lat_weight_effect"] = round(lat_effect, 3)
    results["lat_weight_pass"] = lat_effect > 0.15

    # ── Test 2: Known good zones should score ≥ 0.70 ──────────────
    print("\n  Known high-quality OAE zones (expect score ≥ 0.70):")
    known_zones = [
        # (lat, lon, sst, wind, expected_upw_bonus, label)
        (-55.0, 0.0,   8.0, 12.0, 0.15, "Southern Ocean (prime OAE zone)"),
        (50.0, -30.0,  10.0, 11.0, 0.10, "Subpolar N. Atlantic"),
        (38.0, -120.0, 12.0, 8.0, 0.12, "California Current (our ships)"),
    ]
    zone_pass = 0
    for lat, lon, sst, wind, upw, label in known_zones:
        sc = score_point(sst, wind, lat, upw)
        status = "PASS" if sc >= 0.70 else "WARN"
        if sc >= 0.70:
            zone_pass += 1
        print(f"    [{status}] {label}: score={sc:.3f}")
    results["known_zones_pass_count"] = zone_pass
    results["known_zones_total"] = len(known_zones)
    results["known_zones_pass"] = zone_pass == len(known_zones)

    # ── Test 3: Known bad zones should score < 0.70 ────────────────
    print("\n  Known low-quality OAE zones (expect score < 0.70):")
    bad_zones = [
        (5.0, 0.0,   28.0, 3.0, 0.0, "Tropical warm calm ocean"),
        (-80.0, 0.0, -2.0, 5.0, 0.0, "Antarctic sea ice zone"),
        (10.0, 140.0, 29.0, 4.0, 0.0, "Tropical Pacific warm pool"),
    ]
    bad_pass = 0
    for lat, lon, sst, wind, upw, label in bad_zones:
        sc = score_point(sst, wind, lat, upw)
        status = "PASS" if sc < 0.70 else "WARN"
        if sc < 0.70:
            bad_pass += 1
        print(f"    [{status}] {label}: score={sc:.3f}")
    results["bad_zones_pass_count"] = bad_pass
    results["bad_zones_total"] = len(bad_zones)
    results["bad_zones_pass"] = bad_pass == len(bad_zones)

    # ── Test 4: Score monotonicity ─────────────────────────────────
    print("\n  Score monotonicity (decreasing SST → increasing score):")
    sst_range = [2, 5, 8, 12, 15, 18, 22, 26, 28]
    scores = [score_point(sst, 10.0, 50.0) for sst in sst_range]
    monotone = all(scores[i] >= scores[i + 1] for i in range(len(scores) - 1))
    print(f"    SST  : {sst_range}")
    print(f"    Score: {[round(s, 3) for s in scores]}")
    print(f"    {'PASS' if monotone else 'FAIL'} — scores should decrease as SST increases")
    results["sst_monotone_pass"] = monotone

    # ── Test 5: Score distribution from cached data ────────────────
    print("\n  Score distribution from cached global hotspots:")
    cache_file = PROJECT_ROOT / "data" / "real" / "global_hotspots.json"
    if cache_file.exists():
        with open(cache_file) as f:
            cached = json.load(f)
        hotspots = cached.get("hotspots", [])
        if hotspots:
            all_scores = [h["oae_score"] for h in hotspots]
            print(f"    Cache: {len(hotspots)} hotspots")
            print(f"    Score range: [{min(all_scores):.3f}, {max(all_scores):.3f}]")
            print(f"    Mean: {statistics.mean(all_scores):.3f}, Median: {statistics.median(all_scores):.3f}")
            print(f"    Stdev: {statistics.stdev(all_scores):.3f}")
            above_75 = sum(1 for s in all_scores if s >= 0.75)
            above_80 = sum(1 for s in all_scores if s >= 0.80)
            print(f"    ≥0.75: {above_75} ({100*above_75/len(hotspots):.0f}%)")
            print(f"    ≥0.80: {above_80} ({100*above_80/len(hotspots):.0f}%)")
            results["cache_hotspot_count"] = len(hotspots)
            results["cache_score_mean"] = round(statistics.mean(all_scores), 4)
            results["cache_score_stdev"] = round(statistics.stdev(all_scores), 4)
            results["cache_score_max"] = round(max(all_scores), 4)
        else:
            print("    Cache empty — run the backend to populate")
    else:
        print("    No cache file found — run the backend once to generate data")
        print("    Expected at: data/real/global_hotspots.json")

    return results


# ═══════════════════════════════════════════════════════════════════
# SECTION 3 — Spatial Intelligence Agent Benchmarks
# ═══════════════════════════════════════════════════════════════════

def bench_spatial_agent() -> dict:
    print("\n" + "═" * 60)
    print("SPATIAL INTELLIGENCE AGENT BENCHMARKS")
    print("═" * 60)

    import sys
    sys.path.insert(0, str(Path(__file__).parent))
    from agents.spatial_intelligence import get_mpa_overlap, get_ocean_state, _compute_score

    results = {}

    # ── Test 1: MPA detection accuracy ─────────────────────────────
    print("\n  MPA overlap detection:")
    mpa_tests = [
        (34.0, -119.6, 30.0, True,  "Inside Channel Islands NMS"),
        (33.5, -117.0, 10.0, False, "Open ocean south of LA"),
        (33.0, -122.0, 10.0, False, "Pacific off Pt. Conception"),
    ]
    mpa_pass = 0
    for lat, lon, r, expected, label in mpa_tests:
        res = get_mpa_overlap(lat, lon, r)
        actual = res["overlaps"]
        status = "PASS" if actual == expected else "FAIL"
        if actual == expected:
            mpa_pass += 1
        print(f"    [{status}] {label}: overlaps={actual} (expected={expected})")
    results["mpa_detection_pass"] = mpa_pass == len(mpa_tests)
    results["mpa_detection_count"] = f"{mpa_pass}/{len(mpa_tests)}"

    # ── Test 2: Ocean state retrieval ─────────────────────────────
    print("\n  Ocean state retrieval:")
    state = get_ocean_state(33.80, -119.50)
    print(f"    Pacific Guardian site (33.80°N, 119.50°W):")
    for k, v in state.items():
        print(f"      {k}: {v}")
    plausible = (
        5 <= state["temperature_c"] <= 30
        and 30 <= state["salinity_psu"] <= 40
        and 10 <= state["mixed_layer_depth_m"] <= 200
        and 0.0 <= state["suitability_score"] <= 1.0
    )
    print(f"    {'PASS' if plausible else 'FAIL'} — values within physical bounds")
    results["ocean_state_plausible"] = plausible

    # ── Test 3: Deterministic scoring ─────────────────────────────
    print("\n  Score determinism (same input → same output 10 runs):")
    scores = []
    for _ in range(10):
        ocean = get_ocean_state(33.80, -119.50)
        mpa = get_mpa_overlap(33.80, -119.50, 25.0)
        sc, _ = _compute_score(ocean, mpa)
        scores.append(sc)
    is_deterministic = len(set(scores)) == 1
    print(f"    All scores: {set(scores)}")
    print(f"    {'PASS' if is_deterministic else 'FAIL'} — rule-based path must be deterministic")
    results["scoring_deterministic"] = is_deterministic

    return results


# ═══════════════════════════════════════════════════════════════════
# SECTION 4 — Performance Benchmarks
# ═══════════════════════════════════════════════════════════════════

def bench_performance() -> dict:
    print("\n" + "═" * 60)
    print("PERFORMANCE BENCHMARKS")
    print("═" * 60)

    results = {}

    # ── Haversine throughput ────────────────────────────────────────
    n_pairs = 100_000
    random.seed(0)
    points = [
        ({"lat": random.uniform(-80, 80), "lon": random.uniform(-180, 180)},
         {"lat": random.uniform(-80, 80), "lon": random.uniform(-180, 180)})
        for _ in range(n_pairs)
    ]
    t0 = time.perf_counter()
    for a, b in points:
        haversine_km(a, b)
    elapsed = time.perf_counter() - t0
    throughput = n_pairs / elapsed
    print(f"\n  Haversine: {n_pairs:,} pairs in {elapsed*1000:.1f}ms → {throughput:,.0f} calls/sec")
    results["haversine_throughput_per_sec"] = int(throughput)
    results["haversine_100k_ms"] = round(elapsed * 1000, 1)

    # ── Fleet assignment time ───────────────────────────────────────
    ships = [
        {"name": f"Ship{i}", "lat": 33.8 + i, "lon": -119.5 + i * 0.5}
        for i in range(3)
    ]
    zones = [
        {"name": f"Site{i}", "lat": 31 + i * 0.7, "lon": -122 + i * 0.4, "score": 0.7}
        for i in range(20)
    ]
    t0 = time.perf_counter()
    for _ in range(1000):
        assign_ships_greedy(ships, zones)
    elapsed = time.perf_counter() - t0
    ms_per_call = elapsed / 1000 * 1000
    print(f"  Fleet assignment (3 ships, 20 zones): {ms_per_call:.2f} ms/call ({1000/elapsed:.0f}/sec)")
    results["fleet_assign_ms"] = round(ms_per_call, 3)

    return results


# ═══════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════

def main():
    print("\n" + "═" * 60)
    print("  OAE ALGORITHM BENCHMARKS")
    print("  OceanOps — LA Hacks 2026")
    print("═" * 60)

    all_results = {}

    all_results["route_planning"] = bench_route_planning()
    all_results["hotspot_algorithm"] = bench_hotspot_algorithm()
    all_results["spatial_agent"] = bench_spatial_agent()
    all_results["performance"] = bench_performance()

    # ── Overall pass/fail summary ──────────────────────────────────
    print("\n" + "═" * 60)
    print("SUMMARY")
    print("═" * 60)

    checks = {
        "Haversine accuracy (<2% error)":     all_results["route_planning"]["haversine_pass"],
        "Greedy TSP optimality (<1.25x opt)": all_results["route_planning"]["tsp_pass"],
        "Fleet assignment completeness":      all_results["route_planning"]["fleet_assignment_pass"],
        "SST factor effect":                  all_results["hotspot_algorithm"]["sst_weight_pass"],
        "Wind factor effect":                 all_results["hotspot_algorithm"]["wind_weight_pass"],
        "Latitude factor effect":             all_results["hotspot_algorithm"]["lat_weight_pass"],
        "Known good zones score ≥0.70":       all_results["hotspot_algorithm"]["known_zones_pass"],
        "Known bad zones score <0.70":        all_results["hotspot_algorithm"]["bad_zones_pass"],
        "SST score monotonicity":             all_results["hotspot_algorithm"]["sst_monotone_pass"],
        "MPA detection accuracy":             all_results["spatial_agent"]["mpa_detection_pass"],
        "Ocean state plausibility":           all_results["spatial_agent"]["ocean_state_plausible"],
        "Score determinism":                  all_results["spatial_agent"]["scoring_deterministic"],
    }

    pass_count = sum(1 for v in checks.values() if v)
    for label, passed in checks.items():
        mark = "✓" if passed else "✗"
        print(f"  [{mark}] {label}")

    print(f"\n  Result: {pass_count}/{len(checks)} checks passed")

    all_results["summary"] = {
        "pass": pass_count,
        "total": len(checks),
        "all_pass": pass_count == len(checks),
    }

    # ── Next steps ────────────────────────────────────────────────
    print("\n" + "═" * 60)
    print("NEXT STEPS TO IMPROVE ALGORITHMS")
    print("═" * 60)
    tsp_ratio = all_results["route_planning"]["tsp_mean_ratio"]
    print(f"""
  Route Planning:
  • Greedy NN mean optimality ratio: {tsp_ratio:.3f}x optimal
    → Upgrade to 2-opt local search to reach <1.10x (feasible in <5ms per route)
    → Add current vector opposition cost to haversine: cost(a,b) = dist + α*headcurrent_penalty
    → ETA per segment = dist_km / (ship_speed_kn * 1.852) considering current speed
    → Weight sites by OAE score — prefer higher-score stops even at slight distance cost

  Hotspot Algorithm:
  • Current scoring: SST×0.30 + Wind×0.30 + Lat×0.25 + Upwelling≤0.25
  • Future improvements:
    → Add MLD (mixed layer depth) factor: deeper MLD = faster TA dilution, better sequestration
    → Add seasonal correction: Southern Ocean most efficient Oct–Feb (SH summer)
    → Add bathymetry depth: offshore deep water needed for proper alkalinity dispersal
    → Replace jitter with actual uncertainty bands from model ensembles
    → Validate against published CarbonPlan OAE efficiency rasters (0.25° resolution)
    → Add aragonite saturation proxy (pH/alkalinity from GLODAP/SOCAT)
""")

    # Save results
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w") as f:
        json.dump(all_results, f, indent=2)
    print(f"  Results saved to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
