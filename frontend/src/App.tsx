import { useState } from 'react'
import { QueryClient, QueryClientProvider, useQuery, useMutation } from '@tanstack/react-query'
import Map, { Source, Layer, Marker } from 'react-map-gl'
import { motion, AnimatePresence } from 'framer-motion'
import * as SliderPrimitive from '@radix-ui/react-slider'
import 'mapbox-gl/dist/mapbox-gl.css'

const queryClient = new QueryClient()
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8001'
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || ''

// ── Types ──────────────────────────────────────────────────────────────────

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

// ── Animation variants ─────────────────────────────────────────────────────

const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 420, damping: 32 }
  }
}

const staggerList = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.07 } }
}

// ── FeedstockPicker ────────────────────────────────────────────────────────

function FeedstockPicker({ value, onChange }: {
  value: 'olivine' | 'sodium_hydroxide'
  onChange: (v: 'olivine' | 'sodium_hydroxide') => void
}) {
  return (
    <div className="param-item">
      <div className="param-row" style={{ marginBottom: 8 }}>
        <span className="param-label">Feedstock</span>
      </div>
      <div className="segmented">
        <motion.div
          className="segmented-track"
          animate={{ x: value === 'olivine' ? 0 : '100%' }}
          transition={{ type: 'spring', stiffness: 500, damping: 38 }}
        />
        <button
          className={`segmented-btn ${value === 'olivine' ? 'active' : ''}`}
          onClick={() => onChange('olivine')}
        >Olivine</button>
        <button
          className={`segmented-btn ${value === 'sodium_hydroxide' ? 'active' : ''}`}
          onClick={() => onChange('sodium_hydroxide')}
        >NaOH</button>
      </div>
    </div>
  )
}

// ── ParamSlider ────────────────────────────────────────────────────────────

function ParamSlider({ label, value, min, max, step, onChange, unit }: {
  label: string; value: number; min: number; max: number
  step: number; onChange: (v: number) => void; unit: string
}) {
  return (
    <div className="param-item">
      <div className="param-row">
        <span className="param-label">{label}</span>
        <motion.span
          key={value}
          className="param-value"
          initial={{ scale: 1.18, opacity: 0.55 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 520, damping: 22 }}
        >
          {value}<span className="param-unit">{unit}</span>
        </motion.span>
      </div>
      <SliderPrimitive.Root
        className="slider-root"
        min={min} max={max} step={step} value={[value]}
        onValueChange={([v]) => onChange(v)}
      >
        <SliderPrimitive.Track className="slider-track">
          <SliderPrimitive.Range className="slider-range" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="slider-thumb" aria-label={label} />
      </SliderPrimitive.Root>
    </div>
  )
}

// ── SimulationPanel ────────────────────────────────────────────────────────

function SimulationPanel({ onRun, isLoading, result }: {
  onRun: (p: SimulationParams) => void; isLoading: boolean; result?: SimulationResult
}) {
  const [vesselSpeed, setVesselSpeed] = useState(5.0)
  const [dischargeRate, setDischargeRate] = useState(0.5)
  const [feedstock, setFeedstock] = useState<'olivine' | 'sodium_hydroxide'>('olivine')

  return (
    <div className="panel">
      <div className="panel-label">Mission Control</div>

      <ParamSlider
        label="Vessel Speed" value={vesselSpeed}
        min={1} max={15} step={0.5} unit="m/s"
        onChange={setVesselSpeed}
      />
      <ParamSlider
        label="Discharge Rate" value={dischargeRate}
        min={0.01} max={1.0} step={0.01} unit="m³/s"
        onChange={setDischargeRate}
      />

      <FeedstockPicker value={feedstock} onChange={setFeedstock} />

      <motion.button
        className="run-btn"
        onClick={() => onRun({
          vessel: { vessel_speed: vesselSpeed, discharge_rate: dischargeRate },
          feedstock: { feedstock_type: feedstock },
          ocean: { temperature: 15.0, salinity: 35.0 }
        })}
        disabled={isLoading}
        whileHover={{ scale: isLoading ? 1 : 1.015 }}
        whileTap={{ scale: isLoading ? 1 : 0.985 }}
      >
        {isLoading ? 'Simulating…' : 'Run Simulation'}
      </motion.button>

      <AnimatePresence>
        {result && (
          <motion.div
            className={`result-card ${result.status}`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          >
            <div className="result-header">
              <div className={`result-dot ${result.status}`} />
              <span className={`result-title ${result.status}`}>
                {result.status === 'safe' ? 'Deployment Safe' : 'Threshold Exceeded'}
              </span>
            </div>
            <div className="result-rows">
              <div className="result-row">
                <span className="result-row-label">Ω aragonite</span>
                <span className="result-row-val">{result.summary.max_aragonite_saturation.toFixed(2)}</span>
              </div>
              <div className="result-row">
                <span className="result-row-label">Total alkalinity</span>
                <span className="result-row-val">{result.summary.max_total_alkalinity.toFixed(0)} µmol/kg</span>
              </div>
              <div className="result-row">
                <span className="result-row-label">Data source</span>
                <span className="result-row-val">{result.source}</span>
              </div>
            </div>
            {result.safety_failures.length > 0 && (
              <div className="result-failures">
                {result.safety_failures.map((f, i) => (
                  <div key={i} className="failure-item">⚠ {f}</div>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── AIPanel ────────────────────────────────────────────────────────────────

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
          simulation_result: {
            summary: result.summary,
            params: { feedstock_type: 'olivine', temperature: 15, discharge_rate: 0.1 }
          },
          analysis_type: 'full'
        })
      })
      if (!res.ok) throw new Error()
      setAnalysis(await res.json())
    } catch {
      setError('Analysis failed — is the backend running?')
    } finally {
      setIsAnalyzing(false)
    }
  }

  return (
    <div className="panel">
      <div className="panel-label">AI Analysis</div>
      <motion.button
        className="analyze-btn"
        onClick={analyze}
        disabled={!result || isAnalyzing}
        whileHover={{ scale: (!result || isAnalyzing) ? 1 : 1.01 }}
        whileTap={{ scale: (!result || isAnalyzing) ? 1 : 0.99 }}
      >
        {isAnalyzing ? 'Analyzing with Gemma…' : 'Analyze Results'}
      </motion.button>

      {error && <div className="error-pill">{error}</div>}

      <AnimatePresence>
        {analysis && (
          <motion.div
            className="analysis-body"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          >
            <div>
              <div className="analysis-block-label">Safety</div>
              <p className="analysis-text">{analysis.safety_assessment}</p>
            </div>
            <div>
              <div className="analysis-block-label">CO₂ Projection</div>
              <p className="analysis-text">{analysis.co2_projection}</p>
            </div>
            <div>
              <div className="analysis-block-label">Recommendations</div>
              <ul className="analysis-list">
                {analysis.recommendations.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
            <div className="analysis-footer">
              <span>{analysis.model_used}</span>
              <span>{(analysis.confidence * 100).toFixed(0)}% confidence</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── FleetPanel ─────────────────────────────────────────────────────────────

function FleetPanel({ ships }: { ships?: ShipStatus[] }) {
  if (!ships) return null
  const totalCO2 = ships.reduce((sum, s) => sum + s.co2_removed_tons, 0)

  return (
    <div className="panel">
      <div className="panel-label">Fleet</div>

      <div className="fleet-stats">
        <div className="stat-card">
          <div className="stat-value">{ships.length}</div>
          <div className="stat-label">Ships</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalCO2.toFixed(0)}</div>
          <div className="stat-label">Tons CO₂</div>
        </div>
      </div>

      <motion.div
        className="ship-list"
        variants={staggerList}
        initial="hidden"
        animate="show"
      >
        {ships.map(ship => (
          <motion.div key={ship.ship_id} variants={fadeUp} className="ship-card">
            <div className={`ship-pip ${ship.status}`} />
            <div className="ship-info">
              <div className="ship-name">{ship.name}</div>
              <div className="ship-meta">
                <span className={`ship-status ${ship.status}`}>{ship.status}</span>
                <span className="ship-sep">·</span>
                <span className="ship-co2">{ship.co2_removed_tons.toFixed(1)} t CO₂</span>
              </div>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </div>
  )
}

// ── Ship Marker SVG ────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  active:    '#4ade80',
  deploying: '#00c8f0',
  idle:      '#fbbf24',
}

function ShipMarker({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? '#6b7a8d'

  return (
    <div className="ship-marker-wrap">
      {status === 'deploying' && (
        <div
          className="ship-pulse-ring"
          style={{ background: color, width: 28, height: 28 }}
        />
      )}
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        {/* Outer ring */}
        <circle cx="14" cy="14" r="13" fill={`${color}18`} stroke={color} strokeWidth="1.3" />
        {/* Hull — top-down vessel shape, bow pointing up */}
        <path
          d="M14 6 C11.5 6 10 8 10 10.5 L10 18.5 C10 20 11.8 21.5 14 21.5 C16.2 21.5 18 20 18 18.5 L18 10.5 C18 8 16.5 6 14 6 Z"
          fill={color}
          fillOpacity="0.85"
        />
        {/* Bridge / superstructure */}
        <rect x="11.5" y="12" width="5" height="4" rx="1" fill="rgba(0,0,0,0.45)" />
        {/* Bow centerline */}
        <line x1="14" y1="6" x2="14" y2="9.5" stroke="white" strokeWidth="1.2" strokeOpacity="0.55" strokeLinecap="round" />
        {/* Port & starboard lights */}
        <circle cx="10.5" cy="15" r="1" fill="white" fillOpacity="0.35" />
        <circle cx="17.5" cy="15" r="1" fill="white" fillOpacity="0.35" />
      </svg>
    </div>
  )
}

// ── Map layers ─────────────────────────────────────────────────────────────

function PlumeHeatmap({ visible, simulationData }: {
  visible: boolean; simulationData?: SimulationResult
}) {
  const baseLon = -118.8
  const baseLat = 33.5

  const features = (() => {
    if (!visible) return []
    if (simulationData?.fields?.alkalinity) {
      const alk = simulationData.fields.alkalinity as number[][]
      const gs = alk.length
      return alk.flatMap((row, i) =>
        row.map((val, j) => {
          const intensity = Math.max(0, Math.min(1, (val - 2300) / 1200))
          if (intensity <= 0.05) return null
          return {
            type: 'Feature' as const,
            properties: { intensity },
            geometry: {
              type: 'Point' as const,
              coordinates: [baseLon + (j - gs / 2) * 0.008, baseLat + (i - gs / 2) * 0.004]
            }
          }
        }).filter(Boolean)
      )
    }
    return Array.from({ length: 80 }, (_, i) => {
      const angle = (i / 80) * Math.PI * 2
      const dist = Math.random() * 0.04
      return {
        type: 'Feature' as const,
        properties: { intensity: Math.exp(-dist * 30) * (0.5 + Math.random() * 0.5) },
        geometry: {
          type: 'Point' as const,
          coordinates: [baseLon + Math.cos(angle) * dist, baseLat + Math.sin(angle) * dist * 0.5]
        }
      }
    })
  })()

  return (
    <Source id="plume" type="geojson" data={{ type: 'FeatureCollection', features: features as any[] }}>
      <Layer
        id="plume-heat"
        type="heatmap"
        paint={{
          'heatmap-weight': ['get', 'intensity'],
          'heatmap-intensity': 1.5,
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,255,0)',
            0.1, 'rgba(0,100,255,0.3)',
            0.3, 'rgba(0,200,255,0.5)',
            0.5, 'rgba(0,255,200,0.6)',
            0.7, 'rgba(100,255,100,0.7)',
            0.85, 'rgba(255,255,0,0.8)',
            1, 'rgba(255,100,0,0.9)'
          ],
          'heatmap-radius': 40,
          'heatmap-opacity': 0.85
        }}
      />
    </Source>
  )
}

function MPAOverlay() {
  const data = {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        properties: { name: 'Channel Islands NMS' },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[
            [-120.42, 33.97], [-120.28, 34.14], [-120.05, 34.23],
            [-119.76, 34.22], [-119.48, 34.16], [-119.18, 34.06],
            [-119.02, 33.91], [-119.10, 33.74], [-119.36, 33.67],
            [-119.64, 33.69], [-119.91, 33.75], [-120.18, 33.83],
            [-120.38, 33.91], [-120.42, 33.97]
          ]]
        }
      },
      {
        type: 'Feature' as const,
        properties: { name: 'Point Dume SMCA' },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[
            [-118.858, 34.013], [-118.832, 34.038],
            [-118.800, 34.031], [-118.772, 34.010],
            [-118.765, 33.981], [-118.788, 33.964],
            [-118.822, 33.961], [-118.848, 33.978],
            [-118.858, 34.001], [-118.858, 34.013]
          ]]
        }
      },
      {
        type: 'Feature' as const,
        properties: { name: 'Santa Monica Bay CA' },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[
            [-118.660, 34.022], [-118.608, 34.058],
            [-118.548, 34.061], [-118.490, 34.038],
            [-118.458, 33.995], [-118.476, 33.955],
            [-118.530, 33.931], [-118.594, 33.928],
            [-118.645, 33.951], [-118.668, 33.990],
            [-118.660, 34.022]
          ]]
        }
      }
    ]
  }

  return (
    <Source id="mpa" type="geojson" data={data}>
      {/* Outer soft glow */}
      <Layer
        id="mpa-glow"
        type="line"
        paint={{
          'line-color': '#f87171',
          'line-width': 14,
          'line-blur': 10,
          'line-opacity': 0.12
        }}
      />
      {/* Fill */}
      <Layer
        id="mpa-fill"
        type="fill"
        paint={{ 'fill-color': '#f87171', 'fill-opacity': 0.07 }}
      />
      {/* Dotted border */}
      <Layer
        id="mpa-outline"
        type="line"
        paint={{
          'line-color': '#f87171',
          'line-width': 1.8,
          'line-dasharray': [1.5, 2.5],
          'line-opacity': 0.7
        }}
      />
    </Source>
  )
}

function MapLegend({ showPlume }: { showPlume: boolean }) {
  return (
    <div className="map-legend">
      <div className="legend-row">
        <div className="legend-swatch" />
        <span>Marine Protected Area</span>
      </div>
      <AnimatePresence>
        {showPlume && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div className="legend-rule" />
            <div className="legend-grad-label">Alkalinity (µmol/kg)</div>
            <div className="legend-grad-bar" />
            <div className="legend-ticks">
              <span>2300</span><span>2900</span><span>3500</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function ImpactMetrics({ result, fleet }: { result?: SimulationResult; fleet?: ShipStatus[] }) {
  const totalCO2 = fleet?.reduce((sum, s) => sum + s.co2_removed_tons, 0) ?? 0
  const estCO2 = result
    ? ((result.summary.max_total_alkalinity - 2300) * 0.8 * 44 * 25) / 1e6
    : 0

  return (
    <div className="impact-overlay">
      <div className="impact-chip">
        <div className="impact-val">{totalCO2.toFixed(0)}</div>
        <div className="impact-lbl">Fleet CO₂ Removed</div>
      </div>
      <AnimatePresence>
        {result && (
          <>
            <motion.div
              className="impact-chip"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            >
              <div className={`impact-val ${result.status}`}>
                {result.status === 'safe' ? 'SAFE' : 'UNSAFE'}
              </div>
              <div className="impact-lbl">Deployment Status</div>
            </motion.div>
            <motion.div
              className="impact-chip"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28, delay: 0.05 }}
            >
              <div className="impact-val">+{Math.max(0, estCO2).toFixed(1)}</div>
              <div className="impact-lbl">Est. CO₂ Impact (t)</div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── AppContent ─────────────────────────────────────────────────────────────

function AppContent() {
  const [simulationResult, setSimulationResult] = useState<SimulationResult>()
  const [showPlume, setShowPlume] = useState(false)

  const { data: fleet } = useQuery<ShipStatus[]>({
    queryKey: ['fleet'],
    queryFn: () => fetch(`${API_URL}/fleet`).then(r => r.json()),
    refetchInterval: 10000
  })

  const simulate = useMutation({
    mutationFn: async (params: SimulationParams) => {
      const res = await fetch(`${API_URL}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      })
      if (!res.ok) throw new Error('Simulation failed')
      return res.json() as Promise<SimulationResult>
    },
    onSuccess: (data) => {
      setSimulationResult(data)
      setShowPlume(true)
    },
    onError: () => alert('Simulation failed — is the backend running?')
  })

  return (
    <div className="app">
      {/* Header */}
      <motion.header
        className="header"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30, delay: 0.05 }}
      >
        <div className="header-left">
          <motion.span
            className="header-logo"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15, duration: 0.35 }}
          >
            The Tiered Edge Fleet
          </motion.span>
          <motion.div
            className="header-sep"
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ delay: 0.25, duration: 0.25 }}
          />
          <motion.span
            className="header-sub"
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3, duration: 0.35 }}
          >
            Ocean Alkalinity Enhancement
          </motion.span>
        </div>
        <motion.div
          className="header-right"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.4 }}
        >
          <div className="online-dot" />
          <span>System Online</span>
        </motion.div>
      </motion.header>

      <main>
        {/* Left sidebar */}
        <motion.div
          className="sidebar sidebar-left"
          initial={{ x: -280, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 280, damping: 30 }}
        >
          <SimulationPanel
            onRun={(p) => simulate.mutate(p)}
            isLoading={simulate.isPending}
            result={simulationResult}
          />
          <AIPanel result={simulationResult} />
        </motion.div>

        {/* Map */}
        <div className="map-container">
          <Map
            initialViewState={{ longitude: -119.1, latitude: 33.55, zoom: 8.5 }}
            style={{ width: '100%', height: '100%' }}
            mapStyle="mapbox://styles/mapbox/dark-v11"
            mapboxAccessToken={MAPBOX_TOKEN}
          >
            <MPAOverlay />
            <PlumeHeatmap visible={showPlume} simulationData={simulationResult} />
            {fleet?.map((ship) => (
              <Marker key={ship.ship_id} longitude={ship.position.lon} latitude={ship.position.lat} anchor="center">
                <ShipMarker status={ship.status} />
              </Marker>
            ))}
          </Map>
          <MapLegend showPlume={showPlume} />
          <ImpactMetrics result={simulationResult} fleet={fleet} />
        </div>

        {/* Right sidebar */}
        <motion.div
          className="sidebar sidebar-right"
          initial={{ x: 280, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 280, damping: 30 }}
        >
          <FleetPanel ships={fleet} />
        </motion.div>
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
