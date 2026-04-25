import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import Map, { Source, Layer, Marker } from 'react-map-gl'
import { motion, AnimatePresence } from 'framer-motion'
import { API_URL, MAPBOX_TOKEN, fadeUp, staggerList } from '../constants'
import type { ShipStatus } from '../types'
import { MPAOverlay } from '../components/shared/MPAOverlay'
import { ShipMarker } from '../components/shared/ShipMarker'

interface RoutePlanningProps {
  fleet?: ShipStatus[]
}

const ROUTE_COLOR = '#22d3ee'

function segmentKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  return Math.sqrt(
    ((b.lat - a.lat) * 111.32) ** 2 +
    ((b.lon - a.lon) * 111.32 * Math.cos(a.lat * Math.PI / 180)) ** 2
  )
}

export function RoutePlanning({ fleet }: RoutePlanningProps) {
  const [waypoints, setWaypoints] = useState<{ lat: number; lon: number }[]>([])

  const { data: traffic } = useQuery<any[]>({
    queryKey: ['traffic'],
    queryFn: () => fetch(`${API_URL}/traffic`).then(r => r.json()),
    retry: 1,
    refetchInterval: 30000,  // refresh every 30s, not constantly
    staleTime: 20000,
  })

  // Convert vessels to GeoJSON once — GPU-rendered, handles 3000+ ships with zero lag
  const trafficGeoJSON = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: (traffic ?? []).map((v: any) => ({
      type: 'Feature' as const,
      properties: {
        name:        v.name,
        vessel_type: v.vessel_type,
        speed_kn:    v.speed_kn,
        conflict:    v.conflict_risk,
      },
      geometry: { type: 'Point' as const, coordinates: [v.lon, v.lat] },
    })),
  }), [traffic])

  const routeGeoJSON = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: waypoints.length >= 2 ? [{
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: waypoints.map(w => [w.lon, w.lat]) },
    }] : [],
  }), [waypoints])

  const routeKm = waypoints.length >= 2
    ? waypoints.slice(1).reduce((total, wp, i) => total + segmentKm(waypoints[i], wp), 0)
    : 0

  const totalCO2 = (routeKm * 0.8).toFixed(1)

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
          <div className="panel-label">Route Planning</div>

          <AnimatePresence>
            {waypoints.length === 0 && (
              <motion.div
                className="rp-hint"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ type: 'spring', stiffness: 380, damping: 30 }}
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
            {waypoints.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              >
                <div className="fleet-stats">
                  <div className="stat-card">
                    <div className="stat-value">{waypoints.length}</div>
                    <div className="stat-label">Waypoints</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value">{routeKm.toFixed(0)}</div>
                    <div className="stat-label">Route km</div>
                  </div>
                </div>

                {routeKm > 0 && (
                  <div className="rp-co2-bar">
                    <span className="rp-co2-label">Est. CO₂ removal</span>
                    <span className="rp-co2-value">+{totalCO2} t</span>
                  </div>
                )}

                <div className="rp-actions">
                  <motion.button
                    className="rp-btn-outline"
                    onClick={() => setWaypoints(prev => prev.slice(0, -1))}
                    whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.985 }}
                  >Undo Last</motion.button>
                  <motion.button
                    className="rp-btn-ghost"
                    onClick={() => setWaypoints([])}
                    whileHover={{ scale: 1.015 }} whileTap={{ scale: 0.985 }}
                  >Clear All</motion.button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {waypoints.length >= 2 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              >
                <div className="gi-divider" />
                <div className="panel-label" style={{ marginBottom: 12 }}>Segments</div>
                <motion.div
                  style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
                  variants={staggerList} initial="hidden" animate="show"
                >
                  {waypoints.slice(1).map((wp, i) => {
                    const km = segmentKm(waypoints[i], wp)
                    return (
                      <motion.div key={i} variants={fadeUp} className="rp-segment-card">
                        <div className="rp-segment-num">{i + 1}</div>
                        <div className="rp-segment-info">
                          <span className="rp-segment-dist">{km.toFixed(1)} km</span>
                          <span className="ship-sep">·</span>
                          <span className="rp-segment-co2">+{(km * 0.8).toFixed(1)} t CO₂</span>
                        </div>
                      </motion.div>
                    )
                  })}
                </motion.div>
                <div className="rp-total">
                  <span>Total</span>
                  <span className="rp-total-val">+{totalCO2} t CO₂</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* ── Map ── */}
      <div className="map-container">
        <Map
          initialViewState={{ longitude: -118.8, latitude: 33.8, zoom: 4 }}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          mapboxAccessToken={MAPBOX_TOKEN}
          onClick={e => {
            // Don't add waypoint if clicking a cluster or vessel
            const features = e.features ?? []
            if (features.some(f => f.layer?.id?.startsWith('traffic'))) return
            setWaypoints(prev => [...prev, { lat: e.lngLat.lat, lon: e.lngLat.lng }])
          }}
          cursor="crosshair"
          reuseMaps
          interactiveLayerIds={['traffic-clusters', 'traffic-points']}
        >
          <MPAOverlay />

          {/* AIS traffic — GeoJSON + clustering, GPU-rendered, zero DOM elements */}
          <Source
            id="traffic"
            type="geojson"
            data={trafficGeoJSON}
            cluster={true}
            clusterMaxZoom={8}
            clusterRadius={45}
          >
            {/* Cluster circles */}
            <Layer
              id="traffic-clusters"
              type="circle"
              filter={['has', 'point_count']}
              paint={{
                'circle-color': [
                  'step', ['get', 'point_count'],
                  'rgba(245,158,11,0.55)', 20,
                  'rgba(245,158,11,0.7)',  100,
                  'rgba(239,68,68,0.7)',
                ],
                'circle-radius': ['step', ['get', 'point_count'], 14, 20, 20, 100, 28],
                'circle-stroke-width': 1,
                'circle-stroke-color': 'rgba(255,255,255,0.15)',
              }}
            />
            {/* Cluster count label */}
            <Layer
              id="traffic-cluster-label"
              type="symbol"
              filter={['has', 'point_count']}
              layout={{
                'text-field': '{point_count_abbreviated}',
                'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
                'text-size': 11,
              }}
              paint={{ 'text-color': '#07101d', 'text-halo-color': 'rgba(0,0,0,0.2)', 'text-halo-width': 1 }}
            />
            {/* Individual vessel dots */}
            <Layer
              id="traffic-points"
              type="circle"
              filter={['!', ['has', 'point_count']]}
              paint={{
                'circle-radius': 4,
                'circle-color': [
                  'case',
                  ['==', ['get', 'conflict'], true], '#ef4444',
                  '#f59e0b',
                ],
                'circle-opacity': 0.85,
                'circle-stroke-width': 1,
                'circle-stroke-color': 'rgba(255,255,255,0.25)',
              }}
            />
          </Source>

          {/* Route line */}
          {waypoints.length >= 2 && (
            <Source id="route" type="geojson" data={routeGeoJSON}>
              <Layer id="route-glow" type="line"
                paint={{ 'line-color': ROUTE_COLOR, 'line-width': 14, 'line-blur': 10, 'line-opacity': 0.2 }} />
              <Layer id="route-line" type="line"
                paint={{ 'line-color': ROUTE_COLOR, 'line-width': 2.5, 'line-dasharray': [3, 2] }} />
            </Source>
          )}

          {/* Waypoint markers */}
          {waypoints.map((wp, i) => (
            <Marker key={i} longitude={wp.lon} latitude={wp.lat} anchor="center">
              <motion.div
                className="rp-waypoint"
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 28 }}
                onClick={e => {
                  e.stopPropagation()
                  setWaypoints(prev => prev.filter((_, idx) => idx !== i))
                }}
                title={`Waypoint ${i + 1} — click to remove`}
              >
                {i + 1}
              </motion.div>
            </Marker>
          ))}

          {/* Fleet OAE ships */}
          {fleet?.map(ship => (
            <Marker key={ship.ship_id} longitude={ship.position.lon} latitude={ship.position.lat} anchor="center">
              <ShipMarker status={ship.status} name={ship.name}
                lat={ship.position.lat} lon={ship.position.lon} co2={ship.co2_removed_tons} />
            </Marker>
          ))}
        </Map>

        {/* Map legend */}
        <div className="map-legend">
          <div className="legend-row"><div className="legend-swatch" /><span>MPA Zone</span></div>
          <div className="legend-row">
            <div style={{ width: 20, height: 3, background: ROUTE_COLOR, borderRadius: 2, boxShadow: `0 0 6px ${ROUTE_COLOR}66` }} />
            <span>Planned Route</span>
          </div>
          <div className="legend-rule" />
          <div className="legend-row">
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} />
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

      {/* ── Right sidebar — AIS traffic ── */}
      <motion.div
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
        </div>
      </motion.div>
    </div>
  )
}
