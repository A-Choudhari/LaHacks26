import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { SimulationResult, ShipStatus } from '../../types'

interface ImpactMetricsProps {
  result?: SimulationResult
  fleet?: ShipStatus[]
}

function useCountUp(target: number, decimals = 0, duration = 700) {
  const prev = useRef(0)
  const [display, setDisplay] = useState(target)

  useEffect(() => {
    const from = prev.current
    prev.current = target
    if (from === target) return

    const start = Date.now()
    const tick = () => {
      const elapsed = Date.now() - start
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(from + (target - from) * eased)
      if (progress < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [target, duration])

  return display.toFixed(decimals)
}

export function ImpactMetrics({ result, fleet }: ImpactMetricsProps) {
  const totalCO2 = fleet?.reduce((sum, s) => sum + s.co2_removed_tons, 0) ?? 0
  const estCO2 = result
    ? Math.max(0, ((result.summary.max_total_alkalinity - 2300) * 0.8 * 44 * 25) / 1e6)
    : 0

  const co2Display = useCountUp(totalCO2, 0)
  const estDisplay = useCountUp(estCO2, 1)

  return (
    <div className="impact-overlay">
      <div className="impact-chip">
        <div className="impact-val">{co2Display}</div>
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
              {result.viability ? (
                <>
                  <div className={`impact-val viability-${result.viability.level}`}>
                    {result.viability.level.toUpperCase()}
                  </div>
                  <div className="impact-lbl">
                    Viability {Math.round(result.viability.viability_score * 100)}%
                  </div>
                </>
              ) : (
                <>
                  <div className={`impact-val ${result.status}`}>
                    {result.status === 'safe' ? 'SAFE' : 'UNSAFE'}
                  </div>
                  <div className="impact-lbl">Deployment Status</div>
                </>
              )}
            </motion.div>
            <motion.div
              className="impact-chip"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 400, damping: 28, delay: 0.05 }}
            >
              <div className="impact-val">+{estDisplay}</div>
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
