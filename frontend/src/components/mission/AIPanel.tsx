import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { API_URL } from '../../constants'
import type { SimulationResult, AnalysisResult, SimulationParams, OptimizeResult } from '../../types'

interface AIPanelProps {
  result?: SimulationResult
  params?: SimulationParams
  onApplyParams?: (p: SimulationParams) => void
}

type OptimizeObjective = 'maximize_co2' | 'minimize_risk' | 'balance'

function TypewriterText({ text, speed = 14 }: { text: string; speed?: number }) {
  const [displayed, setDisplayed] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    setDisplayed('')
    setDone(false)
    let i = 0
    const id = setInterval(() => {
      i++
      setDisplayed(text.slice(0, i))
      if (i >= text.length) { clearInterval(id); setDone(true) }
    }, speed)
    return () => clearInterval(id)
  }, [text, speed])

  return (
    <span>
      {displayed}
      {!done && <span className="tw-cursor">▌</span>}
    </span>
  )
}

export function AIPanel({ result, params, onApplyParams }: AIPanelProps) {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [autoRan, setAutoRan] = useState(false)

  // Optimize state
  const [optimizeResult, setOptimizeResult] = useState<OptimizeResult | null>(null)
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [optimizeObjective, setOptimizeObjective] = useState<OptimizeObjective>('maximize_co2')
  const [showOptimize, setShowOptimize] = useState(false)

  const lastTimestamp = useRef<string | null>(null)

  // Auto-analyze when a new simulation result arrives
  useEffect(() => {
    if (!result || result.timestamp === lastTimestamp.current) return
    lastTimestamp.current = result.timestamp
    setAutoRan(false)

    const timer = setTimeout(() => {
      setAutoRan(true)
      runAnalysis()
    }, 800)

    return () => clearTimeout(timer)
  }, [result?.timestamp]) // eslint-disable-line react-hooks/exhaustive-deps

  const runAnalysis = async () => {
    if (!result) return
    setIsAnalyzing(true)
    setError(null)
    setAnalysis(null)
    setOptimizeResult(null)
    try {
      const res = await fetch(`${API_URL}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          simulation_result: {
            summary: result.summary,
            params: {
              feedstock_type: params?.feedstock.feedstock_type ?? 'olivine',
              temperature: params?.ocean.temperature ?? result.ocean_conditions?.temperature_c ?? 15,
              discharge_rate: params?.vessel.discharge_rate ?? 0.5,
            },
          },
          analysis_type: 'full',
        }),
      })
      if (!res.ok) throw new Error()
      setAnalysis(await res.json())
    } catch {
      setError('Analysis failed — is the backend running?')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const runOptimize = async () => {
    if (!result || !params) return
    setIsOptimizing(true)
    try {
      const res = await fetch(`${API_URL}/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          simulation_result: { summary: result.summary },
          current_params: {
            vessel_speed: params.vessel.vessel_speed,
            discharge_rate: params.vessel.discharge_rate,
            feedstock_type: params.feedstock.feedstock_type,
            temperature: params.ocean.temperature,
            salinity: params.ocean.salinity,
          },
          objective: optimizeObjective,
        }),
      })
      if (!res.ok) throw new Error()
      setOptimizeResult(await res.json())
    } catch {
      setError('Optimization failed')
    } finally {
      setIsOptimizing(false)
    }
  }

  const handleApply = () => {
    if (!optimizeResult || !params || !onApplyParams) return
    onApplyParams({
      vessel: {
        vessel_speed: optimizeResult.suggested_vessel_speed,
        discharge_rate: optimizeResult.suggested_discharge_rate,
      },
      feedstock: { feedstock_type: optimizeResult.suggested_feedstock as 'olivine' | 'sodium_hydroxide' },
      ocean: params.ocean,
    })
    setOptimizeResult(null)
    setShowOptimize(false)
  }

  return (
    <div className="panel" style={{ flex: 1 }}>
      <div className="panel-label">
        AI Analysis
        {autoRan && !isAnalyzing && (
          <span className="ai-auto-badge">auto</span>
        )}
      </div>

      <div className="ai-controls-row">
        <motion.button
          className="analyze-btn"
          onClick={runAnalysis}
          disabled={!result || isAnalyzing}
          whileHover={{ scale: (!result || isAnalyzing) ? 1 : 1.01 }}
          whileTap={{ scale: (!result || isAnalyzing) ? 1 : 0.99 }}
        >
          {isAnalyzing ? 'Analyzing with Gemma…' : '↻ Re-analyze'}
        </motion.button>
        <motion.button
          className="optimize-toggle-btn"
          onClick={() => setShowOptimize(s => !s)}
          disabled={!result}
          whileHover={{ scale: !result ? 1 : 1.01 }}
          whileTap={{ scale: !result ? 1 : 0.99 }}
        >
          ⚡ Optimize
        </motion.button>
      </div>

      {/* Optimize panel */}
      <AnimatePresence>
        {showOptimize && (
          <motion.div
            className="optimize-panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          >
            <div className="opt-objective-row">
              {(['maximize_co2', 'minimize_risk', 'balance'] as OptimizeObjective[]).map(obj => (
                <button
                  key={obj}
                  className={`opt-obj-btn ${optimizeObjective === obj ? 'active' : ''}`}
                  onClick={() => setOptimizeObjective(obj)}
                >
                  {obj === 'maximize_co2' ? '↑ CO₂' : obj === 'minimize_risk' ? '↓ Risk' : '⚖ Balance'}
                </button>
              ))}
            </div>
            <motion.button
              className="run-optimize-btn"
              onClick={runOptimize}
              disabled={isOptimizing}
              whileHover={{ scale: isOptimizing ? 1 : 1.015 }}
              whileTap={{ scale: isOptimizing ? 1 : 0.985 }}
            >
              {isOptimizing ? 'Optimizing…' : 'Find Optimal Parameters'}
            </motion.button>

            <AnimatePresence>
              {optimizeResult && (
                <motion.div
                  className="optimize-result"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                >
                  <div className="opt-result-header">
                    <span className="opt-result-label">Suggested Parameters</span>
                    <span className={`opt-improvement ${optimizeResult.projected_improvement_pct >= 0 ? 'pos' : 'neg'}`}>
                      {optimizeResult.projected_improvement_pct >= 0 ? '+' : ''}{optimizeResult.projected_improvement_pct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="opt-param-rows">
                    <div className="opt-param-row">
                      <span>Speed</span>
                      <span>{optimizeResult.suggested_vessel_speed} m/s</span>
                    </div>
                    <div className="opt-param-row">
                      <span>Discharge</span>
                      <span>{optimizeResult.suggested_discharge_rate} m³/s</span>
                    </div>
                    <div className="opt-param-row">
                      <span>Feedstock</span>
                      <span>{optimizeResult.suggested_feedstock}</span>
                    </div>
                  </div>
                  <p className="opt-reasoning">{optimizeResult.reasoning}</p>
                  {onApplyParams && (
                    <motion.button
                      className="apply-params-btn"
                      onClick={handleApply}
                      whileHover={{ scale: 1.015 }}
                      whileTap={{ scale: 0.985 }}
                    >
                      Apply & Re-run
                    </motion.button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

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
              <p className="analysis-text">
                <TypewriterText text={analysis.safety_assessment} speed={12} />
              </p>
            </div>
            <div>
              <div className="analysis-block-label">CO₂ Projection</div>
              <p className="analysis-text">
                <TypewriterText text={analysis.co2_projection} speed={12} />
              </p>
            </div>
            <div>
              <div className="analysis-block-label">Recommendations</div>
              <motion.ul
                className="analysis-list"
                variants={{ show: { transition: { staggerChildren: 0.12, delayChildren: 0.4 } } }}
                initial="hidden"
                animate="show"
              >
                {analysis.recommendations.map((r, i) => (
                  <motion.li
                    key={i}
                    variants={{
                      hidden: { opacity: 0, x: -8 },
                      show: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 400, damping: 30 } }
                    }}
                  >
                    {r}
                  </motion.li>
                ))}
              </motion.ul>
            </div>
            <div className="analysis-footer">
              <span>{analysis.model_used}</span>
              <span>{(analysis.confidence * 100).toFixed(0)}% confidence</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!result && !analysis && !isAnalyzing && (
        <div className="impact-empty">
          Run a simulation — analysis auto-starts
        </div>
      )}
    </div>
  )
}
