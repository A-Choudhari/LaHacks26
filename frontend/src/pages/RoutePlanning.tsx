import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import Map, { Source, Layer, Marker } from 'react-map-gl'
import { motion, AnimatePresence } from 'framer-motion'
import { API_URL, MAPBOX_TOKEN, fadeUp, staggerList } from '../constants'
import type { ShipStatus, DiscoveryZone } from '../types'
import { MPAOverlay } from '../components/shared/MPAOverlay'
import { ShipMarker } from '../components/shared/ShipMarker'

interface RoutePlanningProps {
  fleet?: ShipStatus[]
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
function planFleetRoutes(ships: ShipStatus[], zones: DiscoveryZone[]): FleetRoute[] {
  if (!ships.length || !zones.length) return []

  const unassigned = [...zones]
  const routes: FleetRoute[] = []

  ships.forEach((ship, si) => {
    if (!unassigned.length) return

    // Nearest unassigned site to this ship
    let bestJ = 0
    let bestDist = Infinity
    unassigned.forEach((z, j) => {
      const d = haversineKm(ship.position, z)
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
    const waypoints = [
      { lat: ship.position.lat, lon: ship.position.lon, label: ship.name },
      ...assigned.map(z => ({ lat: z.lat, lon: z.lon, label: z.name ?? 'Site' })),
    ]
    const totalKm = waypoints.slice(1).reduce((sum, wp, i) => sum + haversineKm(waypoints[i], wp), 0)
    routes.push({ ship, color, waypoints, totalKm, sites: assigned })
  })

  return routes
}

export function RoutePlanning({ fleet }: RoutePlanningProps) {
  const [tab, setTab] = useState<'fleet' | 'manual'>('fleet')
  const [manualWaypoints, setManualWaypoints] = useState<{ lat: number; lon: number }[]>([])
  const [hotspots, setHotspots] = useState<DiscoveryZone[]>([])
  const [isDiscovering, setIsDiscovering] = useState(false)
  const [routesComputed, setRoutesComputed] = useState(false)

  const computeRoutes = async () => {
    setIsDiscovering(true)
    try {
      const res = await fetch(`${API_URL}/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: 33.80, lon: -119.50, radius_km: 500 }),
      })
      const data = await res.json()
      const zones: DiscoveryZone[] = data.zones ?? data
      setHotspots(zones)
      setRoutesComputed(true)
    } catch (e) {
      console.error('discover failed', e)
    } finally {
      setIsDiscovering(false)
    }
  }

  const { data: traffic } = useQuery<any[]>({
    queryKey: ['traffic'],
    queryFn: () => fetch(`${API_URL}/traffic`).then(r => r.json()),
    retry: 1,
    refetchInterval: 30000,  // refresh every 30s, not constantly
    staleTime: 20000,
  })

  const ships = fleet || []
  const zones = hotspots
  const routes = planFleetRoutes(ships, zones)

  // Manual route stats
  const manualKm =
    manualWaypoints.length >= 2
      ? manualWaypoints.slice(1).reduce((sum, wp, i) => sum + haversineKm(manualWaypoints[i], wp), 0)
      : 0

  const totalFleetCO2 = routes.reduce((sum, r) => sum + r.totalKm * 2.1, 0)

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
                  {routesComputed && routes.length > 0 && (
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

                      <div className="gi-divider" style={{ margin: '14px 0' }} />

                      {/* Per-ship route cards */}
                      <motion.div
                        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                        variants={staggerList}
                        initial="hidden"
                        animate="show"
                      >
                        {routes.map(route => (
                          <motion.div
                            key={route.ship.ship_id}
                            variants={fadeUp}
                            className="rp-fleet-card"
                            style={{ borderLeftColor: route.color }}
                          >
                            {/* Ship name + color */}
                            <div className="rp-fleet-header">
                              <div className="rp-fleet-pip" style={{ background: route.color, boxShadow: `0 0 6px ${route.color}66` }} />
                              <span className="rp-fleet-name" style={{ color: route.color }}>
                                {route.ship.name}
                              </span>
                              <span className="rp-fleet-meta">
                                {route.totalKm.toFixed(0)} km
                              </span>
                            </div>

                            {/* Hotspot list */}
                            <div className="rp-fleet-sites">
                              {route.sites.map((site, si) => (
                                <div key={si} className="rp-fleet-site-row">
                                  <div className="rp-fleet-site-dot" />
                                  <span className="rp-fleet-site-name">{site.name ?? `Site ${si + 1}`}</span>
                                  <span className="rp-fleet-site-score">
                                    {(site.score * 100).toFixed(0)}%
                                  </span>
                                </div>
                              ))}
                            </div>

                            {/* CO₂ estimate */}
                            <div className="rp-fleet-co2">
                              +{(route.totalKm * 2.1).toFixed(0)} t CO₂
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
                        {manualWaypoints.slice(1).map((wp, i) => {
                          const km = haversineKm(manualWaypoints[i], wp)
                          return (
                            <motion.div key={i} variants={fadeUp} className="rp-segment-card">
                              <div className="rp-segment-num">{i + 1}</div>
                              <div className="rp-segment-info">
                                <span className="rp-segment-dist">{km.toFixed(1)} km</span>
                                <span className="ship-sep">·</span>
                                <span className="rp-segment-co2">+{(km * 2.1).toFixed(1)} t CO₂</span>
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
          <MPAOverlay />

          {/* Fleet route lines — one per ship */}
          {routes.map(route => {
            const geojson = {
              type: 'FeatureCollection' as const,
              features: [{
                type: 'Feature' as const,
                properties: {},
                geometry: {
                  type: 'LineString' as const,
                  coordinates: route.waypoints.map(w => [w.lon, w.lat]),
                },
              }],
            }
            return (
              <Source key={route.ship.ship_id} id={`route-${route.ship.ship_id}`} type="geojson" data={geojson}>
                <Layer
                  id={`route-${route.ship.ship_id}-glow`}
                  type="line"
                  paint={{ 'line-color': route.color, 'line-width': 12, 'line-blur': 10, 'line-opacity': 0.18 }}
                />
                <Layer
                  id={`route-${route.ship.ship_id}-line`}
                  type="line"
                  paint={{ 'line-color': route.color, 'line-width': 2.5, 'line-dasharray': [4, 2.5] }}
                />
              </Source>
            )
          })}

          {/* Manual route line */}
          {tab === 'manual' && manualWaypoints.length >= 2 && (
            <Source
              id="manual-route"
              type="geojson"
              data={{
                type: 'FeatureCollection' as const,
                features: [{
                  type: 'Feature' as const,
                  properties: {},
                  geometry: { type: 'LineString' as const, coordinates: manualWaypoints.map(w => [w.lon, w.lat]) },
                }],
              }}
            >
              <Layer id="manual-glow" type="line" paint={{ 'line-color': '#22d3ee', 'line-width': 14, 'line-blur': 10, 'line-opacity': 0.2 }} />
              <Layer id="manual-line" type="line" paint={{ 'line-color': '#22d3ee', 'line-width': 2.5, 'line-dasharray': [3, 2] }} />
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

          {/* Fleet ships */}
          {ships.map(ship => (
            <Marker key={ship.ship_id} longitude={ship.position.lon} latitude={ship.position.lat} anchor="center">
              <ShipMarker
                status={ship.status}
                name={ship.name}
                lat={ship.position.lat}
                lon={ship.position.lon}
                co2={ship.co2_removed_tons}
                heading={ship.heading}
              />
            </Marker>
          ))}

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

          {/* AIS traffic */}
          {traffic?.map((v: any) => (
            <Marker key={v.vessel_id} longitude={v.lon} latitude={v.lat} anchor="center">
              <div className="rp-traffic-marker" title={`${v.name} · ${v.vessel_type} · ${v.speed_kn} kn`}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M7 1 L13 13 L7 10 L1 13 Z" fill="#f59e0b" fillOpacity="0.9" />
                </svg>
              </div>
            </Marker>
          ))}
        </Map>

        {/* Legend */}
        <div className="map-legend">
          <div className="legend-row"><div className="legend-swatch" /><span>MPA Zone</span></div>
          {routes.map(r => (
            <div key={r.ship.ship_id} className="legend-row">
              <div style={{ width: 20, height: 3, background: r.color, borderRadius: 2, boxShadow: `0 0 5px ${r.color}55` }} />
              <span style={{ color: r.color }}>{r.ship.name.split(' ')[0]}</span>
            </div>
          ))}
          {routes.length === 0 && (
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
            <svg width="10" height="10" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
              <path d="M7 1 L13 13 L7 10 L1 13 Z" fill="#f59e0b" />
            </svg>
            <span>AIS Vessel</span>
          </div>
          <div className="legend-row">
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444', flexShrink: 0 }} />
            <span>Conflict Risk</span>
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
          {routesComputed && routes.length > 0 && (
            <>
              <div className="gi-divider" style={{ margin: '16px 0' }} />
              <div className="panel-label" style={{ marginBottom: 10 }}>Fleet Summary</div>
              {routes.map(route => (
                <div key={route.ship.ship_id} className="rp-fleet-summary-row">
                  <div className="rp-fleet-pip" style={{ background: route.color, boxShadow: `0 0 5px ${route.color}55` }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: route.color, marginBottom: 2 }}>
                      {route.ship.name}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
                      {route.sites.length} site{route.sites.length > 1 ? 's' : ''} · {route.totalKm.toFixed(0)} km
                    </div>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--success)', flexShrink: 0 }}>
                    +{(route.totalKm * 2.1).toFixed(0)} t
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
