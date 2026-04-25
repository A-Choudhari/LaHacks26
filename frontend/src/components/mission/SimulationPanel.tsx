import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ParamSlider } from '../ui/ParamSlider'
import { FeedstockPicker } from '../ui/FeedstockPicker'
import type { SimulationParams, SimulationResult } from '../../types'

interface SimulationPanelProps {
  onRun: (p: SimulationParams) => void
  isLoading: boolean
  result?: SimulationResult
}

export function SimulationPanel({ onRun, isLoading, result }: SimulationPanelProps) {
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
          ocean: { temperature: 15.0, salinity: 35.0 },
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
