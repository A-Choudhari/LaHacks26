import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Map, { Source, Layer, Marker } from 'react-map-gl'
import { motion, AnimatePresence } from 'framer-motion'
import { API_URL, MAPBOX_TOKEN, OAE_ZONES, fadeUp, staggerList } from '../constants'
import type { CalCOFIStation, DiscoveryZone, ShipStatus } from '../types'
import { MPAOverlay } from '../components/shared/MPAOverlay'
import { ShipMarker } from '../components/shared/ShipMarker'

interface GlobalIntelligenceProps {
  fleet?: ShipStatus[]
}

// score may come as string from Mapbox feature properties
function zoneTier(score: number | string) {
  const s = typeof score === 'string' ? parseFloat(score) : score
  if (s > 0.85) return 'high'
  if (s > 0.7)  return 'med'
  return 'low'
}

function zoneScore(score: number | string) {
  const s = typeof score === 'string' ? parseFloat(score) : score
  return (s * 100).toFixed(0)
}

const TIER_COLOR: Record<string, string> = {
  high: 'var(--success)',
  med:  'var(--warning)',
  low:  'var(--danger)',
}

export function GlobalIntelligence({ fleet }: GlobalIntelligenceProps) {
  const { data: stations } = useQuery<CalCOFIStation[]>({
    queryKey: ['oceanographic'],
    queryFn: () => fetch(`${API_URL}/oceanographic`).then(r => r.json()),
    retry: 1,
  })

  const [selectedZone, setSelectedZone] = useState<any>(null)
  const [discoveryZones, setDiscoveryZones] = useState<DiscoveryZone[]>([])
  const [isDiscovering, setIsDiscovering] = useState(false)

  const runDiscovery = async () => {
    setIsDiscovering(true)
    try {
      const res = await fetch(`${API_URL}/discover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (res.ok) setDiscoveryZones(await res.json())
    } finally {
      setIsDiscovering(false)
    }
  }

  const stationsGeoJSON = {
    type: 'FeatureCollection' as const,
    features: (stations ?? []).map(s => ({
      type: 'Feature' as const,
      properties: { id: s.station_id, temp: s.temperature_c },
      geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] },
    })),
  }

  const avgTemp = stations
    ? (stations.reduce((s, x) => s + x.temperature_c, 0) / stations.length).toFixed(1)
    : null

  const tier = selectedZone ? zoneTier(selectedZone.score) : 'high'

  return (
    <div className="mode-layout">

      {/* ── Left Sidebar ── */}
      <motion.div
        className="sidebar sidebar-left"
        initial={{ x: -280, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 30 }}
      >
        <div className="panel">
          <div className="panel-label">OAE Zones</div>

          <motion.div className="gi-zone-list" variants={staggerList} initial="hidden" animate="show">
            {OAE_ZONES.features.map(f => {
              const t = zoneTier(f.properties.score)
              const isSelected = selectedZone?.name === f.properties.name
              return (
                <motion.div
                  key={f.properties.name}
                  variants={fadeUp}
                  className={`gi-zone-card ${isSelected ? 'selected' : ''}`}
                  onClick={() => setSelectedZone(isSelected ? null : f.properties)}
                  whileHover={{ scale: 1.015 }}
                  whileTap={{ scale: 0.985 }}
                  style={{ '--tier-color': TIER_COLOR[t] } as React.CSSProperties}
                >
                  <div className="gi-zone-pip" style={{ background: TIER_COLOR[t], boxShadow: `0 0 6px ${TIER_COLOR[t]}88` }} />
                  <div className="gi-zone-info">
                    <div className="gi-zone-name">{f.properties.name}</div>
                    <div className="gi-zone-meta">
                      <span className="gi-zone-label">{f.properties.label}</span>
                      <span className="ship-sep">·</span>
                      <span className="gi-zone-score" style={{ color: TIER_COLOR[t] }}>
                        {zoneScore(f.properties.score)}%
                      </span>
                    </div>
                  </div>
                  <motion.div
                    className="gi-zone-arrow"
                    animate={{ rotate: isSelected ? 90 : 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                  >›</motion.div>
                </motion.div>
              )
            })}
          </motion.div>

          {/* CalCOFI summary */}
          <AnimatePresence>
            {stations && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, type: 'spring', stiffness: 380, damping: 30 }}
              >
                <div className="gi-divider" />
                <div className="panel-label" style={{ marginBottom: 12 }}>Ocean Conditions</div>
                <div className="fleet-stats">
                  <div className="stat-card">
                    <div className="stat-value">{stations.length}</div>
                    <div className="stat-label">Stations</div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-value">{avgTemp}°</div>
                    <div className="stat-label">Avg Temp</div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Discover button */}
          <div className="gi-divider" />
          <motion.button
            className="run-btn"
            onClick={runDiscovery}
            disabled={isDiscovering}
            whileHover={{ scale: isDiscovering ? 1 : 1.015 }}
            whileTap={{ scale: isDiscovering ? 1 : 0.985 }}
          >
            {isDiscovering ? 'Scanning zones…' : 'Discover Optimal Zones'}
          </motion.button>

          {/* AI discovery results */}
          <AnimatePresence>
            {discoveryZones.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              >
                <div className="gi-divider" />
                <div className="panel-label" style={{ marginBottom: 12 }}>AI Recommendations</div>
                <motion.div variants={staggerList} initial="hidden" animate="show">
                  {discoveryZones.map((z, i) => {
                    const t = zoneTier(z.score)
                    return (
                      <motion.div
                        key={i}
                        variants={fadeUp}
                        className="gi-zone-card"
                        onClick={() => setSelectedZone({ name: `Site #${i + 1}`, label: 'AI Recommended', score: z.score, reason: z.reason })}
                        whileHover={{ scale: 1.015 }}
                        whileTap={{ scale: 0.985 }}
                        style={{ '--tier-color': TIER_COLOR[t] } as React.CSSProperties}
                      >
                        <div className="gi-zone-pip" style={{ background: TIER_COLOR[t], boxShadow: `0 0 6px ${TIER_COLOR[t]}88` }} />
                        <div className="gi-zone-info">
                          <div className="gi-zone-name">Site #{i + 1}</div>
                          <div className="gi-zone-meta">
                            <span className="gi-zone-score" style={{ color: TIER_COLOR[t] }}>{zoneScore(z.score)}%</span>
                            <span className="ship-sep">·</span>
                            <span className="gi-zone-label">{z.reason.slice(0, 28)}…</span>
                          </div>
                        </div>
                        <div className="gi-zone-arrow">›</div>
                      </motion.div>
                    )
                  })}
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* ── Map ── */}
      <div className="map-container">
        <Map
          initialViewState={{ longitude: -120, latitude: 34, zoom: 5 }}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          mapboxAccessToken={MAPBOX_TOKEN}
          reuseMaps
          interactiveLayerIds={['oae-fill']}
          onClick={e => {
            // Only update selection when clicking a named zone feature on the map
            const feat = e.features?.[0]
            if (feat?.properties?.name) setSelectedZone(feat.properties)
          }}
        >
          {/* OAE zones — glow + fill + dotted outline */}
          <Source id="oae-zones" type="geojson" data={OAE_ZONES}>
            <Layer
              id="oae-glow"
              type="line"
              paint={{
                'line-color': ['interpolate',['linear'],['get','score'],0.0,'#ef4444',0.7,'#f59e0b',0.9,'#22c55e'],
                'line-width': 18,
                'line-blur': 14,
                'line-opacity': 0.18,
              }}
            />
            <Layer
              id="oae-fill"
              type="fill"
              paint={{
                'fill-color': ['interpolate',['linear'],['get','score'],0.0,'#ef4444',0.7,'#f59e0b',0.9,'#22c55e'],
                'fill-opacity': 0.12,
              }}
            />
            <Layer
              id="oae-outline"
              type="line"
              paint={{
                'line-color': ['interpolate',['linear'],['get','score'],0.0,'#ef4444',0.7,'#f59e0b',0.9,'#22c55e'],
                'line-width': 1.8,
                'line-dasharray': [2, 2.5],
                'line-opacity': 0.75,
              }}
            />
          </Source>

          {/* CalCOFI stations */}
          {stations && (
            <Source id="calcofi" type="geojson" data={stationsGeoJSON}>
              <Layer
                id="calcofi-circles"
                type="circle"
                paint={{
                  'circle-radius': 5,
                  'circle-color': ['interpolate',['linear'],['get','temp'],10,'#3b82f6',18,'#f59e0b',25,'#ef4444'],
                  'circle-opacity': 0.8,
                  'circle-stroke-color': 'rgba(255,255,255,0.3)',
                  'circle-stroke-width': 1,
                }}
              />
            </Source>
          )}

          <MPAOverlay />

          {fleet?.map(ship => (
            <Marker key={ship.ship_id} longitude={ship.position.lon} latitude={ship.position.lat} anchor="center">
              <ShipMarker status={ship.status} name={ship.name} lat={ship.position.lat} lon={ship.position.lon} co2={ship.co2_removed_tons} />
            </Marker>
          ))}

          {discoveryZones.map((z, i) => (
            <Marker key={`disc-${i}`} longitude={z.lon} latitude={z.lat}>
              <div
                className="discovery-marker"
                onClick={() => setSelectedZone({ name: `Site #${i + 1}`, label: 'AI Recommended', score: z.score, reason: z.reason })}
                style={{ '--disc-color': z.score > 0.85 ? '#22c55e' : z.score > 0.7 ? '#f59e0b' : '#ef4444' } as React.CSSProperties}
              >
                <span className="disc-inner">{i + 1}</span>
              </div>
            </Marker>
          ))}
        </Map>

        {/* Zone detail popup — top-center of map, slides down */}
        <AnimatePresence>
          {selectedZone && (
            <motion.div
              className="gi-detail-card"
              initial={{ opacity: 0, y: -16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            >
              <div className="gi-detail-header">
                <div
                  className="gi-zone-pip"
                  style={{
                    width: 8, height: 8,
                    background: TIER_COLOR[tier],
                    boxShadow: `0 0 8px ${TIER_COLOR[tier]}88`,
                  }}
                />
                <span className="gi-detail-name">{selectedZone.name}</span>
                <span className="gi-detail-score" style={{ color: TIER_COLOR[tier] }}>
                  {zoneScore(selectedZone.score)}%
                </span>
                <motion.button
                  className="gi-detail-close"
                  onClick={() => setSelectedZone(null)}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                >✕</motion.button>
              </div>
              <p className="gi-detail-reason">{selectedZone.reason}</p>
              <div className="gi-detail-tag">{selectedZone.label}</div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Map legend */}
        <div className="map-legend">
          <div className="legend-grad-label">OAE Suitability</div>
          <div className="legend-row"><div className="legend-swatch" style={{ background: '#22c55e' }} /><span>High (&gt;85%)</span></div>
          <div className="legend-row"><div className="legend-swatch" style={{ background: '#f59e0b' }} /><span>Medium (70–85%)</span></div>
          <div className="legend-row"><div className="legend-swatch" style={{ background: '#ef4444' }} /><span>Low (&lt;70%)</span></div>
          <div className="legend-rule" />
          <div className="legend-row"><div className="legend-swatch" /><span>MPA Zone</span></div>
          {stations && (
            <>
              <div className="legend-rule" />
              <div className="legend-grad-label">CalCOFI temp</div>
              <div className="legend-row"><div className="legend-swatch" style={{ background: '#3b82f6', borderRadius: '50%' }} /><span>10°C</span></div>
              <div className="legend-row"><div className="legend-swatch" style={{ background: '#ef4444', borderRadius: '50%' }} /><span>25°C</span></div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
