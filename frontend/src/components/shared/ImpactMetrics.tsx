import { motion, AnimatePresence } from 'framer-motion'
import type { SimulationResult, ShipStatus } from '../../types'

interface ImpactMetricsProps {
  result?: SimulationResult
  fleet?: ShipStatus[]
}

export function ImpactMetrics({ result, fleet }: ImpactMetricsProps) {
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
