import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { TourStep } from './tourSteps'

interface SpotRect { x: number; y: number; w: number; h: number }

interface Props {
  steps: TourStep[]
  storageKey: string
  restartSignal?: number   // increment to restart tour programmatically
}

const PAD = 10            // padding around spotlight (px)
const TIP_W = 320         // tooltip width (px)
const TIP_GAP = 16        // gap between spotlight edge and tooltip (px)
const BACKDROP = 'rgba(0,0,0,0.72)'

function getRect(target: string): SpotRect | null {
  const el = document.querySelector(`[data-tour="${target}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 }
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)) }

function tooltipStyle(
  pos: TourStep['pos'],
  spot: SpotRect | null,
  tipH: number,
): React.CSSProperties {
  if (!spot) {
    // centered modal for welcome / no-target steps
    return {
      position: 'fixed',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      width: TIP_W + 40,
    }
  }
  const vw = window.innerWidth
  const vh = window.innerHeight

  let style: React.CSSProperties = { position: 'fixed', width: TIP_W }

  switch (pos) {
    case 'right': {
      const left = clamp(spot.x + spot.w + TIP_GAP, 8, vw - TIP_W - 8)
      const top = clamp(spot.y + spot.h / 2 - tipH / 2, 8, vh - tipH - 8)
      return { ...style, left, top }
    }
    case 'left': {
      const left = clamp(spot.x - TIP_W - TIP_GAP, 8, vw - TIP_W - 8)
      const top = clamp(spot.y + spot.h / 2 - tipH / 2, 8, vh - tipH - 8)
      return { ...style, left, top }
    }
    case 'top': {
      const left = clamp(spot.x + spot.w / 2 - TIP_W / 2, 8, vw - TIP_W - 8)
      const top = clamp(spot.y - tipH - TIP_GAP, 8, vh - tipH - 8)
      return { ...style, left, top }
    }
    case 'bottom':
    default: {
      const left = clamp(spot.x + spot.w / 2 - TIP_W / 2, 8, vw - TIP_W - 8)
      const top = clamp(spot.y + spot.h + TIP_GAP, 8, vh - tipH - 8)
      return { ...style, left, top }
    }
  }
}

export function TourOverlay({ steps, storageKey, restartSignal }: Props) {
  const [step, setStep] = useState(-1)
  const [spot, setSpot] = useState<SpotRect | null>(null)
  const [tipH, setTipH] = useState(220)
  const tipRef = useRef<HTMLDivElement>(null)
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-start if not seen yet
  useEffect(() => {
    if (!localStorage.getItem(storageKey)) {
      const t = setTimeout(() => setStep(0), 900)
      return () => clearTimeout(t)
    }
  }, [storageKey])

  // Restart when parent increments restartSignal
  useEffect(() => {
    if (restartSignal === undefined || restartSignal === 0) return
    setStep(0)
  }, [restartSignal])

  // Resolve spotlight rect whenever step changes
  useLayoutEffect(() => {
    if (retryRef.current) clearTimeout(retryRef.current)
    if (step < 0 || step >= steps.length) { setSpot(null); return }
    const target = steps[step].target
    if (!target) { setSpot(null); return }

    let tries = 0
    const find = () => {
      const r = getRect(target)
      if (r) {
        setSpot(r)
      } else if (++tries < 10) {
        retryRef.current = setTimeout(find, 120)
      }
    }
    find()
    return () => { if (retryRef.current) clearTimeout(retryRef.current) }
  }, [step, steps])

  // Measure tooltip height after render
  useLayoutEffect(() => {
    if (tipRef.current) setTipH(tipRef.current.offsetHeight)
  })

  const dismiss = useCallback(() => {
    localStorage.setItem(storageKey, '1')
    setStep(-1)
  }, [storageKey])

  const next = useCallback(() => {
    if (step < steps.length - 1) setStep(s => s + 1)
    else dismiss()
  }, [step, steps.length, dismiss])

  if (step < 0) return null

  const cur = steps[step]
  const pos = cur.pos ?? 'bottom'
  const isLast = step === steps.length - 1
  const isCenter = !cur.target
  const tipStyle = tooltipStyle(pos, spot, tipH)

  // Build arrow class
  const arrowSide = !spot ? '' :
    pos === 'right'  ? 'tour-arrow-left'  :
    pos === 'left'   ? 'tour-arrow-right' :
    pos === 'top'    ? 'tour-arrow-bottom':
                       'tour-arrow-top'

  return (
    <AnimatePresence>
      <motion.div
        key="tour-root"
        style={{ position: 'fixed', inset: 0, zIndex: 9990, pointerEvents: 'all' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.25 }}
      >
        {/* ── 4-panel backdrop ── */}
        {spot ? (
          <>
            {/* top */}
            <motion.div
              style={{ position: 'fixed', background: BACKDROP, left: 0, right: 0, top: 0 }}
              animate={{ height: Math.max(0, spot.y) }}
              transition={{ type: 'spring', stiffness: 320, damping: 38 }}
            />
            {/* bottom */}
            <motion.div
              style={{ position: 'fixed', background: BACKDROP, left: 0, right: 0, bottom: 0 }}
              animate={{ height: Math.max(0, window.innerHeight - spot.y - spot.h) }}
              transition={{ type: 'spring', stiffness: 320, damping: 38 }}
            />
            {/* left */}
            <motion.div
              style={{ position: 'fixed', background: BACKDROP, top: Math.max(0, spot.y), bottom: Math.max(0, window.innerHeight - spot.y - spot.h) }}
              animate={{ width: Math.max(0, spot.x) }}
              transition={{ type: 'spring', stiffness: 320, damping: 38 }}
            />
            {/* right */}
            <motion.div
              style={{ position: 'fixed', background: BACKDROP, top: Math.max(0, spot.y), bottom: Math.max(0, window.innerHeight - spot.y - spot.h) }}
              animate={{ left: spot.x + spot.w, right: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 38 }}
            />
            {/* Spotlight border/glow */}
            <motion.div
              className="tour-spotlight"
              animate={{ left: spot.x, top: spot.y, width: spot.w, height: spot.h }}
              transition={{ type: 'spring', stiffness: 320, damping: 38 }}
            />
          </>
        ) : (
          // Full backdrop for center/welcome steps
          <div style={{ position: 'fixed', inset: 0, background: BACKDROP }} />
        )}

        {/* ── Tooltip card ── */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            ref={tipRef}
            className={`tour-card ${arrowSide}`}
            style={tipStyle}
            initial={{ opacity: 0, scale: 0.94, y: isCenter ? 16 : 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: isCenter ? -8 : -4 }}
            transition={{ type: 'spring', stiffness: 440, damping: 34 }}
          >
            {/* Progress dots */}
            <div className="tour-dots">
              {steps.map((_, i) => (
                <button
                  key={i}
                  className={`tour-dot ${i === step ? 'active' : i < step ? 'done' : ''}`}
                  onClick={() => setStep(i)}
                  aria-label={`Step ${i + 1}`}
                />
              ))}
              <span className="tour-step-label">{step + 1} / {steps.length}</span>
            </div>

            {/* Content */}
            <div className="tour-title">{cur.title}</div>
            <div
              className="tour-body"
              dangerouslySetInnerHTML={{ __html: cur.body }}
            />

            {/* Actions */}
            <div className="tour-actions">
              <button className="tour-btn-skip" onClick={dismiss}>
                Skip tour
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                {step > 0 && (
                  <button className="tour-btn-back" onClick={() => setStep(s => s - 1)}>
                    ←
                  </button>
                )}
                <button className="tour-btn-next" onClick={next}>
                  {isLast ? 'Done ✓' : 'Next →'}
                </button>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  )
}
