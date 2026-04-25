import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { API_URL } from '../../constants'
import type { SimulationResult, AnalysisResult } from '../../types'

interface AIPanelProps {
  result?: SimulationResult
}

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
      if (i >= text.length) {
        clearInterval(id)
        setDone(true)
      }
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

export function AIPanel({ result }: AIPanelProps) {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const analyze = async () => {
    if (!result) return
    setIsAnalyzing(true)
    setError(null)
    setAnalysis(null)
    try {
      const res = await fetch(`${API_URL}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          simulation_result: {
            summary: result.summary,
            params: { feedstock_type: 'olivine', temperature: 15, discharge_rate: 0.1 },
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
    </div>
  )
}
