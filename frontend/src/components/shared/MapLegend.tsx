import { motion, AnimatePresence } from 'framer-motion'

interface MapLegendProps {
  showPlume:     boolean
  trafficCount?: number
}

export function MapLegend({ showPlume, trafficCount }: MapLegendProps) {
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

      {/* AIS traffic legend — always shown */}
      <div className="legend-rule" />
      <div className="legend-grad-label">AIS Traffic</div>
      <div className="legend-row">
        <svg width="8" height="12" viewBox="0 0 14 20" fill="none" style={{ flexShrink: 0 }}>
          <path d="M7 1C4.8 1 3.5 3 3.5 5.5L3.5 15.5C3.5 17.5 5 19 7 19C9 19 10.5 17.5 10.5 15.5L10.5 5.5C10.5 3 9.2 1 7 1Z" fill="#f59e0b"/>
        </svg>
        <span>Live AIS vessel</span>
      </div>
      <div className="legend-row">
        <svg width="8" height="12" viewBox="0 0 14 20" fill="none" style={{ flexShrink: 0 }}>
          <path d="M7 1C4.8 1 3.5 3 3.5 5.5L3.5 15.5C3.5 17.5 5 19 7 19C9 19 10.5 17.5 10.5 15.5L10.5 5.5C10.5 3 9.2 1 7 1Z" fill="#ef4444"/>
        </svg>
        <span>OAE conflict zone</span>
      </div>
      <div className="legend-row">
        <div style={{
          width: 14, height: 14, borderRadius: 3,
          background: 'rgba(245,158,11,0.45)',
          border: '1px solid rgba(245,158,11,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 7, color: '#0c0f14', fontWeight: 700 }}>N</span>
        </div>
        <span>Vessel cluster</span>
      </div>
      {trafficCount ? (
        <div className="legend-row" style={{ marginTop: 2 }}>
          <span style={{ color: 'var(--text-3)', fontSize: 9 }}>
            {trafficCount.toLocaleString()} vessels live
          </span>
        </div>
      ) : null}
    </div>
  )
}
