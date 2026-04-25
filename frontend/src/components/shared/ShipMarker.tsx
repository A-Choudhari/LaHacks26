import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

export const STATUS_COLORS: Record<string, string> = {
  active:    '#4ade80',
  deploying: '#00c8f0',
  idle:      '#fbbf24',
}

interface ShipMarkerProps {
  status: string
  name?: string
  lat?: number
  lon?: number
  co2?: number
  heading?: number
}

export function ShipMarker({ status, name, lat, lon, co2, heading }: ShipMarkerProps) {
  const [hovered, setHovered] = useState(false)
  const color = STATUS_COLORS[status] ?? '#6b7a8d'

  return (
    <div
      className="ship-marker-wrap"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {status === 'deploying' && (
        <div className="ship-pulse-ring" style={{ background: color, width: 28, height: 28 }} />
      )}
      <svg
        width="28" height="28" viewBox="0 0 28 28" fill="none"
        style={{ transform: heading !== undefined ? `rotate(${heading}deg)` : undefined, transition: 'transform 1.2s linear' }}
      >
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

      <AnimatePresence>
        {hovered && name && (
          <motion.div
            className="ship-tooltip"
            initial={{ opacity: 0, scale: 0.88, y: 4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.88, y: 4 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          >
            <div className="ship-tooltip-name">{name}</div>
            <div className="ship-tooltip-row">
              <span className={`ship-tooltip-status ${status}`}>{status}</span>
              {co2 !== undefined && (
                <span className="ship-tooltip-co2">{co2.toFixed(1)} t CO₂</span>
              )}
            </div>
            {lat !== undefined && lon !== undefined && (
              <div className="ship-tooltip-pos">
                {lat.toFixed(3)}°N · {Math.abs(lon).toFixed(3)}°W
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
