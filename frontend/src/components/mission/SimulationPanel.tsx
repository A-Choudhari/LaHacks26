import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ParamSlider } from '../ui/ParamSlider'
import { FeedstockPicker } from '../ui/FeedstockPicker'
import type { SimulationParams, SimulationResult } from '../../types'

interface SimulationPanelProps {
  onRun: (p: SimulationParams) => void
  isLoading: boolean
  result?: SimulationResult
  isRunning?: boolean
  elapsedLabel?: string
  onToggleRunning?: () => void
  onReset?: () => void
}

function sourceLabel(src: string): string {
  if (src.includes('noaa_erddap')) return 'NOAA ERDDAP + CalCOFI'
  if (src === 'calcofi') return 'CalCOFI stations'
  return 'offline defaults'
}

function sourceBadgeClass(src: string): string {
  if (src === 'live') return 'badge-live'
  if (src === 'live-conditions') return 'badge-live-cond'
  return 'badge-mock'
}

export function SimulationPanel({ onRun, isLoading, result, isRunning, elapsedLabel, onToggleRunning, onReset }: SimulationPanelProps) {
  const [vesselSpeed, setVesselSpeed] = useState(5.0)
  const [dischargeRate, setDischargeRate] = useState(0.5)
  const [feedstock, setFeedstock] = useState<'olivine' | 'sodium_hydroxide'>('olivine')

  // Advanced ocean overrides
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [useManualOcean, setUseManualOcean] = useState(false)
  const [temperature, setTemperature] = useState(15.0)
  const [salinity, setSalinity] = useState(35.0)
  const [mld, setMld] = useState(60.0)

  const handleRun = () => {
    onRun({
      vessel: { vessel_speed: vesselSpeed, discharge_rate: dischargeRate },
      feedstock: { feedstock_type: feedstock },
      ocean: useManualOcean
        ? { temperature, salinity, mixed_layer_depth: mld }
        : { temperature: 15.0, salinity: 35.0 },
    })
  }

  // Show live ocean data from last result when not using manual
  const liveTemp = result?.ocean_conditions?.temperature_c
  const liveSal = result?.ocean_conditions?.salinity_psu
  const liveMld = result?.ocean_conditions?.mixed_layer_depth_m

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

      {/* Advanced ocean settings toggle */}
      <button
        className="advanced-toggle"
        onClick={() => setShowAdvanced(s => !s)}
      >
        <span>Ocean Conditions</span>
        <span className={`adv-chevron ${showAdvanced ? 'open' : ''}`}>›</span>
      </button>

      <AnimatePresence>
        {showAdvanced && (
          <motion.div
            className="advanced-section"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 36 }}
          >
            {/* Toggle: live vs manual */}
            <div className="ocean-mode-row">
              <span className="ocean-mode-label">Source</span>
              <div className="ocean-mode-toggle">
                <button
                  className={`ocean-mode-btn ${!useManualOcean ? 'active' : ''}`}
                  onClick={() => setUseManualOcean(false)}
                >
                  Live NOAA
                </button>
                <button
                  className={`ocean-mode-btn ${useManualOcean ? 'active' : ''}`}
                  onClick={() => setUseManualOcean(true)}
                >
                  Manual
                </button>
              </div>
            </div>

            {!useManualOcean && liveTemp != null && (
              <div className="live-ocean-preview">
                <div className="live-ocean-chip">
                  <span className="loc-val">{liveTemp.toFixed(1)}°C</span>
                  <span className="loc-lbl">SST</span>
                </div>
                <div className="live-ocean-chip">
                  <span className="loc-val">{liveSal?.toFixed(1) ?? '—'}</span>
                  <span className="loc-lbl">PSU</span>
                </div>
                <div className="live-ocean-chip">
                  <span className="loc-val">{liveMld?.toFixed(0) ?? '—'}m</span>
                  <span className="loc-lbl">MLD</span>
                </div>
              </div>
            )}

            {useManualOcean && (
              <div className="manual-ocean-sliders">
                <ParamSlider
                  label="Temperature" value={temperature}
                  min={-2} max={35} step={0.5} unit="°C"
                  onChange={setTemperature}
                />
                <ParamSlider
                  label="Salinity" value={salinity}
                  min={30} max={40} step={0.1} unit="PSU"
                  onChange={setSalinity}
                />
                <ParamSlider
                  label="Mixed Layer Depth" value={mld}
                  min={10} max={200} step={5} unit="m"
                  onChange={setMld}
                />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        className="run-btn"
        onClick={handleRun}
        disabled={isLoading}
        whileHover={{ scale: isLoading ? 1 : 1.015 }}
        whileTap={{ scale: isLoading ? 1 : 0.985 }}
      >
        {isLoading ? 'Fetching conditions & simulating…' : 'Run Simulation'}
      </motion.button>

      {onToggleRunning && (
        <div className="sim-controls" data-tour="mc-sim-controls">
          <motion.button
            className={`sim-ctrl-btn ${isRunning ? 'pause' : 'resume'}`}
            onClick={onToggleRunning}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
          >
            {isRunning ? '⏸ Pause' : '▶ Resume'}
          </motion.button>
          {onReset && (
            <motion.button
              className="sim-ctrl-btn reset"
              onClick={onReset}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
            >
              ↺ Reset
            </motion.button>
          )}
        </div>
      )}

      {isRunning && elapsedLabel && (
        <div className="sim-elapsed-row">
          <div className="sim-elapsed-dot" />
          <span className="sim-elapsed-text">Elapsed: {elapsedLabel}</span>
        </div>
      )}

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
              <span className={`source-badge ${sourceBadgeClass(result.source)}`}>
                {result.source}
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
            </div>

            {result.ocean_conditions && (
              <div className="ocean-conditions">
                <div className="ocean-conditions-header">
                  <span className="ocean-source-dot" />
                  <span className="ocean-source-label">
                    {result.ocean_state_source ? sourceLabel(result.ocean_state_source) : 'Ocean data'}
                  </span>
                </div>
                <div className="ocean-conditions-grid">
                  <div className="ocean-cond-item">
                    <span className="ocean-cond-val">{result.ocean_conditions.temperature_c.toFixed(1)}°C</span>
                    <span className="ocean-cond-lbl">SST</span>
                  </div>
                  <div className="ocean-cond-item">
                    <span className="ocean-cond-val">{result.ocean_conditions.salinity_psu.toFixed(1)}</span>
                    <span className="ocean-cond-lbl">PSU</span>
                  </div>
                  <div className="ocean-cond-item">
                    <span className="ocean-cond-val">{result.ocean_conditions.mixed_layer_depth_m.toFixed(0)}m</span>
                    <span className="ocean-cond-lbl">MLD</span>
                  </div>
                  <div className="ocean-cond-item">
                    <span className="ocean-cond-val">{result.ocean_conditions.baseline_alkalinity_umol_kg.toFixed(0)}</span>
                    <span className="ocean-cond-lbl">TA base</span>
                  </div>
                </div>
              </div>
            )}

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
