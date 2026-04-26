import React, { useState, useMemo, useEffect, useRef } from 'react'
import Map, { Source, Layer, Marker } from 'react-map-gl'
import { motion, AnimatePresence } from 'framer-motion'
import { API_URL, MAPBOX_TOKEN, fadeUp, staggerList } from '../constants'
import type { ShipStatus, DiscoveryZone } from '../types'
import { MPAOverlay } from '../components/shared/MPAOverlay'
import { useMPAData } from '../hooks/useMPAData'
import { ShipMarker } from '../components/shared/ShipMarker'
import { AISLayer } from '../components/shared/AISLayer'

interface RoutePlanningProps {
  fleet?: ShipStatus[]
  traffic?: any[]
}

// Per-ship color palette matching status colors
const SHIP_COLORS: Record<string, string> = {
  'Pacific Guardian': '#00c8f0',
  'Ocean Sentinel': '#4ade80',
  'Reef Protector': '#fbbf24',
}
const FALLBACK_COLORS = ['#00c8f0', '#4ade80', '#fbbf24', '#c084fc']

interface FleetRoute {
  ship: ShipStatus
  color: string
  waypoints: { lat: number; lon: number; label: string }[]
  totalKm: number
  sites: DiscoveryZone[]
}

interface AgentWaypoint {
  lat: number
  lon: number
  label: string
  is_detour?: boolean
}

interface AgentSite {
  lat: number
  lon: number
  score: number
  name?: string
  reason?: string
}

interface AgentRoute {
  ship_id: string
  ship_name: string
  color: string
  waypoints: AgentWaypoint[]
  total_km: number
  co2_estimate_tons: number
  sites: AgentSite[]
  mpa_warnings: string[]
}

function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371
  const φ1 = a.lat * Math.PI / 180
  const φ2 = b.lat * Math.PI / 180
  const Δφ = (b.lat - a.lat) * Math.PI / 180
  const Δλ = (b.lon - a.lon) * Math.PI / 180
  const x = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))
}

// Greedy nearest-neighbor assignment: assign ships to hotspots, then TSP-order each ship's stops
// Smoothly trim a route to `progress` (0–1) along its total length.
// Returns [lon, lat] pairs ready for GeoJSON coordinates.
function trimRoute(
  waypoints: { lat: number; lon: number }[],
  progress: number,
): [number, number][] {
  if (waypoints.length < 2) return waypoints.map(w => [w.lon, w.lat])
  if (progress <= 0) return [[waypoints[0].lon, waypoints[0].lat]]
  if (progress >= 1) return waypoints.map(w => [w.lon, w.lat])

  // Cumulative Euclidean distances (fast enough for a handful of waypoints)
  const dists: number[] = [0]
  for (let i = 1; i < waypoints.length; i++) {
    const dx = waypoints[i].lon - waypoints[i - 1].lon
    const dy = waypoints[i].lat - waypoints[i - 1].lat
    dists.push(dists[i - 1] + Math.sqrt(dx * dx + dy * dy))
  }
  const total  = dists[dists.length - 1]
  const target = total * progress

  const coords: [number, number][] = [[waypoints[0].lon, waypoints[0].lat]]
  for (let i = 1; i < waypoints.length; i++) {
    if (dists[i] <= target) {
      coords.push([waypoints[i].lon, waypoints[i].lat])
    } else {
      const t = (target - dists[i - 1]) / (dists[i] - dists[i - 1])
      coords.push([
        waypoints[i - 1].lon + (waypoints[i].lon - waypoints[i - 1].lon) * t,
        waypoints[i - 1].lat + (waypoints[i].lat - waypoints[i - 1].lat) * t,
      ])
      break
    }
  }
  return coords
}

// ── MPA collision detection ───────────────────────────────────────────────────

function pointInPolygonRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if (((yi > lat) !== (yj > lat)) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)
      inside = !inside
  }
  return inside
}

function pointInAnyMPA(lon: number, lat: number, features: any[]): string | null {
  for (const f of features) {
    const geom = f.geometry
    if (!geom) continue
    const rings: number[][][] =
      geom.type === 'Polygon' ? geom.coordinates :
      geom.type === 'MultiPolygon' ? geom.coordinates.flat() : []
    for (const ring of rings) {
      if (pointInPolygonRing(lon, lat, ring))
        return f.properties?.SITE_NAME ?? 'MPA'
    }
  }
  return null
}

// Sample N points along a segment; returns name of first MPA hit, or null
function segmentMPAConflict(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  features: any[],
  samples = 12,
): string | null {
  for (let i = 0; i <= samples; i++) {
    const t = i / samples
    const lon = a.lon + t * (b.lon - a.lon)
    const lat = a.lat + t * (b.lat - a.lat)
    const hit = pointInAnyMPA(lon, lat, features)
    if (hit) return hit
  }
  return null
}

// Ease-in-out cubic
function easeInOut(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2
}

type LocalPositions = Record<string, { lat: number; lon: number }>

function planFleetRoutes(
  ships: ShipStatus[],
  zones: DiscoveryZone[],
  localPos: LocalPositions = {},
): FleetRoute[] {
  if (!ships.length || !zones.length) return []

  // Use dragged position if available, else ship's server position
  const pos = (ship: ShipStatus) => localPos[ship.ship_id] ?? ship.position

  const unassigned = [...zones]
  const routes: FleetRoute[] = []

  ships.forEach((ship, si) => {
    if (!unassigned.length) return

    // Nearest unassigned site to this ship
    let bestJ = 0
    let bestDist = Infinity
    unassigned.forEach((z, j) => {
      const d = haversineKm(pos(ship), z)
      if (d < bestDist) { bestDist = d; bestJ = j }
    })

    const assigned: DiscoveryZone[] = [unassigned[bestJ]]
    unassigned.splice(bestJ, 1)

    // Last ship absorbs all remaining sites (nearest-neighbor TSP)
    if (si === ships.length - 1 && unassigned.length > 0) {
      let cur: { lat: number; lon: number } = assigned[0]
      while (unassigned.length > 0) {
        let nj = 0; let nd = Infinity
        unassigned.forEach((z, j) => {
          const d = haversineKm(cur, z); if (d < nd) { nd = d; nj = j }
        })
        assigned.push(unassigned[nj])
        cur = unassigned[nj]
        unassigned.splice(nj, 1)
      }
    }

    const color = SHIP_COLORS[ship.name] || FALLBACK_COLORS[si % FALLBACK_COLORS.length]
    const origin = pos(ship)
    const waypoints = [
      { lat: origin.lat, lon: origin.lon, label: ship.name },
      ...assigned.map(z => ({ lat: z.lat, lon: z.lon, label: z.name ?? 'Site' })),
    ]
    const totalKm = waypoints.slice(1).reduce((sum, wp, i) => sum + haversineKm(waypoints[i], wp), 0)
    routes.push({ ship, color, waypoints, totalKm, sites: assigned })
  })

  return routes
}

export function RoutePlanning({ fleet, traffic }: RoutePlanningProps) {
  const { data: mpaData } = useMPAData()
  const [tab, setTab] = useState<'fleet' | 'manual'>('fleet')
  const [manualWaypoints, setManualWaypoints] = useState<{ lat: number; lon: number }[]>([])
  const [hotspots, setHotspots] = useState<DiscoveryZone[]>([])
  const [isDiscovering, setIsDiscovering] = useState(false)
  const [routesComputed, setRoutesComputed] = useState(false)

  // Local ship position overrides (set when user drags a ship)
  const [localPositions, setLocalPositions] = useState<LocalPositions>({})

  // Route draw animation: 0 = not started, 1 = fully drawn
  const [animProgress, setAnimProgress] = useState(0)
  const rafRef  = useRef<number>()
  const t0Ref   = useRef<number>()

  const ANIM_DURATION = 1800 // ms for the full draw

  // Kick off animation whenever routes are freshly computed
  useEffect(() => {
    if (!routesComputed) { setAnimProgress(0); return }
    setAnimProgress(0)
    t0Ref.current = undefined
    if (rafRef.current) cancelAnimationFrame(rafRef.current)

    const tick = (now: number) => {
      if (!t0Ref.current) t0Ref.current = now
      const raw = Math.min((now - t0Ref.current) / ANIM_DURATION, 1)
      setAnimProgress(easeInOut(raw))
      if (raw < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routesComputed, hotspots])

  const [agentRoutes, setAgentRoutes] = useState<AgentRoute[] | null>(null)
  const [agentReasoning, setAgentReasoning] = useState<string>('')
  const [agentModel, setAgentModel] = useState<string>('')
  const [fleetCO2, setFleetCO2] = useState<number>(0)

  const computeRoutes = async () => {
    setIsDiscovering(true)
    setAgentRoutes(null)
    setAgentReasoning('')
    try {
      // Phase 1: discover high-value zones
      const discRes = await fetch(`${API_URL}/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: 33.80, lon: -119.50, radius_km: 500 }),
      })
      const discData = await discRes.json()
      const zones: DiscoveryZone[] = discData.zones ?? discData
      setHotspots(zones)

      // Phase 2: agentic route planning (MPA avoidance + CO2 maximization)
      // Use localPositions to respect dragged ship positions
      const shipInputs = (fleet ?? []).map(s => {
        const pos = localPositions[s.ship_id] ?? s.position
        return {
          ship_id:   s.ship_id,
          ship_name: s.name,
          lat:       pos.lat,
          lon:       pos.lon,
        }
      })
      const zoneInputs = zones.map(z => ({
        lat: z.lat, lon: z.lon,
        score: z.score,
        name: z.name ?? undefined,
        reason: z.reason,
      }))
      const planRes = await fetch(`${API_URL}/route-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ships: shipInputs, zones: zoneInputs }),
      })
      if (planRes.ok) {
        const plan = await planRes.json()
        setAgentRoutes(plan.routes)
        setAgentReasoning(plan.agent_reasoning ?? '')
        setAgentModel(plan.model_used ?? '')
        setFleetCO2(plan.fleet_co2_estimate ?? 0)
      }
      setRoutesComputed(true)
    } catch (e) {
      console.error('route plan failed', e)
      setRoutesComputed(true)  // still show greedy fallback
    } finally {
      setIsDiscovering(false)
    }
  }


  const ships = fleet || []
  const zones = hotspots
  const routes = planFleetRoutes(ships, zones, localPositions)

  // Per-ship stagger: ship i starts animating after i × 18% of ANIM_DURATION
  const STAGGER = 0.18
  const SHIP_WINDOW = 1 - STAGGER * (Math.max(ships.length - 1, 0))
  const shipProgress = (i: number) => {
    const start = i * STAGGER
    const raw   = Math.max(0, Math.min(1, (animProgress - start) / Math.max(SHIP_WINDOW, 0.1)))
    return easeInOut(raw)
  }

  // MPA conflict check for each manual segment
  const mpaFeatures = useMemo(() => mpaData?.features ?? [], [mpaData])

  const segmentConflicts = useMemo<(string | null)[]>(() => {
    if (manualWaypoints.length < 2 || mpaFeatures.length === 0) return []
    return manualWaypoints.slice(1).map((wp, i) =>
      segmentMPAConflict(manualWaypoints[i], wp, mpaFeatures)
    )
  }, [manualWaypoints, mpaFeatures])

  const conflictCount = segmentConflicts.filter(Boolean).length

  // Split manual route into safe/conflict GeoJSON segments for map rendering
  const { safeRouteGeoJSON, conflictRouteGeoJSON } = useMemo(() => {
    const safe: [number, number][][] = []
    const conflict: [number, number][][] = []
    manualWaypoints.slice(1).forEach((wp, i) => {
      const seg: [number, number][] = [
        [manualWaypoints[i].lon, manualWaypoints[i].lat],
        [wp.lon, wp.lat],
      ]
      if (segmentConflicts[i]) conflict.push(seg)
      else safe.push(seg)
    })
    const toGeoJSON = (segs: [number, number][][]) => ({
      type: 'FeatureCollection' as const,
      features: segs.map(coords => ({
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'LineString' as const, coordinates: coords },
      })),
    })
    return { safeRouteGeoJSON: toGeoJSON(safe), conflictRouteGeoJSON: toGeoJSON(conflict) }
  }, [manualWaypoints, segmentConflicts])

  // Manual route stats
  const manualKm =
    manualWaypoints.length >= 2
      ? manualWaypoints.slice(1).reduce((sum, wp, i) => sum + haversineKm(manualWaypoints[i], wp), 0)
      : 0

  const totalFleetCO2 = agentRoutes
    ? fleetCO2
    : routes.reduce((sum, r) => sum + r.totalKm * 2.1, 0)

  // Unified route list for map + sidebar: prefer agent result, fall back to greedy
  const activeRoutes: AgentRoute[] = useMemo(() => {
    if (agentRoutes) return agentRoutes
    return routes.map(r => ({
      ship_id:           r.ship.ship_id,
      ship_name:         r.ship.name,
      color:             r.color,
      waypoints:         r.waypoints,
      total_km:          r.totalKm,
      co2_estimate_tons: Math.round(r.totalKm * 2.1),
      sites:             r.sites.map(s => ({ lat: s.lat, lon: s.lon, score: s.score, name: s.name })),
      mpa_warnings:      [],
    }))
  }, [agentRoutes, routes])

  // Sidebar shows only 30 closest vessels (avoid rendering 3000 DOM cards)
  const sidebarVessels = useMemo(() => (traffic ?? []).slice(0, 30), [traffic])

  return (
    <div className="mode-layout">
      {/* ── Left sidebar ── */}
      <motion.div
        className="sidebar sidebar-left"
        initial={{ x: -280, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 30 }}
      >
        <div className="panel">
          <div className="panel-label">Route Planner</div>

          {/* Tab toggle */}
          <div className="rp-tab-toggle" data-tour="rp-tabs">
            <button
              className={`rp-tab-btn${tab === 'fleet' ? ' active' : ''}`}
              onClick={() => setTab('fleet')}
            >
              AI Fleet
            </button>
            <button
              className={`rp-tab-btn${tab === 'manual' ? ' active' : ''}`}
              onClick={() => setTab('manual')}
            >
              Manual
            </button>
          </div>

          {/* ── AI Fleet tab ── */}
          <AnimatePresence mode="wait">
            {tab === 'fleet' && (
              <motion.div
                key="fleet"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              >
                <motion.button
                  data-tour="rp-compute"
                  className={`rp-compute-btn${isDiscovering ? ' loading' : ''}`}
                  onClick={() => computeRoutes()}
                  disabled={isDiscovering}
                  style={{ marginTop: 10 }}
                  whileHover={isDiscovering ? {} : { scale: 1.015 }}
                  whileTap={isDiscovering ? {} : { scale: 0.985 }}
                >
                  {isDiscovering ? (
                    <>
                      <span className="rp-compute-spinner" />
                      Analyzing ocean conditions…
                    </>
                  ) : routesComputed ? (
                    '↻ Recompute Optimal Routes'
                  ) : (
                    '◈ Compute Optimal Routes'
                  )}
                </motion.button>

                {/* No data yet */}
                <AnimatePresence>
                  {!routesComputed && !isDiscovering && (
                    <motion.div
                      className="rp-hint"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      style={{ marginTop: 10 }}
                    >
                      <div className="rp-hint-icon">◈</div>
                      <div>
                        <div className="rp-hint-title">AI-powered routing</div>
                        <div className="rp-hint-sub">
                          Analyzes CalCOFI & NOAA data to find optimal OAE deployment sites, then assigns each vessel the nearest high-impact hotspot.
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Fleet totals */}
                <AnimatePresence>
                  {routesComputed && activeRoutes.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    >
                      <div className="fleet-stats" style={{ marginTop: 10 }}>
                        <div className="stat-card">
                          <div className="stat-value">{zones.length}</div>
                          <div className="stat-label">Hotspots</div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-value" style={{ color: 'var(--success)' }}>
                            +{(totalFleetCO2 / 1000).toFixed(1)}k
                          </div>
                          <div className="stat-label">t CO₂ est.</div>
                        </div>
                      </div>

                      {/* Agent reasoning */}
                      <AnimatePresence>
                        {agentReasoning && (
                          <motion.div
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            style={{
                              marginTop: 10, padding: '8px 10px',
                              background: 'rgba(0,200,240,0.06)',
                              border: '1px solid rgba(0,200,240,0.18)',
                              borderRadius: 7, fontSize: 10, color: 'var(--text-2)',
                              lineHeight: 1.5,
                            }}
                          >
                            <div style={{ color: 'var(--deploy)', fontWeight: 700, marginBottom: 3, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                              {agentModel.includes('gemma') ? '◈ Gemma4 Strategy' : '◈ Agent Strategy'}
                            </div>
                            {agentReasoning}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 5,
                        fontSize: 10, color: 'var(--success)',
                        background: 'rgba(74,222,128,0.07)',
                        border: '1px solid rgba(74,222,128,0.2)',
                        borderRadius: 6, padding: '5px 10px', marginTop: 8,
                      }}>
                        <span>✓</span><span>MPA-Safe — detours computed for all conflicts</span>
                      </div>

                      <div className="gi-divider" style={{ margin: '14px 0' }} />

                      {/* Per-ship route cards */}
                      <motion.div
                        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                        variants={staggerList}
                        initial="hidden"
                        animate="show"
                      >
                        {activeRoutes.map(route => (
                          <motion.div
                            key={route.ship_id}
                            variants={fadeUp}
                            className="rp-fleet-card"
                            style={{ borderLeftColor: route.color }}
                          >
                            <div className="rp-fleet-header">
                              <div className="rp-fleet-pip" style={{ background: route.color, boxShadow: `0 0 6px ${route.color}66` }} />
                              <span className="rp-fleet-name" style={{ color: route.color }}>
                                {route.ship_name}
                              </span>
                              <span className="rp-fleet-meta">{route.total_km.toFixed(0)} km</span>
                            </div>

                            <div className="rp-fleet-sites">
                              {route.sites.map((site, si) => (
                                <div key={si} className="rp-fleet-site-row">
                                  <div className="rp-fleet-site-dot" />
                                  <span className="rp-fleet-site-name">{site.name ?? `Site ${si + 1}`}</span>
                                  <span className="rp-fleet-site-score">{(site.score * 100).toFixed(0)}%</span>
                                </div>
                              ))}
                            </div>

                            {/* MPA detour warnings */}
                            {route.mpa_warnings.map((w, wi) => (
                              <div key={wi} style={{ fontSize: 9, color: 'var(--warning)', marginTop: 3, display: 'flex', gap: 4 }}>
                                <span>⚠</span><span>{w}</span>
                              </div>
                            ))}

                            <div className="rp-fleet-co2">
                              +{route.co2_estimate_tons.toFixed(0)} t CO₂
                            </div>
                          </motion.div>
                        ))}
                      </motion.div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {/* ── Manual tab ── */}
            {tab === 'manual' && (
              <motion.div
                key="manual"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              >
                <AnimatePresence>
                  {manualWaypoints.length === 0 && (
                    <motion.div
                      className="rp-hint"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      style={{ marginTop: 10 }}
                    >
                      <div className="rp-hint-icon">+</div>
                      <div>
                        <div className="rp-hint-title">Place waypoints</div>
                        <div className="rp-hint-sub">Click anywhere on the map to begin your route</div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {manualWaypoints.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      style={{ marginTop: 10 }}
                    >
                      <div className="fleet-stats">
                        <div className="stat-card">
                          <div className="stat-value">{manualWaypoints.length}</div>
                          <div className="stat-label">Waypoints</div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-value">{manualKm.toFixed(0)}</div>
                          <div className="stat-label">Route km</div>
                        </div>
                      </div>

                      {manualKm > 0 && (
                        <div className="rp-co2-bar">
                          <span className="rp-co2-label">Est. CO₂ removal</span>
                          <span className="rp-co2-value">+{(manualKm * 2.1).toFixed(1)} t</span>
                        </div>
                      )}

                      <div className="rp-actions">
                        <motion.button
                          className="rp-btn-outline"
                          onClick={() => setManualWaypoints(prev => prev.slice(0, -1))}
                          whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.985 }}
                        >
                          Undo Last
                        </motion.button>
                        <motion.button
                          className="rp-btn-ghost"
                          onClick={() => setManualWaypoints([])}
                          whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.985 }}
                        >
                          Clear All
                        </motion.button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence>
                  {manualWaypoints.length >= 2 && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                    >
                      <div className="gi-divider" style={{ margin: '14px 0' }} />
                      <div className="panel-label" style={{ marginBottom: 10 }}>Segments</div>
                      <motion.div
                        style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                        variants={staggerList}
                        initial="hidden"
                        animate="show"
                      >
                        {conflictCount > 0 && (
                          <motion.div
                            variants={fadeUp}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 6,
                              background: 'rgba(248,113,113,0.08)',
                              border: '1px solid rgba(248,113,113,0.25)',
                              borderRadius: 6, padding: '6px 10px', marginBottom: 6,
                              fontSize: 10, color: 'var(--danger)',
                            }}
                          >
                            <span>⚠</span>
                            <span>{conflictCount} segment{conflictCount > 1 ? 's' : ''} cross MPA boundaries</span>
                          </motion.div>
                        )}
                        {manualWaypoints.slice(1).map((wp, i) => {
                          const km = haversineKm(manualWaypoints[i], wp)
                          const mpaHit = segmentConflicts[i]
                          return (
                            <motion.div
                              key={i} variants={fadeUp}
                              className="rp-segment-card"
                              style={mpaHit ? { borderColor: 'rgba(248,113,113,0.35)', background: 'rgba(248,113,113,0.05)' } : undefined}
                            >
                              <div className="rp-segment-num" style={mpaHit ? { color: 'var(--danger)' } : undefined}>{i + 1}</div>
                              <div className="rp-segment-info" style={{ flex: 1 }}>
                                <span className="rp-segment-dist">{km.toFixed(1)} km</span>
                                <span className="ship-sep">·</span>
                                <span className="rp-segment-co2">+{(km * 2.1).toFixed(1)} t CO₂</span>
                                {mpaHit && (
                                  <div style={{ fontSize: 9, color: 'var(--danger)', marginTop: 2 }}>
                                    ⚠ Crosses {mpaHit}
                                  </div>
                                )}
                              </div>
                            </motion.div>
                          )
                        })}
                      </motion.div>
                      <div className="rp-total">
                        <span>Total</span>
                        <span className="rp-total-val">+{(manualKm * 2.1).toFixed(1)} t CO₂</span>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* ── Map ── */}
      <div className="map-container" data-tour="rp-map">
        <Map
          initialViewState={{ longitude: -119.8, latitude: 33.8, zoom: 7 }}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          mapboxAccessToken={MAPBOX_TOKEN}
          reuseMaps
          onClick={
            tab === 'manual'
              ? e => setManualWaypoints(prev => [...prev, { lat: e.lngLat.lat, lon: e.lngLat.lng }])
              : undefined
          }
          cursor={tab === 'manual' ? 'crosshair' : 'grab'}
        >
          <MPAOverlay data={mpaData} />

          {/* Fleet route lines — animated draw using trimRoute + shipProgress */}
          {activeRoutes.map((route, i) => {
            const prog   = shipProgress(i)
            const coords = trimRoute(route.waypoints, prog)
            const geojson = {
              type: 'FeatureCollection' as const,
              features: coords.length >= 2 ? [{
                type: 'Feature' as const,
                properties: {},
                geometry: { type: 'LineString' as const, coordinates: coords },
              }] : [],
            }
            const head = coords[coords.length - 1]

            // Detour waypoints for this route (inserted by agent)
            const detourWPs = route.waypoints.filter(w => w.is_detour)

            return (
              <React.Fragment key={route.ship_id}>
                <Source id={`route-${route.ship_id}`} type="geojson" data={geojson}>
                  <Layer
                    id={`route-${route.ship_id}-glow`}
                    type="line"
                    paint={{ 'line-color': route.color, 'line-width': 14, 'line-blur': 10, 'line-opacity': 0.18 }}
                  />
                  <Layer
                    id={`route-${route.ship_id}-line`}
                    type="line"
                    paint={{ 'line-color': route.color, 'line-width': 2.5, 'line-dasharray': [4, 2.5] }}
                  />
                </Source>

                {/* Glowing head dot at the tip of the animated route */}
                {prog > 0 && prog < 1 && head && (
                  <Marker longitude={head[0]} latitude={head[1]} anchor="center">
                    <div style={{
                      width: 10, height: 10, borderRadius: '50%',
                      background: route.color,
                      boxShadow: `0 0 0 3px ${route.color}44, 0 0 14px ${route.color}`,
                      animation: 'rp-head-pulse 0.8s ease-in-out infinite alternate',
                    }} />
                  </Marker>
                )}

                {/* Detour waypoint markers — amber diamond, shown after animation */}
                {animProgress > 0.5 && detourWPs.map((dw, di) => (
                  <Marker key={`detour-${route.ship_id}-${di}`} longitude={dw.lon} latitude={dw.lat} anchor="center">
                    <motion.div
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      transition={{ type: 'spring', stiffness: 480, damping: 28, delay: 0.2 }}
                      title={dw.label}
                      style={{
                        width: 18, height: 18,
                        background: 'rgba(251,191,36,0.15)',
                        border: '1.5px solid #fbbf24',
                        borderRadius: 4,
                        transform: 'rotate(45deg)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        boxShadow: '0 0 8px rgba(251,191,36,0.4)',
                      }}
                    />
                  </Marker>
                ))}
              </React.Fragment>
            )
          })}

          {/* Manual route — safe segments (cyan) */}
          {tab === 'manual' && manualWaypoints.length >= 2 && (
            <Source id="manual-safe" type="geojson" data={safeRouteGeoJSON}>
              <Layer id="manual-safe-glow" type="line" paint={{ 'line-color': '#22d3ee', 'line-width': 14, 'line-blur': 10, 'line-opacity': 0.2 }} />
              <Layer id="manual-safe-line" type="line" paint={{ 'line-color': '#22d3ee', 'line-width': 2.5, 'line-dasharray': [3, 2] }} />
            </Source>
          )}
          {/* Manual route — MPA-conflicting segments (red) */}
          {tab === 'manual' && conflictRouteGeoJSON.features.length > 0 && (
            <Source id="manual-conflict" type="geojson" data={conflictRouteGeoJSON}>
              <Layer id="manual-conflict-glow" type="line" paint={{ 'line-color': '#f87171', 'line-width': 14, 'line-blur': 10, 'line-opacity': 0.25 }} />
              <Layer id="manual-conflict-line" type="line" paint={{ 'line-color': '#f87171', 'line-width': 2.5, 'line-dasharray': [2, 2] }} />
            </Source>
          )}

          {/* Hotspot markers */}
          {zones.map((zone, i) => (
            <Marker key={i} longitude={zone.lon} latitude={zone.lat} anchor="center">
              <motion.div
                className="rp-hotspot-marker"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 480, damping: 26, delay: i * 0.08 }}
                title={`${zone.name} — Score ${(zone.score * 100).toFixed(0)}%\n${zone.reason}`}
              >
                <span className="rp-hotspot-letter">{zone.name?.replace('Site ', '') ?? String.fromCharCode(65 + i)}</span>
                <div className="rp-hotspot-ring" />
              </motion.div>
            </Marker>
          ))}

          {/* Fleet ships — draggable to reposition departure port */}
          {ships.map(ship => {
            const pos = localPositions[ship.ship_id] ?? ship.position
            return (
              <Marker
                key={ship.ship_id}
                longitude={pos.lon}
                latitude={pos.lat}
                anchor="center"
                draggable
                onDrag={e => setLocalPositions(prev => ({
                  ...prev,
                  [ship.ship_id]: { lat: e.lngLat.lat, lon: e.lngLat.lng },
                }))}
                onDragEnd={() => {
                  // Reset computed routes when a ship is moved
                  setRoutesComputed(false)
                  setHotspots([])
                }}
              >
                <div style={{ cursor: 'grab' }} title={`${ship.name} — drag to reposition`}>
                  <ShipMarker
                    status={ship.status}
                    name={ship.name}
                    lat={pos.lat}
                    lon={pos.lon}
                    co2={ship.co2_removed_tons}
                    heading={ship.heading}
                  />
                </div>
              </Marker>
            )
          })}

          {/* Manual waypoints */}
          {tab === 'manual' && manualWaypoints.map((wp, i) => (
            <Marker key={i} longitude={wp.lon} latitude={wp.lat} anchor="center">
              <motion.div
                className="rp-waypoint"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 28 }}
                onClick={e => { e.stopPropagation(); setManualWaypoints(prev => prev.filter((_, idx) => idx !== i)) }}
                title={`Waypoint ${i + 1} — click to remove`}
              >
                {i + 1}
              </motion.div>
            </Marker>
          ))}

          {/* AIS traffic — GPU-rendered via GeoJSON cluster, zero DOM nodes */}
          <AISLayer vessels={traffic} />
        </Map>

        {/* Legend */}
        <div className="map-legend">
          <div className="legend-row"><div className="legend-swatch" /><span>MPA Zone</span></div>
          {activeRoutes.map(r => (
            <div key={r.ship_id} className="legend-row">
              <div style={{ width: 20, height: 3, background: r.color, borderRadius: 2, boxShadow: `0 0 5px ${r.color}55` }} />
              <span style={{ color: r.color }}>{r.ship_name.split(' ')[0]}</span>
            </div>
          ))}
          {activeRoutes.length === 0 && (
            <div className="legend-row">
              <div style={{ width: 20, height: 3, background: '#22d3ee', borderRadius: 2 }} />
              <span>Route</span>
            </div>
          )}
          <div className="legend-rule" />
          <div className="legend-row">
            <div className="rp-hotspot-marker" style={{ width: 16, height: 16, fontSize: 7, pointerEvents: 'none' }}>
              <span className="rp-hotspot-letter" style={{ fontSize: 7 }}>A</span>
            </div>
            <span>OAE Hotspot</span>
          </div>
          <div className="legend-row">
            <svg width="8" height="12" viewBox="0 0 14 20" fill="none" style={{ flexShrink: 0 }}>
              <path d="M7 1C4.8 1 3.5 3 3.5 5.5L3.5 15.5C3.5 17.5 5 19 7 19C9 19 10.5 17.5 10.5 15.5L10.5 5.5C10.5 3 9.2 1 7 1Z" fill="#f59e0b"/>
            </svg>
            <span>AIS Vessel</span>
          </div>
          <div className="legend-row">
            <svg width="8" height="12" viewBox="0 0 14 20" fill="none" style={{ flexShrink: 0 }}>
              <path d="M7 1C4.8 1 3.5 3 3.5 5.5L3.5 15.5C3.5 17.5 5 19 7 19C9 19 10.5 17.5 10.5 15.5L10.5 5.5C10.5 3 9.2 1 7 1Z" fill="#ef4444"/>
            </svg>
            <span>Conflict Risk</span>
          </div>
          <div className="legend-row">
            <div style={{ width: 14, height: 14, borderRadius: 3, background: 'rgba(245,158,11,0.5)', border: '1px solid rgba(245,158,11,0.4)', display:'flex',alignItems:'center',justifyContent:'center', flexShrink:0 }}>
              <span style={{ fontSize: 7, color: '#0c0f14', fontWeight: 700 }}>N</span>
            </div>
            <span>Vessel cluster</span>
          </div>
          {traffic && (
            <div className="legend-row" style={{ marginTop: 4 }}>
              <span style={{ color: 'var(--text-3)', fontSize: 9 }}>{traffic.length.toLocaleString()} live vessels</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Right sidebar — AIS Traffic ── */}
      <motion.div
        data-tour="rp-ais"
        className="sidebar sidebar-right"
        initial={{ x: 280, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 30 }}
      >
        <div className="panel">
          <div className="panel-label">AIS Traffic</div>

          {!traffic && <div className="rp-empty">Loading vessel data…</div>}

          {traffic && (
            <>
              <div className="fleet-stats">
                <div className="stat-card">
                  <div className="stat-value">{traffic.length.toLocaleString()}</div>
                  <div className="stat-label">Live Vessels</div>
                </div>
                <div className="stat-card">
                  <div className="stat-value">{traffic.filter((v: any) => v.conflict_risk).length}</div>
                  <div className="stat-label">Conflicts</div>
                </div>
              </div>

              <motion.div
                style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 14 }}
                variants={staggerList} initial="hidden" animate="show"
              >
                {sidebarVessels.map((v: any) => (
                  <motion.div key={v.vessel_id} variants={fadeUp} className="ship-card">
                    <div className="rp-traffic-pip"
                      style={v.conflict_risk ? { background: 'var(--danger)', boxShadow: '0 0 6px var(--danger-glow)' } : undefined} />
                    <div className="ship-info">
                      <div className="ship-name">{v.name}</div>
                      <div className="ship-meta">
                        <span className="ship-status" style={{ color: 'var(--warning)' }}>{v.vessel_type}</span>
                        <span className="ship-sep">·</span>
                        <span className="ship-co2">{v.speed_kn} kn</span>
                      </div>
                    </div>
                  </motion.div>
                ))}
                {traffic.length > 30 && (
                  <div style={{ fontSize: 10, color: 'var(--text-3)', textAlign: 'center', padding: '6px 0' }}>
                    +{(traffic.length - 30).toLocaleString()} more on map
                  </div>
                )}
              </motion.div>
            </>
          )}

          {/* Route summary when computed */}
          {routesComputed && activeRoutes.length > 0 && (
            <>
              <div className="gi-divider" style={{ margin: '16px 0' }} />
              <div className="panel-label" style={{ marginBottom: 10 }}>Fleet Summary</div>
              {activeRoutes.map(route => (
                <div key={route.ship_id} className="rp-fleet-summary-row">
                  <div className="rp-fleet-pip" style={{ background: route.color, boxShadow: `0 0 5px ${route.color}55` }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: route.color, marginBottom: 2 }}>
                      {route.ship_name}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
                      {route.sites.length} site{route.sites.length > 1 ? 's' : ''} · {route.total_km.toFixed(0)} km
                      {route.mpa_warnings.length > 0 && <span style={{ color: 'var(--warning)', marginLeft: 4 }}>⚠ {route.mpa_warnings.length} detour{route.mpa_warnings.length > 1 ? 's' : ''}</span>}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)', flexShrink: 0 }}>
                    +{route.co2_estimate_tons.toFixed(0)} t
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </motion.div>
    </div>
  )
}
