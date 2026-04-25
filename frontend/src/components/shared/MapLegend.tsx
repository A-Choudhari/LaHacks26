import { motion, AnimatePresence } from 'framer-motion'

interface MapLegendProps {
  showPlume: boolean
}

export function MapLegend({ showPlume }: MapLegendProps) {
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
    </div>
  )
}
