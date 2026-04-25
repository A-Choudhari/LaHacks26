import { motion } from 'framer-motion'
import type { ShipStatus } from '../../types'
import { fadeUp, staggerList } from '../../constants'

interface FleetPanelProps {
  ships?: ShipStatus[]
}

export function FleetPanel({ ships }: FleetPanelProps) {
  if (!ships) return null
  const totalCO2 = ships.reduce((sum, s) => sum + s.co2_removed_tons, 0)

  return (
    <div className="panel">
      <div className="panel-label">Fleet</div>

      <div className="fleet-stats">
        <div className="stat-card">
          <div className="stat-value">{ships.length}</div>
          <div className="stat-label">Ships</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalCO2.toFixed(0)}</div>
          <div className="stat-label">Tons CO₂</div>
        </div>
      </div>

      <motion.div className="ship-list" variants={staggerList} initial="hidden" animate="show">
        {ships.map(ship => (
          <motion.div key={ship.ship_id} variants={fadeUp} className="ship-card">
            <div className={`ship-pip ${ship.status}`} />
            <div className="ship-info">
              <div className="ship-name">{ship.name}</div>
              <div className="ship-meta">
                <span className={`ship-status ${ship.status}`}>{ship.status}</span>
                <span className="ship-sep">·</span>
                <span className="ship-co2">{ship.co2_removed_tons.toFixed(1)} t CO₂</span>
              </div>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </div>
  )
}
