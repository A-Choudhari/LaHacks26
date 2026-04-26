import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { SimulationResult, ShipStatus } from '../../types'

interface HistoryPoint {
  ts: number
  arag: number
  alk: number
  co2est: number
}

interface LiveImpactPanelProps {
  result?: SimulationResult
  fleet?: ShipStatus[]
  history?: HistoryPoint[]
}

// Smooth animated counter
function AnimatedNumber({ value, decimals = 1, suffix = '' }: { value: number; decimals?: number; suffix?: string }) {
  const prev = useRef(value)
  const [display, setDisplay] = useState(value)

  useEffect(() => {
    const from = prev.current
    prev.current = value
    if (from === value) return
    const start = Date.now()
    const dur = 600
    const tick = () => {
      const t = Math.min((Date.now() - start) / dur, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(from + (value - from) * eased)
      if (t < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [value])

  return <>{display.toFixed(decimals)}{suffix}</>
}

// Mini sparkline SVG
function Sparkline({ points, color = '#00c8f0', height = 28 }: { points: number[]; color?: string; height?: number }) {
  if (points.length < 2) return null
  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = max - min || 1
  const w = 80
  const pad = 2

  const coords = points.map((v, i) => {
    const x = pad + (i / (points.length - 1)) * (w - pad * 2)
    const y = pad + (1 - (v - min) / range) * (height - pad * 2)
    return `${x},${y}`
  })

  return (
    <svg width={w} height={height} style={{ overflow: 'visible' }}>
      <polyline
        points={coords.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.7"
      />
      {/* last point dot */}
      <circle
        cx={parseFloat(coords[coords.length - 1].split(',')[0])}
        cy={parseFloat(coords[coords.length - 1].split(',')[1])}
        r="2.5"
        fill={color}
      />
    </svg>
  )
}

// Safety gauge bar
function SafetyBar({ value, limit, label }: { value: number; limit: number; label: string }) {
  const pct = Math.min(100, (value / limit) * 100)
  const color = pct < 60 ? 'var(--success)' : pct < 85 ? 'var(--warning)' : 'var(--danger)'

  return (
    <div className="safety-bar-row">
      <div className="safety-bar-labels">
        <span className="safety-bar-lbl">{label}</span>
        <span className="safety-bar-val" style={{ color }}>{value.toFixed(2)}<span className="safety-bar-limit"> / {limit}</span></span>
      </div>
      <div className="safety-bar-track">
        <motion.div
          className="safety-bar-fill"
          style={{ background: color }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 200, damping: 28 }}
        />
      </div>
    </div>
  )
}

export function LiveImpactPanel({ result, fleet, history = [] }: LiveImpactPanelProps) {
  const totalCO2 = fleet?.reduce((sum, s) => sum + s.co2_removed_tons, 0) ?? 0
  const deploying = fleet?.filter(s => s.status === 'deploying').length ?? 0
  const active = fleet?.filter(s => s.status === 'active').length ?? 0

  const maxArag = result?.summary.max_aragonite_saturation ?? 0
  const maxAlk = result?.summary.max_total_alkalinity ?? 0
  const baseline = result?.ocean_conditions?.baseline_alkalinity_umol_kg ?? 2280
  const deltaAlk = Math.max(0, maxAlk - baseline)
  const temp = result?.ocean_conditions?.temperature_c ?? 15
  const mld = result?.ocean_conditions?.mixed_layer_depth_m ?? 60

  // Estimated CO₂ removal from alkalinity increase (simplified OAE formula)
  const tempEff = Math.max(0.4, 0.8 - 0.012 * Math.max(0, temp - 15))
  const plumeArea = 25 // km² estimate
  const estCO2 = (deltaAlk * tempEff * 44 * plumeArea * 1e6 * mld * 1025) / 1e15

  // pH change estimate (Revelle: ~0.0013 pH per µmol/kg TA increase)
  const deltaPH = deltaAlk * 0.0013

  // Sparkline data
  const aragHistory = history.map(p => p.arag)
  const alkHistory = history.map(p => p.alk)
  const co2History = history.map(p => p.co2est)

  return (
    <div className="panel" style={{ flex: 1 }}>
      <div className="panel-label">Live Impact</div>

      {/* Fleet summary chips */}
      <div className="impact-fleet-row">
        <div className="impact-fleet-chip">
          <span className="ifc-val">{totalCO2.toFixed(0)}</span>
          <span className="ifc-lbl">Fleet CO₂ (t)</span>
        </div>
        <div className="impact-fleet-chip">
          <span className="ifc-val deploy">{deploying}</span>
          <span className="ifc-lbl">Deploying</span>
        </div>
        <div className="impact-fleet-chip">
          <span className="ifc-val ok">{active}</span>
          <span className="ifc-lbl">Active</span>
        </div>
      </div>

      <AnimatePresence>
        {result ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 360, damping: 30 }}
          >
            {/* Safety status banner */}
            <div className={`impact-status-banner ${result.status}`}>
              <div className={`impact-status-dot ${result.status}`} />
              <span>{result.status === 'safe' ? 'All safety thresholds nominal' : 'Safety threshold exceeded'}</span>
              {result.mrv_hash && (
                <span className="impact-mrv-tag">✓ MRV:{result.mrv_hash.slice(0, 6)}</span>
              )}
            </div>

            {/* Chemistry safety bars */}
            <div className="impact-section-head">Chemistry Thresholds</div>
            <SafetyBar value={maxArag} limit={30.0} label="Ω Aragonite" />
            <SafetyBar value={maxAlk / 100} limit={35.0} label="TA ×100 µmol/kg" />

            {/* Key metrics grid */}
            <div className="impact-section-head" style={{ marginTop: 16 }}>Impact Metrics</div>
            <div className="impact-metrics-grid">
              <div className="impact-metric-tile">
                <div className="imt-val deploy">
                  <AnimatedNumber value={estCO2} decimals={2} />
                </div>
                <div className="imt-lbl">Est. CO₂ removed (t)</div>
              </div>
              <div className="impact-metric-tile">
                <div className="imt-val ok">
                  +<AnimatedNumber value={deltaPH * 1000} decimals={1} />
                </div>
                <div className="imt-lbl">ΔpH ×10⁻³</div>
              </div>
              <div className="impact-metric-tile">
                <div className="imt-val">
                  +<AnimatedNumber value={deltaAlk} decimals={0} />
                </div>
                <div className="imt-lbl">ΔTA µmol/kg</div>
              </div>
              <div className="impact-metric-tile">
                <div className="imt-val">
                  <AnimatedNumber value={(tempEff * 100)} decimals={0} suffix="%" />
                </div>
                <div className="imt-lbl">OAE efficiency</div>
              </div>
            </div>

            {/* Sparklines row */}
            {history.length >= 2 && (
              <div className="impact-sparklines">
                <div className="sparkline-item">
                  <Sparkline points={aragHistory} color="var(--warning)" />
                  <span className="sparkline-lbl">Ω Arag trend</span>
                </div>
                <div className="sparkline-item">
                  <Sparkline points={alkHistory} color="var(--deploy)" />
                  <span className="sparkline-lbl">TA trend</span>
                </div>
                <div className="sparkline-item">
                  <Sparkline points={co2History} color="var(--success)" />
                  <span className="sparkline-lbl">CO₂ trend</span>
                </div>
              </div>
            )}

            {/* Ocean conditions */}
            {result.ocean_conditions && (
              <div className="impact-ocean-block">
                <div className="impact-section-head">Live Ocean State</div>
                <div className="impact-ocean-grid">
                  <div className="iog-item">
                    <span className="iog-val">{result.ocean_conditions.temperature_c.toFixed(1)}°C</span>
                    <span className="iog-lbl">SST</span>
                  </div>
                  <div className="iog-item">
                    <span className="iog-val">{result.ocean_conditions.salinity_psu.toFixed(1)}</span>
                    <span className="iog-lbl">Salinity</span>
                  </div>
                  <div className="iog-item">
                    <span className="iog-val">{result.ocean_conditions.mixed_layer_depth_m.toFixed(0)}m</span>
                    <span className="iog-lbl">MLD</span>
                  </div>
                  <div className="iog-item">
                    <span className="iog-val">{result.ocean_conditions.baseline_alkalinity_umol_kg.toFixed(0)}</span>
                    <span className="iog-lbl">Base TA</span>
                  </div>
                </div>
              </div>
            )}

            {result.safety_failures.length > 0 && (
              <div className="result-failures" style={{ marginTop: 12 }}>
                {result.safety_failures.map((f, i) => (
                  <div key={i} className="failure-item">⚠ {f}</div>
                ))}
              </div>
            )}
          </motion.div>
        ) : (
          <div className="impact-empty">
            Run a simulation to see live impact metrics
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
