import { useState, useRef, useEffect, useCallback } from 'react'
import { QueryClient, QueryClientProvider, useQuery, useMutation } from '@tanstack/react-query'
import Map, { Source, Layer, Marker, MapRef } from 'react-map-gl'
import { motion, AnimatePresence } from 'framer-motion'
import * as SliderPrimitive from '@radix-ui/react-slider'
import 'mapbox-gl/dist/mapbox-gl.css'
import { PlumeThreeLayer } from './ThreeLayer'

const queryClient = new QueryClient()
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8001'
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || ''

// ── Types ──────────────────────────────────────────────────────────────────

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

// ── Static GeoJSON data ────────────────────────────────────────────────────

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
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[
          [-120.42, 33.97], [-120.28, 34.14], [-120.05, 34.23],
          [-119.76, 34.22], [-119.48, 34.16], [-119.18, 34.06],
          [-119.02, 33.91], [-119.10, 33.74], [-119.36, 33.67],
          [-119.64, 33.69], [-119.91, 33.75], [-120.18, 33.83],
          [-120.38, 33.91], [-120.42, 33.97]
        ]]
      },
    },
    {
      type: 'Feature' as const,
      properties: { name: 'Point Dume SMCA', type: 'conservation' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[
          [-118.858, 34.013], [-118.832, 34.038],
          [-118.800, 34.031], [-118.772, 34.010],
          [-118.765, 33.981], [-118.788, 33.964],
          [-118.822, 33.961], [-118.848, 33.978],
          [-118.858, 34.001], [-118.858, 34.013]
        ]]
      },
    },
    {
      type: 'Feature' as const,
      properties: { name: 'Santa Monica Bay CA', type: 'conservation' },
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
      },
    },
  ],
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

// ── Shared sub-components ──────────────────────────────────────────────────

function MPAOverlay() {
  return (
    <Source id="mpa" type="geojson" data={MPA_DATA}>
      <Layer id="mpa-glow" type="line" paint={{ 'line-color': '#f87171', 'line-width': 14, 'line-blur': 10, 'line-opacity': 0.12 }} />
      <Layer id="mpa-fill" type="fill" paint={{ 'fill-color': '#f87171', 'fill-opacity': 0.07 }} />
      <Layer id="mpa-outline" type="line" paint={{ 'line-color': '#f87171', 'line-width': 1.8, 'line-dasharray': [1.5, 2.5], 'line-opacity': 0.7 }} />
    </Source>
  )
}

function PlumeHeatmap({ visible, simulationData }: { visible: boolean; simulationData?: SimulationResult }) {
  const baseLon = -118.2437
  const baseLat = 34.0522

  const features = (() => {
    if (!visible) return []
    if (simulationData?.fields?.alkalinity) {
      const alk = simulationData.fields.alkalinity
      const gs = alk.length
      return alk.flatMap((row, i) =>
        row.map((val, j) => {
          const intensity = Math.max(0, Math.min(1, (val - 2300) / 1200))
          if (intensity <= 0.05) return null
          return {
            type: 'Feature' as const,
            properties: { intensity },
            geometry: { type: 'Point' as const, coordinates: [baseLon + (j - gs / 2) * 0.008, baseLat + (i - gs / 2) * 0.004] },
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
        geometry: { type: 'Point' as const, coordinates: [baseLon + Math.cos(angle) * dist, baseLat + Math.sin(angle) * dist * 0.5] },
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
          'heatmap-opacity': 0.85,
        }}
      />
    </Source>
  )
}

// ── Mode Selector ──────────────────────────────────────────────────────────

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
          analysis_type: 'full',
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

      <motion.div className="ship-list" variants={staggerList} initial="hidden" animate="show">
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
        <div className="ship-pulse-ring" style={{ background: color, width: 28, height: 28 }} />
      )}
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
        <circle cx="14" cy="14" r="13" fill={`${color}18`} stroke={color} strokeWidth="1.3" />
        <path
          d="M14 6 C11.5 6 10 8 10 10.5 L10 18.5 C10 20 11.8 21.5 14 21.5 C16.2 21.5 18 20 18 18.5 L18 10.5 C18 8 16.5 6 14 6 Z"
          fill={color} fillOpacity="0.85"
        />
        <rect x="11.5" y="12" width="5" height="4" rx="1" fill="rgba(0,0,0,0.45)" />
        <line x1="14" y1="6" x2="14" y2="9.5" stroke="white" strokeWidth="1.2" strokeOpacity="0.55" strokeLinecap="round" />
        <circle cx="10.5" cy="15" r="1" fill="white" fillOpacity="0.35" />
        <circle cx="17.5" cy="15" r="1" fill="white" fillOpacity="0.35" />
      </svg>
    </div>
  )
}

// ── Map Legend ─────────────────────────────────────────────────────────────

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

// ── Impact Metrics ─────────────────────────────────────────────────────────

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
            {result.mrv_hash && (
              <motion.div
                className="impact-chip"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 400, damping: 28, delay: 0.1 }}
              >
                <div className="impact-val mrv-value">✓ MRV</div>
                <div className="impact-lbl">Proof: {result.mrv_hash.slice(0, 8)}…</div>
              </motion.div>
            )}
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Mode 1: Global Intelligence ────────────────────────────────────────────

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
          <div className="panel-label">Global Intelligence</div>
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
              <div className="analysis-block-label">CalCOFI Stations ({stations.length})</div>
              <p>Avg temp: {(stations.reduce((s, x) => s + x.temperature_c, 0) / stations.length).toFixed(1)}°C</p>
              <p>Avg salinity: {(stations.reduce((s, x) => s + x.salinity_psu, 0) / stations.length).toFixed(2)} PSU</p>
            </div>
          )}

          <motion.button
            className="run-btn"
            style={{ marginTop: 16 }}
            onClick={runDiscovery}
            disabled={isDiscovering}
            whileHover={{ scale: isDiscovering ? 1 : 1.015 }}
            whileTap={{ scale: isDiscovering ? 1 : 0.985 }}
          >
            {isDiscovering ? 'Scanning zones…' : 'Discover Optimal Zones'}
          </motion.button>

          <AnimatePresence>
            {discoveryZones.length > 0 && (
              <motion.div
                className="discovery-results"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              >
                <div className="analysis-block-label">AI Recommendations ({discoveryZones.length})</div>
                {discoveryZones.map((z, i) => (
                  <div key={i} className={`zone-card zone-${z.score > 0.85 ? 'high' : z.score > 0.7 ? 'med' : 'low'}`}>
                    <div className="zone-name">Site #{i + 1}</div>
                    <div className="zone-score">Score: {(z.score * 100).toFixed(0)}%</div>
                    <div className="zone-reason">{z.reason}</div>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
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
          <Source id="oae-zones" type="geojson" data={OAE_ZONES}>
            <Layer id="oae-zones-fill" type="fill" paint={{ 'fill-color': ['interpolate',['linear'],['get','score'],0.0,'#ef4444',0.7,'#f59e0b',0.9,'#22c55e'], 'fill-opacity': 0.25 }} />
            <Layer id="oae-zones-outline" type="line" paint={{ 'line-color': ['interpolate',['linear'],['get','score'],0.0,'#ef4444',0.7,'#f59e0b',0.9,'#22c55e'], 'line-width': 2 }} />
          </Source>

          {stations && (
            <Source id="calcofi" type="geojson" data={stationsGeoJSON}>
              <Layer id="calcofi-circles" type="circle" paint={{ 'circle-radius': 6, 'circle-color': ['interpolate',['linear'],['get','temp'],10,'#3b82f6',18,'#f59e0b',25,'#ef4444'], 'circle-opacity': 0.85, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 }} />
            </Source>
          )}

          <MPAOverlay />

          {fleet?.map(ship => (
            <Marker key={ship.ship_id} longitude={ship.position.lon} latitude={ship.position.lat} anchor="center">
              <ShipMarker status={ship.status} />
            </Marker>
          ))}

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
          <div className="legend-grad-label">OAE Zone Suitability</div>
          <div className="legend-row"><div className="legend-swatch" style={{ background: '#22c55e' }} /><span>High (&gt;85%)</span></div>
          <div className="legend-row"><div className="legend-swatch" style={{ background: '#f59e0b' }} /><span>Medium (70–85%)</span></div>
          <div className="legend-row"><div className="legend-swatch" style={{ background: '#ef4444' }} /><span>Low (&lt;70%)</span></div>
          <div className="legend-row"><div className="legend-swatch mpa" /><span>MPA Boundary</span></div>
          {stations && <>
            <div className="legend-rule" />
            <div className="legend-grad-label">CalCOFI (by temp)</div>
            <div className="legend-row"><div className="legend-swatch circle" style={{ background: '#3b82f6' }} /><span>10°C</span></div>
            <div className="legend-row"><div className="legend-swatch circle" style={{ background: '#ef4444' }} /><span>25°C</span></div>
          </>}
        </div>
      </div>
    </div>
  )
}

// ── Mode 2: Mission Control ────────────────────────────────────────────────

function MissionControlMode({ fleet }: { fleet?: ShipStatus[] }) {
  const [simulationResult, setSimulationResult] = useState<SimulationResult>()
  const [showPlume, setShowPlume] = useState(false)
  const mapRef = useRef<MapRef>(null)
  const threeLayerRef = useRef<PlumeThreeLayer | null>(null)

  const simulate = useMutation({
    mutationFn: async (params: SimulationParams) => {
      const res = await fetch(`${API_URL}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (!res.ok) throw new Error('Simulation failed')
      return res.json() as Promise<SimulationResult>
    },
    onSuccess: (data) => {
      setSimulationResult(data)
      setShowPlume(true)
    },
    onError: () => alert('Simulation failed — is the backend running?'),
  })

  const handleMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap()
    if (!map) return
    const layer = new PlumeThreeLayer(null)
    threeLayerRef.current = layer
    map.addLayer(layer)
  }, [])

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

      <div className="map-container">
        <Map
          ref={mapRef}
          initialViewState={{ longitude: -119.1, latitude: 33.55, zoom: 8.5 }}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          mapboxAccessToken={MAPBOX_TOKEN}
          onLoad={handleMapLoad}
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

      <motion.div
        className="sidebar sidebar-right"
        initial={{ x: 280, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 30 }}
      >
        <FleetPanel ships={fleet} />
      </motion.div>
    </div>
  )
}

// ── Mode 3: Route Planning ─────────────────────────────────────────────────

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
        const d = Math.sqrt(
          ((wp.lat - prev.lat) * 111.32) ** 2 +
          ((wp.lon - prev.lon) * 111.32 * Math.cos(prev.lat * Math.PI / 180)) ** 2
        )
        return total + d
      }, 0)
    : 0

  return (
    <div className="mode-layout">
      <div className="sidebar">
        <div className="panel">
          <div className="panel-label">Route Planning</div>
          <p className="mode-desc">Click the map to add waypoints. Each segment shows projected alkalinity deployment and CO₂ removal.</p>

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

          {waypoints.length > 0 && (
            <motion.button
              className="run-btn"
              style={{ marginTop: 12 }}
              onClick={() => setWaypoints([])}
              whileHover={{ scale: 1.015 }}
              whileTap={{ scale: 0.985 }}
            >
              Clear Route
            </motion.button>
          )}

          <AnimatePresence>
            {waypoints.length >= 2 && (
              <motion.div
                className="segment-list"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 32 }}
              >
                <div className="analysis-block-label">Segments</div>
                {waypoints.slice(1).map((wp, i) => {
                  const prev = waypoints[i]
                  const km = Math.sqrt(
                    ((wp.lat - prev.lat) * 111.32) ** 2 +
                    ((wp.lon - prev.lon) * 111.32 * Math.cos(prev.lat * Math.PI / 180)) ** 2
                  )
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
              </motion.div>
            )}
          </AnimatePresence>

          {traffic && (
            <div className="calcofi-summary" style={{ marginTop: 16 }}>
              <div className="analysis-block-label">Vessel Traffic ({traffic.length})</div>
              {traffic.map((v: any) => (
                <div key={v.vessel_id} className="segment-card">
                  <span className="ship-name">{v.name}</span>
                  <span>{v.vessel_type}</span>
                  <span>{v.speed_kn} kn</span>
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

          {waypoints.length >= 2 && (
            <Source id="route" type="geojson" data={routeGeoJSON}>
              <Layer id="route-line" type="line" paint={{ 'line-color': '#22d3ee', 'line-width': 3, 'line-dasharray': [2, 1] }} />
            </Source>
          )}

          {waypoints.map((wp, i) => (
            <Marker key={i} longitude={wp.lon} latitude={wp.lat}>
              <div className="waypoint-marker">{i + 1}</div>
            </Marker>
          ))}

          {fleet?.map(ship => (
            <Marker key={ship.ship_id} longitude={ship.position.lon} latitude={ship.position.lat} anchor="center">
              <ShipMarker status={ship.status} />
            </Marker>
          ))}

          {traffic?.map((v: any) => (
            <Marker key={v.vessel_id} longitude={v.lon} latitude={v.lat}>
              <div className="traffic-marker" title={`${v.name} (${v.vessel_type})`}>▲</div>
            </Marker>
          ))}
        </Map>

        <div className="map-legend">
          <div className="legend-row"><div className="legend-swatch mpa" /><span>MPA Boundary</span></div>
          <div className="legend-row"><div style={{ width: 20, height: 3, background: '#22d3ee', borderRadius: 1 }} /><span>Planned Route</span></div>
          <div className="legend-row"><div className="waypoint-marker" style={{ width: 18, height: 18, fontSize: '0.65rem' }}>W</div><span>Waypoint</span></div>
          <div className="legend-row"><div className="traffic-marker" style={{ color: '#f59e0b', fontSize: '0.7rem' }}>▲</div><span>AIS Vessel</span></div>
        </div>
      </div>
    </div>
  )
}

// ── Root App ───────────────────────────────────────────────────────────────

function AppContent() {
  const [mode, setMode] = useState<AppMode>('mission')

  const { data: fleet } = useQuery<ShipStatus[]>({
    queryKey: ['fleet'],
    queryFn: () => fetch(`${API_URL}/fleet`).then(r => r.json()),
    refetchInterval: 10000,
  })

  return (
    <div className="app">
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
        <div className="header-center">
          <ModeSelector mode={mode} onModeChange={setMode} />
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