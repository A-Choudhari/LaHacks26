import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import Map, { Source, Layer, Marker } from 'react-map-gl'
import { motion, AnimatePresence } from 'framer-motion'
import { API_URL, MAPBOX_TOKEN, OAE_ZONES, fadeUp, staggerList } from '../constants'
import type { CalCOFIStation, DiscoveryZone, HotspotImpact, ShipStatus } from '../types'
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
  const [impactData, setImpactData] = useState<Record<number, HotspotImpact>>({})
  const [impactLoading, setImpactLoading] = useState<Set<number>>(new Set())
  const [selectedDiscIdx, setSelectedDiscIdx] = useState<number | null>(null)

  const runDiscovery = async () => {
    setIsDiscovering(true)
    setImpactData({})
    setSelectedDiscIdx(null)
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

  // Fetch impact for each discovery zone after they arrive
  useEffect(() => {
    if (discoveryZones.length === 0) return
    discoveryZones.forEach((z, i) => {
      setImpactLoading(prev => new Set(prev).add(i))
      fetch(`${API_URL}/hotspot-impact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: z.lat, lon: z.lon }),
      })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data) setImpactData(prev => ({ ...prev, [i]: data }))
        })
        .finally(() => {
          setImpactLoading(prev => { const s = new Set(prev); s.delete(i); return s })
        })
    })
  }, [discoveryZones])

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
                    const isSelected = selectedDiscIdx === i
                    return (
                      <motion.div
                        key={i}
                        variants={fadeUp}
                        className={`gi-zone-card ${isSelected ? 'selected' : ''}`}
                        onClick={() => {
                          setSelectedDiscIdx(isSelected ? null : i)
                          setSelectedZone({ name: `Site #${i + 1}`, label: 'AI Recommended', score: z.score, reason: z.reason })
                        }}
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
                        <motion.div
                          className="gi-zone-arrow"
                          animate={{ rotate: isSelected ? 90 : 0 }}
                          transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                        >›</motion.div>
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
                onClick={() => {
                  setSelectedDiscIdx(selectedDiscIdx === i ? null : i)
                  setSelectedZone({ name: `Site #${i + 1}`, label: 'AI Recommended', score: z.score, reason: z.reason })
                }}
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

      {/* ── Right sidebar — hotspot impact ── */}
      <AnimatePresence>
        {selectedDiscIdx !== null && (
          <motion.div
            className="sidebar sidebar-right"
            initial={{ x: 280, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 280, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 280, damping: 30 }}
          >
            <div className="panel" style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div className="panel-label">
                Impact Analysis — Site #{selectedDiscIdx + 1}
              </div>

              {impactLoading.has(selectedDiscIdx) && (
                <div className="impact-loading">
                  <span className="impact-loading-spin">↻</span> Computing metrics…
                </div>
              )}

              {!impactLoading.has(selectedDiscIdx) && impactData[selectedDiscIdx] && (
                <ImpactPanel impact={impactData[selectedDiscIdx]} />
              )}

              {!impactLoading.has(selectedDiscIdx) && !impactData[selectedDiscIdx] && (
                <div className="impact-loading">No impact data available</div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function fmt(n: number, dec = 1) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return n.toFixed(dec)
}

function ImpactPanel({ impact }: { impact: HotspotImpact }) {
  const { co2_removal, chemistry, plume, economics, safety, ocean_state } = impact

  return (
    <div className="impact-panel">

      {/* CO₂ Removal Projections */}
      <div className="impact-section">
        <div className="impact-section-title">CO₂ Removal (tons/yr)</div>
        <div className="impact-metric-grid cols-4">
          {[
            { label: '1 yr', val: co2_removal.year_1.tons_co2 },
            { label: '5 yr', val: co2_removal.year_5.tons_co2 },
            { label: '10 yr', val: co2_removal.year_10.tons_co2 },
            { label: '50 yr', val: co2_removal.year_50.tons_co2 },
          ].map(({ label, val }) => (
            <div key={label} className="impact-metric-card">
              <div className="impact-metric-val co2">{fmt(val, 0)}</div>
              <div className="impact-metric-lbl">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Revenue Projections */}
      <div className="impact-section">
        <div className="impact-section-title">Revenue (USD)</div>
        <div className="impact-metric-grid">
          <div className="impact-metric-card">
            <div className="impact-metric-val co2">${fmt(economics.revenue_10yr_usd)}</div>
            <div className="impact-metric-lbl">10-yr revenue</div>
          </div>
          <div className="impact-metric-card">
            <div className="impact-metric-val co2">${fmt(economics.revenue_50yr_usd)}</div>
            <div className="impact-metric-lbl">50-yr revenue</div>
          </div>
          <div className="impact-metric-card">
            <div className="impact-metric-val deploy">${economics.carbon_credit_price_usd_per_ton}/t</div>
            <div className="impact-metric-lbl">carbon price</div>
          </div>
          <div className="impact-metric-card">
            <div className="impact-metric-val deploy">${economics.net_value_usd_per_ton_co2.toFixed(0)}/t</div>
            <div className="impact-metric-lbl">net value</div>
          </div>
        </div>
      </div>

      <div className="impact-divider" />

      {/* Ocean Chemistry */}
      <div className="impact-section">
        <div className="impact-section-title">Ocean Chemistry</div>
        <div className="impact-chemistry-row">
          <span className="impact-chem-label">pH baseline</span>
          <span className="impact-chem-val">{chemistry.ph_baseline_approx.toFixed(3)}</span>
        </div>
        <div className="impact-chemistry-row">
          <span className="impact-chem-label">pH after OAE</span>
          <span className="impact-chem-val positive">{chemistry.ph_after_approx.toFixed(3)}</span>
        </div>
        <div className="impact-chemistry-row">
          <span className="impact-chem-label">pH increase</span>
          <span className="impact-chem-val positive">+{chemistry.ph_increase.toFixed(4)}</span>
        </div>
        <div className="impact-chemistry-row">
          <span className="impact-chem-label">Ω aragonite before</span>
          <span className="impact-chem-val">{chemistry.aragonite_saturation_before.toFixed(2)}</span>
        </div>
        <div className="impact-chemistry-row">
          <span className="impact-chem-label">Ω aragonite after</span>
          <span className="impact-chem-val positive">{chemistry.aragonite_saturation_after.toFixed(2)}</span>
        </div>
        <div className="impact-chemistry-row">
          <span className="impact-chem-label">CO₂ solubility ↑</span>
          <span className="impact-chem-val positive">+{chemistry.co2_solubility_improvement_pct.toFixed(1)}%</span>
        </div>
      </div>

      <div className="impact-divider" />

      {/* Plume Metrics */}
      <div className="impact-section">
        <div className="impact-section-title">Plume Metrics</div>
        <div className="impact-metric-grid">
          <div className="impact-metric-card">
            <div className="impact-metric-val deploy">{plume.plume_area_km2.toFixed(1)} km²</div>
            <div className="impact-metric-lbl">plume area</div>
          </div>
          <div className="impact-metric-card">
            <div className="impact-metric-val deploy">{plume.plume_depth_m.toFixed(0)} m</div>
            <div className="impact-metric-lbl">plume depth</div>
          </div>
          <div className="impact-metric-card">
            <div className="impact-metric-val">{plume.peak_ta_increase_umol_kg.toFixed(0)}</div>
            <div className="impact-metric-lbl">ΔTA µmol/kg</div>
          </div>
          <div className="impact-metric-card">
            <div className="impact-metric-val">{plume.max_aragonite_saturation.toFixed(2)}</div>
            <div className="impact-metric-lbl">max Ω arag</div>
          </div>
        </div>
      </div>

      <div className="impact-divider" />

      {/* Safety */}
      <div className="impact-section">
        <div className="impact-section-title">Safety Assessment</div>
        <div className={`impact-safety-badge ${safety.risk_level}`}>
          {safety.risk_level === 'low' ? '✓' : safety.risk_level === 'medium' ? '⚠' : '✕'}&nbsp;
          {safety.risk_level.toUpperCase()} RISK
        </div>
        <div className="impact-metric-grid">
          <div className="impact-metric-card">
            <div className={`impact-metric-val ${safety.max_aragonite > 25 ? 'warn' : 'co2'}`}>
              {safety.max_aragonite.toFixed(2)}
            </div>
            <div className="impact-metric-lbl">max Ω arag</div>
          </div>
          <div className="impact-metric-card">
            <div className={`impact-metric-val ${safety.max_alkalinity_umol_kg > 3200 ? 'warn' : 'co2'}`}>
              {safety.max_alkalinity_umol_kg.toFixed(0)}
            </div>
            <div className="impact-metric-lbl">max TA µmol/kg</div>
          </div>
        </div>
        {safety.safety_failures.length > 0 && (
          <div style={{ marginTop: 6 }}>
            {safety.safety_failures.map((f, i) => (
              <div key={i} className="impact-failure">⚠ {f}</div>
            ))}
          </div>
        )}
      </div>

      <div className="impact-divider" />

      {/* Ocean Conditions Used */}
      <div className="impact-section">
        <div className="impact-section-title">Ocean State</div>
        <div className="impact-chemistry-row">
          <span className="impact-chem-label">Temp</span>
          <span className="impact-chem-val">{ocean_state.temperature_c.toFixed(1)}°C</span>
        </div>
        <div className="impact-chemistry-row">
          <span className="impact-chem-label">Salinity</span>
          <span className="impact-chem-val">{ocean_state.salinity_psu.toFixed(1)} PSU</span>
        </div>
        <div className="impact-chemistry-row">
          <span className="impact-chem-label">MLD</span>
          <span className="impact-chem-val">{ocean_state.mixed_layer_depth_m.toFixed(0)} m</span>
        </div>
        <div className="impact-chemistry-row">
          <span className="impact-chem-label">Baseline TA</span>
          <span className="impact-chem-val">{ocean_state.baseline_alkalinity_umol_kg.toFixed(0)} µmol/kg</span>
        </div>
        <div className="impact-chemistry-row" style={{ borderBottom: 'none' }}>
          <span className="impact-chem-label">Source</span>
          <span className="impact-chem-val" style={{ fontSize: 9.5, color: 'var(--text-3)' }}>{ocean_state.source}</span>
        </div>
      </div>

    </div>
  )
}
