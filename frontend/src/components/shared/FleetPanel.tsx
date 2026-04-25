import { motion } from 'framer-motion'
import type { ShipStatus } from '../../types'
import { fadeUp, staggerList } from '../../constants'

interface FleetPanelProps {
  ships?: ShipStatus[]
  isLoading?: boolean
}

function SkeletonCard() {
  return (
    <div className="ship-card">
      <div className="skeleton-pip" />
      <div className="skeleton-lines">
        <div className="skeleton-line" style={{ width: '55%' }} />
        <div className="skeleton-line" style={{ width: '38%', marginTop: 6 }} />
      </div>
    </div>
  )
}

export function FleetPanel({ ships, isLoading }: FleetPanelProps) {
  return (
    <div className="panel">
      <div className="panel-label">Fleet</div>

      {/* Loading state */}
      {(isLoading || !ships) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="fleet-stats" style={{ marginBottom: 14 }}>
            <div className="stat-card">
              <div className="skeleton-line" style={{ width: 32, height: 26, borderRadius: 4 }} />
              <div className="skeleton-line" style={{ width: 48, marginTop: 6 }} />
            </div>
            <div className="stat-card">
              <div className="skeleton-line" style={{ width: 40, height: 26, borderRadius: 4 }} />
              <div className="skeleton-line" style={{ width: 52, marginTop: 6 }} />
            </div>
          </div>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {/* Loaded state */}
      {ships && (
        <>
          <div className="fleet-stats">
            <div className="stat-card">
              <div className="stat-value">{ships.length}</div>
              <div className="stat-label">Ships</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">
                {ships.reduce((sum, s) => sum + s.co2_removed_tons, 0).toFixed(0)}
              </div>
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
        </>
      )}
    </div>
  )
}
