import { useState, useRef, useEffect, useCallback } from 'react'
import { QueryClient, QueryClientProvider, useQuery, useMutation } from '@tanstack/react-query'
import Map, { Source, Layer, Marker, MapRef } from 'react-map-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { PlumeThreeLayer } from './ThreeLayer'

const queryClient = new QueryClient()
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8001'
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || ''

// ─── Types ───────────────────────────────────────────────────────────────────

type AppMode = 'global' | 'mission' | 'route'

interface SimulationParams {
  vessel: { vessel_speed: number; discharge_rate: number }
  feedstock: { feedstock_type: 'olivine' | 'sodium_hydroxide' }
  ocean: { temperature: number; salinity: number }
}

interface SimulationResult {
  status: 'safe' | 'unsafe'
  safety_failures: string[]
  summary: { max_aragonite_saturation: number; max_total_alkalinity: number }
  fields?: { alkalinity?: number[][]; aragonite_saturation?: number[][] }
  coordinates?: { x: number[]; y: number[]; z: number[] }
  source: 'live' | 'mock'
  timestamp: string
  mrv_hash?: string
}

interface ShipStatus {
  ship_id: string
  name: string
  position: { lat: number; lon: number }
  status: 'active' | 'idle' | 'deploying'
  co2_removed_tons: number
}

interface AnalysisResult {
  safety_assessment: string
  co2_projection: string
  recommendations: string[]
  confidence: number
  model_used: string
}

interface CalCOFIStation {
  station_id: string
  lat: number
  lon: number
  temperature_c: number
  salinity_psu: number
  alkalinity_umol_kg: number
  chlorophyll_mg_m3: number
  suitability_score: number
}

interface DiscoveryZone {
  lat: number
  lon: number
  score: number
  reason: string
  mpa_conflict: boolean
}

// ─── Static GeoJSON data ──────────────────────────────────────────────────────

const OAE_ZONES = {
  type: 'FeatureCollection' as const,
  features: [
    {
      type: 'Feature' as const,
      properties: { name: 'Zone Alpha — High Priority', score: 0.92, reason: 'Deep MLD, high CO₂ uptake, no MPA overlap' },
      geometry: { type: 'Polygon' as const, coordinates: [[[-122.5,36.0],[-120.0,36.0],[-120.0,34.5],[-122.5,34.5],[-122.5,36.0]]] },
    },
    {
      type: 'Feature' as const,
      properties: { name: 'Zone Beta — Medium Priority', score: 0.71, reason: 'Good MLD, moderate current, marginal MPA proximity' },
      geometry: { type: 'Polygon' as const, coordinates: [[[-119.5,33.5],[-117.5,33.5],[-117.5,32.0],[-119.5,32.0],[-119.5,33.5]]] },
    },
    {
      type: 'Feature' as const,
      properties: { name: 'Zone Gamma — Active Deployment', score: 0.85, reason: 'Current deployment area — Pacific Guardian operational' },
      geometry: { type: 'Polygon' as const, coordinates: [[[-119.0,34.5],[-117.5,34.5],[-117.5,33.5],[-119.0,33.5],[-119.0,34.5]]] },
    },
  ],
}

const MPA_DATA = {
  type: 'FeatureCollection' as const,
  features: [
    {
      type: 'Feature' as const,
      properties: { name: 'Channel Islands NMS', type: 'sanctuary' },
      geometry: { type: 'Polygon' as const, coordinates: [[[-119.9,34.15],[-119.9,33.85],[-119.3,33.85],[-119.3,34.15],[-119.9,34.15]]] },
    },
    {
      type: 'Feature' as const,
      properties: { name: 'Point Dume SMCA', type: 'conservation' },
      geometry: { type: 'Polygon' as const, coordinates: [[[-118.82,34.02],[-118.82,33.98],[-118.75,33.98],[-118.75,34.02],[-118.82,34.02]]] },
    },
  ],
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function MPAOverlay() {
  return (
    <Source id="mpa" type="geojson" data={MPA_DATA}>
      <Layer id="mpa-fill" type="fill" paint={{ 'fill-color': '#ef4444', 'fill-opacity': 0.15 }} />
      <Layer id="mpa-outline" type="line" paint={{ 'line-color': '#ef4444', 'line-width': 2, 'line-dasharray': [3, 2] }} />
    </Source>
  )
}

function PlumeHeatmap({ visible, simulationData }: { visible: boolean; simulationData?: SimulationResult }) {
  const baseLon = -118.2437
  const baseLat = 34.0522

  const features: any[] = []
  if (visible) {
    if (simulationData?.fields?.alkalinity) {
      const alk = simulationData.fields.alkalinity
      const gridSize = alk.length
      for (let i = 0; i < gridSize; i++) {
        for (let j = 0; j < (alk[i]?.length || 0); j++) {
          const intensity = Math.max(0, Math.min(1, ((alk[i][j] ?? 0) - 2300) / 1200))
          if (intensity > 0.05) {
            features.push({
              type: 'Feature' as const,
              properties: { intensity },
              geometry: { type: 'Point' as const, coordinates: [baseLon + (j - gridSize / 2) * 0.008, baseLat + (i - gridSize / 2) * 0.004] },
            })
          }
        }
      }
    } else {
      for (let i = 0; i < 80; i++) {
        const angle = (i / 80) * Math.PI * 2
        const distance = Math.random() * 0.04
        features.push({
          type: 'Feature' as const,
          properties: { intensity: Math.exp(-distance * 30) * (0.5 + Math.random() * 0.5) },
          geometry: { type: 'Point' as const, coordinates: [baseLon + Math.cos(angle) * distance, baseLat + Math.sin(angle) * distance * 0.5] },
        })
      }
    }
  }

  return (
    <Source id="plume" type="geojson" data={{ type: 'FeatureCollection', features }}>
      <Layer
        id="plume-heat"
        type="heatmap"
        paint={{
          'heatmap-weight': ['get', 'intensity'],
          'heatmap-intensity': 1.5,
          'heatmap-color': ['interpolate',['linear'],['heatmap-density'],0,'rgba(0,0,255,0)',0.1,'rgba(0,100,255,0.3)',0.3,'rgba(0,200,255,0.5)',0.5,'rgba(0,255,200,0.6)',0.7,'rgba(100,255,100,0.7)',0.85,'rgba(255,255,0,0.8)',1,'rgba(255,100,0,0.9)'],
          'heatmap-radius': 40,
          'heatmap-opacity': 0.85,
        }}
      />
    </Source>
  )
}

// ─── Mode Selector ────────────────────────────────────────────────────────────

function ModeSelector({ mode, onModeChange }: { mode: AppMode; onModeChange: (m: AppMode) => void }) {
  return (
    <div className="mode-selector">
      <button className={`mode-btn${mode === 'global' ? ' active' : ''}`} onClick={() => onModeChange('global')}>
        Global Intelligence
      </button>
      <button className={`mode-btn${mode === 'mission' ? ' active' : ''}`} onClick={() => onModeChange('mission')}>
        Mission Control
      </button>
      <button className={`mode-btn${mode === 'route' ? ' active' : ''}`} onClick={() => onModeChange('route')}>
        Route Planning
      </button>
    </div>
  )
}

// ─── Mission Control panels ───────────────────────────────────────────────────

function SimulationPanel({ onRun, isLoading, result }: {
  onRun: (p: SimulationParams) => void
  isLoading: boolean
  result?: SimulationResult
}) {
  const [vesselSpeed, setVesselSpeed] = useState(5.0)
  const [dischargeRate, setDischargeRate] = useState(0.1)
  const [feedstock, setFeedstock] = useState<'olivine' | 'sodium_hydroxide'>('olivine')

  return (
    <div className="panel simulation-panel">
      <h2>Mission Control</h2>
      <div className="param-group">
        <label>Vessel Speed (m/s)</label>
        <input type="range" min="1" max="15" step="0.5" value={vesselSpeed} onChange={e => setVesselSpeed(+e.target.value)} />
        <span>{vesselSpeed}</span>
      </div>
      <div className="param-group">
        <label>Discharge Rate (m³/s)</label>
        <input type="range" min="0.01" max="1.0" step="0.01" value={dischargeRate} onChange={e => setDischargeRate(+e.target.value)} />
        <span>{dischargeRate}</span>
      </div>
      <div className="param-group">
        <label>Feedstock</label>
        <select value={feedstock} onChange={e => setFeedstock(e.target.value as any)}>
          <option value="olivine">Olivine</option>
          <option value="sodium_hydroxide">Sodium Hydroxide</option>
        </select>
      </div>
      <button onClick={() => onRun({ vessel: { vessel_speed: vesselSpeed, discharge_rate: dischargeRate }, feedstock: { feedstock_type: feedstock }, ocean: { temperature: 15.0, salinity: 35.0 } })} disabled={isLoading}>
        {isLoading ? 'Simulating...' : 'Run Simulation'}
      </button>
      {result && (
        <div className={`result ${result.status}`}>
          <h3>Result: {result.status.toUpperCase()}</h3>
          <p>Source: {result.source}</p>
          <p>Max Ω aragonite: {result.summary.max_aragonite_saturation.toFixed(2)}</p>
          <p>Max TA: {result.summary.max_total_alkalinity.toFixed(0)} µmol/kg</p>
          {result.safety_failures.length > 0 && (
            <ul className="failures">{result.safety_failures.map((f, i) => <li key={i}>{f}</li>)}</ul>
          )}
        </div>
      )}
    </div>
  )
}

function FleetPanel({ ships }: { ships?: ShipStatus[] }) {
  if (!ships) return null
  const totalCO2 = ships.reduce((s, ship) => s + ship.co2_removed_tons, 0)
  return (
    <div className="panel fleet-panel">
      <h2>Fleet Status</h2>
      <div className="fleet-summary">
        <div className="metric"><span className="value">{ships.length}</span><span className="label">Ships</span></div>
        <div className="metric"><span className="value">{totalCO2.toFixed(0)}</span><span className="label">Tons CO₂</span></div>
      </div>
      <div className="ship-list">
        {ships.map(ship => (
          <div key={ship.ship_id} className={`ship-card ${ship.status}`}>
            <div className="ship-name">{ship.name}</div>
            <div className="ship-status">{ship.status}</div>
            <div className="ship-co2">{ship.co2_removed_tons.toFixed(1)} t CO₂</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AIPanel({ result }: { result?: SimulationResult }) {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const analyze = async () => {
    if (!result) return
    setIsAnalyzing(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          simulation_result: { summary: result.summary, params: { feedstock_type: 'olivine', temperature: 15, discharge_rate: 0.1 } },
          analysis_type: 'full',
        }),
      })
      if (!res.ok) throw new Error('Analysis failed')
      setAnalysis(await res.json())
    } catch {
      setError('Failed to analyze. Is the backend running?')
    } finally {
      setIsAnalyzing(false)
    }
  }

  return (
    <div className="panel ai-panel">
      <h2>AI Analysis</h2>
      <button onClick={analyze} disabled={!result || isAnalyzing}>
        {isAnalyzing ? 'Analyzing...' : 'Analyze Results'}
      </button>
      {error && <div className="error">{error}</div>}
      {analysis && (
        <div className="analysis">
          <div className="analysis-section"><h4>Safety Assessment</h4><p>{analysis.safety_assessment}</p></div>
          <div className="analysis-section"><h4>CO₂ Projection</h4><p>{analysis.co2_projection}</p></div>
          <div className="analysis-section">
            <h4>Recommendations</h4>
            <ul>{analysis.recommendations.map((r, i) => <li key={i}>{r}</li>)}</ul>
          </div>
          <div className="analysis-meta">Model: {analysis.model_used} | Confidence: {(analysis.confidence * 100).toFixed(0)}%</div>
        </div>
      )}
    </div>
  )
}

function MapLegend({ visible }: { visible: boolean }) {
  return (
    <div className="map-legend">
      <div className="legend-item"><div className="legend-mpa" /><span>Marine Protected Area</span></div>
      {visible && (
        <>
          <div className="legend-title">Alkalinity (µmol/kg)</div>
          <div className="legend-bar">
            <div className="legend-gradient" />
            <div className="legend-labels"><span>2300</span><span>2900</span><span>3500</span></div>
          </div>
        </>
      )}
    </div>
  )
}

function ImpactMetrics({ result, fleet }: { result?: SimulationResult; fleet?: ShipStatus[] }) {
  const totalCO2 = fleet?.reduce((s, ship) => s + ship.co2_removed_tons, 0) || 0
  const maxAlk = result?.summary?.max_total_alkalinity || 0
  const isSafe = result?.status === 'safe'
  const estimatedCO2 = maxAlk > 2300 ? ((maxAlk - 2300) * 0.8 * 44 * 25) / 1e6 : 0

  return (
    <div className="impact-metrics">
      <div className="impact-card">
        <div className="impact-value">{totalCO2.toFixed(0)}</div>
        <div className="impact-label">Total CO₂ Removed (t)</div>
      </div>
      {result && (
        <>
          <div className="impact-card">
            <div className={`impact-value ${isSafe ? 'safe' : 'unsafe'}`}>{isSafe ? 'SAFE' : 'UNSAFE'}</div>
            <div className="impact-label">Deployment Status</div>
          </div>
          <div className="impact-card">
            <div className="impact-value">+{estimatedCO2.toFixed(1)}</div>
            <div className="impact-label">Est. CO₂ Impact (t)</div>
          </div>
          {result.mrv_hash && (
            <div className="impact-card mrv-card" title={`MRV Hash: ${result.mrv_hash}`}>
              <div className="impact-value mrv-value">✓ MRV</div>
              <div className="impact-label">Proof: {result.mrv_hash.slice(0, 8)}…</div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Mode 1: Global Intelligence ─────────────────────────────────────────────

function GlobalIntelligenceMode({ fleet }: { fleet?: ShipStatus[] }) {
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
      const res = await fetch(`${API_URL}/discover`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      if (res.ok) setDiscoveryZones(await res.json())
    } finally {
      setIsDiscovering(false)
    }
  }

  const stationsGeoJSON = {
    type: 'FeatureCollection' as const,
    features: (stations ?? []).map(s => ({
      type: 'Feature' as const,
      properties: { id: s.station_id, temp: s.temperature_c, sal: s.salinity_psu, score: s.suitability_score },
      geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] },
    })),
  }

  return (
    <div className="mode-layout">
      <div className="sidebar">
        <div className="panel">
          <h2>Global Intelligence</h2>
          <p className="mode-desc">Candidate OAE zones ranked by alkalinity uptake potential, MPA avoidance, and mixed-layer depth.</p>
          <div className="zone-list">
            {OAE_ZONES.features.map(f => (
              <div
                key={f.properties.name}
                className={`zone-card zone-${f.properties.score > 0.85 ? 'high' : f.properties.score > 0.7 ? 'med' : 'low'}`}
                onClick={() => setSelectedZone(selectedZone?.name === f.properties.name ? null : f.properties)}
              >
                <div className="zone-name">{f.properties.name}</div>
                <div className="zone-score">Score: {(f.properties.score * 100).toFixed(0)}%</div>
                <div className="zone-reason">{f.properties.reason}</div>
              </div>
            ))}
          </div>
          {stations && (
            <div className="calcofi-summary">
              <h4>CalCOFI Stations ({stations.length})</h4>
              <p>Avg temp: {(stations.reduce((s, x) => s + x.temperature_c, 0) / stations.length).toFixed(1)}°C</p>
              <p>Avg salinity: {(stations.reduce((s, x) => s + x.salinity_psu, 0) / stations.length).toFixed(2)} PSU</p>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <button onClick={runDiscovery} disabled={isDiscovering} style={{ width: '100%' }}>
              {isDiscovering ? 'Scanning zones...' : 'Discover Optimal Zones'}
            </button>
            {discoveryZones.length > 0 && (
              <div className="discovery-results">
                <h4>AI Recommendations ({discoveryZones.length})</h4>
                {discoveryZones.map((z, i) => (
                  <div key={i} className={`zone-card zone-${z.score > 0.85 ? 'high' : z.score > 0.7 ? 'med' : 'low'}`}>
                    <div className="zone-name">Site #{i + 1}</div>
                    <div className="zone-score">Score: {(z.score * 100).toFixed(0)}%</div>
                    <div className="zone-reason">{z.reason}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="map-container">
        <Map
          initialViewState={{ longitude: -119, latitude: 33, zoom: 4.5 }}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          mapboxAccessToken={MAPBOX_TOKEN}
          interactiveLayerIds={['oae-zones-fill']}
          onClick={e => {
            const feat = e.features?.[0]
            if (feat) setSelectedZone(feat.properties)
          }}
        >
          {/* OAE deployment zones */}
          <Source id="oae-zones" type="geojson" data={OAE_ZONES}>
            <Layer id="oae-zones-fill" type="fill" paint={{ 'fill-color': ['interpolate',['linear'],['get','score'],0.0,'#ef4444',0.7,'#f59e0b',0.9,'#22c55e'], 'fill-opacity': 0.25 }} />
            <Layer id="oae-zones-outline" type="line" paint={{ 'line-color': ['interpolate',['linear'],['get','score'],0.0,'#ef4444',0.7,'#f59e0b',0.9,'#22c55e'], 'line-width': 2 }} />
          </Source>

          {/* CalCOFI oceanographic stations */}
          {stations && (
            <Source id="calcofi" type="geojson" data={stationsGeoJSON}>
              <Layer id="calcofi-circles" type="circle" paint={{ 'circle-radius': 6, 'circle-color': ['interpolate',['linear'],['get','temp'],10,'#3b82f6',18,'#f59e0b',25,'#ef4444'], 'circle-opacity': 0.85, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 }} />
            </Source>
          )}

          <MPAOverlay />

          {fleet?.map(ship => (
            <Marker key={ship.ship_id} longitude={ship.position.lon} latitude={ship.position.lat}>
              <div className={`ship-marker ${ship.status}`}>🚢</div>
            </Marker>
          ))}

          {/* Discovery zone pulse markers */}
          {discoveryZones.map((z, i) => (
            <Marker key={`disc-${i}`} longitude={z.lon} latitude={z.lat}>
              <div
                className="discovery-marker"
                title={`Site #${i + 1} — Score: ${(z.score * 100).toFixed(0)}%\n${z.reason}`}
                style={{ '--disc-color': z.score > 0.85 ? '#22c55e' : z.score > 0.7 ? '#f59e0b' : '#ef4444' } as React.CSSProperties}
              >
                <span className="disc-inner">{i + 1}</span>
              </div>
            </Marker>
          ))}
        </Map>

        {selectedZone && (
          <div className="zone-tooltip">
            <button className="zone-tooltip-close" onClick={() => setSelectedZone(null)}>✕</button>
            <strong>{selectedZone.name}</strong>
            <p>{selectedZone.reason}</p>
          </div>
        )}

        <div className="map-legend">
          <div className="legend-title">OAE Zone Suitability</div>
          <div className="legend-item"><div className="swatch" style={{ background: '#22c55e' }} /><span>High (&gt;85%)</span></div>
          <div className="legend-item"><div className="swatch" style={{ background: '#f59e0b' }} /><span>Medium (70-85%)</span></div>
          <div className="legend-item"><div className="swatch" style={{ background: '#ef4444' }} /><span>Low (&lt;70%)</span></div>
          <div className="legend-item"><div className="legend-mpa" /><span>MPA Boundary</span></div>
          {stations && <div className="legend-title" style={{ marginTop: 8 }}>CalCOFI (by temp)</div>}
          {stations && <div className="legend-item"><div className="swatch swatch-circle" style={{ background: '#3b82f6' }} /><span>10°C</span></div>}
          {stations && <div className="legend-item"><div className="swatch swatch-circle" style={{ background: '#ef4444' }} /><span>25°C</span></div>}
        </div>
      </div>
    </div>
  )
}

// ─── Mode 2: Mission Control ──────────────────────────────────────────────────

function MissionControlMode({ fleet }: { fleet?: ShipStatus[] }) {
  const [simulationResult, setSimulationResult] = useState<SimulationResult>()
  const [showPlume, setShowPlume] = useState(false)
  const mapRef = useRef<MapRef>(null)
  const threeLayerRef = useRef<PlumeThreeLayer | null>(null)

  const simulateMutation = useMutation({
    mutationFn: async (params: SimulationParams) => {
      const res = await fetch(`${API_URL}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (!res.ok) throw new Error('Simulation failed')
      return res.json() as Promise<SimulationResult>
    },
    onSuccess: data => {
      setSimulationResult(data)
      setShowPlume(true)
    },
    onError: err => alert('Simulation failed: ' + (err as Error).message),
  })

  // Add Three.js layer once map loads
  const handleMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap()
    if (!map) return
    const layer = new PlumeThreeLayer(null)
    threeLayerRef.current = layer
    map.addLayer(layer)
  }, [])

  // Update Three.js layer when new simulation data arrives
  useEffect(() => {
    if (!simulationResult || !threeLayerRef.current) return
    if (simulationResult.fields?.aragonite_saturation && simulationResult.coordinates) {
      threeLayerRef.current.updateData({
        fields: {
          alkalinity: simulationResult.fields.alkalinity ?? [],
          aragonite_saturation: simulationResult.fields.aragonite_saturation,
        },
        coordinates: simulationResult.coordinates,
      })
    }
  }, [simulationResult])

  return (
    <div className="mode-layout">
      <div className="sidebar">
        <SimulationPanel
          onRun={p => simulateMutation.mutate(p)}
          isLoading={simulateMutation.isPending}
          result={simulationResult}
        />
        <AIPanel result={simulationResult} />
      </div>

      <div className="map-container">
        <Map
          ref={mapRef}
          initialViewState={{ longitude: -118.2437, latitude: 34.0522, zoom: 10 }}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          mapboxAccessToken={MAPBOX_TOKEN}
          onLoad={handleMapLoad}
        >
          <MPAOverlay />
          <PlumeHeatmap visible={showPlume} simulationData={simulationResult} />
          {fleet?.map(ship => (
            <Marker key={ship.ship_id} longitude={ship.position.lon} latitude={ship.position.lat}>
              <div className={`ship-marker ${ship.status}`}>🚢</div>
            </Marker>
          ))}
        </Map>
        <MapLegend visible={showPlume} />
        <ImpactMetrics result={simulationResult} fleet={fleet} />
      </div>

      <div className="sidebar right">
        <FleetPanel ships={fleet} />
      </div>
    </div>
  )
}

// ─── Mode 3: Route Planning ───────────────────────────────────────────────────

function RoutePlanningMode({ fleet }: { fleet?: ShipStatus[] }) {
  const [waypoints, setWaypoints] = useState<{ lat: number; lon: number }[]>([])

  const { data: traffic } = useQuery({
    queryKey: ['traffic'],
    queryFn: () => fetch(`${API_URL}/traffic`).then(r => r.json()),
    retry: 1,
  })

  const routeGeoJSON = {
    type: 'FeatureCollection' as const,
    features: waypoints.length >= 2 ? [{
      type: 'Feature' as const,
      properties: {},
      geometry: { type: 'LineString' as const, coordinates: waypoints.map(w => [w.lon, w.lat]) },
    }] : [],
  }

  const routeKm = waypoints.length >= 2
    ? waypoints.slice(1).reduce((total, wp, i) => {
        const prev = waypoints[i]
        const d = Math.sqrt(((wp.lat - prev.lat) * 111.32) ** 2 + ((wp.lon - prev.lon) * 111.32 * Math.cos(prev.lat * Math.PI / 180)) ** 2)
        return total + d
      }, 0)
    : 0

  return (
    <div className="mode-layout">
      <div className="sidebar">
        <div className="panel">
          <h2>Route Planning</h2>
          <p className="mode-desc">Click the map to add waypoints. Each segment shows projected alkalinity deployment and CO₂ removal.</p>
          <div className="route-stats">
            <div className="metric"><span className="value">{waypoints.length}</span><span className="label">Waypoints</span></div>
            <div className="metric"><span className="value">{routeKm.toFixed(0)}</span><span className="label">Route km</span></div>
          </div>
          {waypoints.length > 0 && (
            <button style={{ marginTop: 12 }} onClick={() => setWaypoints([])}>Clear Route</button>
          )}
          {waypoints.length >= 2 && (
            <div className="segment-list">
              <h4>Segments</h4>
              {waypoints.slice(1).map((wp, i) => {
                const prev = waypoints[i]
                const km = Math.sqrt(((wp.lat - prev.lat) * 111.32) ** 2 + ((wp.lon - prev.lon) * 111.32 * Math.cos(prev.lat * Math.PI / 180)) ** 2)
                return (
                  <div key={i} className="segment-card">
                    <span>Seg {i + 1}</span>
                    <span>{km.toFixed(1)} km</span>
                    <span className="seg-co2">+{(km * 0.8).toFixed(1)}t CO₂</span>
                  </div>
                )
              })}
              <div className="segment-total">
                Total est. CO₂: <strong>{(routeKm * 0.8).toFixed(1)} t</strong>
              </div>
            </div>
          )}
          {traffic && (
            <div className="traffic-panel">
              <h4>Vessel Traffic ({traffic.length})</h4>
              {traffic.map((v: any) => (
                <div key={v.vessel_id} className="traffic-card">
                  <span className="traffic-name">{v.name}</span>
                  <span className="traffic-type">{v.vessel_type}</span>
                  <span className="traffic-speed">{v.speed_kn} kn</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="map-container">
        <Map
          initialViewState={{ longitude: -118.8, latitude: 33.8, zoom: 7.5 }}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          mapboxAccessToken={MAPBOX_TOKEN}
          onClick={e => setWaypoints(prev => [...prev, { lat: e.lngLat.lat, lon: e.lngLat.lng }])}
          cursor="crosshair"
        >
          <MPAOverlay />

          {/* Planned route line */}
          {waypoints.length >= 2 && (
            <Source id="route" type="geojson" data={routeGeoJSON}>
              <Layer id="route-line" type="line" paint={{ 'line-color': '#22d3ee', 'line-width': 3, 'line-dasharray': [2, 1] }} />
            </Source>
          )}

          {/* Waypoint markers */}
          {waypoints.map((wp, i) => (
            <Marker key={i} longitude={wp.lon} latitude={wp.lat}>
              <div className="waypoint-marker">{i + 1}</div>
            </Marker>
          ))}

          {/* Fleet ships */}
          {fleet?.map(ship => (
            <Marker key={ship.ship_id} longitude={ship.position.lon} latitude={ship.position.lat}>
              <div className={`ship-marker ${ship.status}`}>🚢</div>
            </Marker>
          ))}

          {/* Vessel traffic */}
          {traffic?.map((v: any) => (
            <Marker key={v.vessel_id} longitude={v.lon} latitude={v.lat}>
              <div className="traffic-marker" title={`${v.name} (${v.vessel_type})`}>▲</div>
            </Marker>
          ))}
        </Map>

        <div className="map-legend">
          <div className="legend-item"><div className="legend-mpa" /><span>MPA Boundary</span></div>
          <div className="legend-item"><div style={{ width: 20, height: 3, background: '#22d3ee', borderRadius: 1 }} /><span>Planned Route</span></div>
          <div className="legend-item"><div className="waypoint-marker" style={{ width: 18, height: 18, fontSize: '0.65rem' }}>W</div><span>Waypoint</span></div>
          <div className="legend-item"><div className="traffic-marker" style={{ color: '#f59e0b', fontSize: '0.7rem' }}>▲</div><span>AIS Vessel</span></div>
        </div>
      </div>
    </div>
  )
}

// ─── Root App ─────────────────────────────────────────────────────────────────

function AppContent() {
  const [mode, setMode] = useState<AppMode>('mission')

  const { data: fleet } = useQuery<ShipStatus[]>({
    queryKey: ['fleet'],
    queryFn: () => fetch(`${API_URL}/fleet`).then(r => r.json()),
    refetchInterval: 10000,
  })

  return (
    <div className="app">
      <header>
        <h1>The Tiered Edge Fleet</h1>
        <span className="subtitle">Ocean Alkalinity Enhancement Platform</span>
        <ModeSelector mode={mode} onModeChange={setMode} />
      </header>
      <main>
        {mode === 'global'  && <GlobalIntelligenceMode fleet={fleet} />}
        {mode === 'mission' && <MissionControlMode fleet={fleet} />}
        {mode === 'route'   && <RoutePlanningMode fleet={fleet} />}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  )
}
