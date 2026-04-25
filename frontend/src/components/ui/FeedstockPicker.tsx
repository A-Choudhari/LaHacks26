import { motion } from 'framer-motion'

interface FeedstockPickerProps {
  value: 'olivine' | 'sodium_hydroxide'
  onChange: (v: 'olivine' | 'sodium_hydroxide') => void
}

export function FeedstockPicker({ value, onChange }: FeedstockPickerProps) {
  return (
    <div className="param-item">
      <div className="param-row" style={{ marginBottom: 8 }}>
        <span className="param-label">Feedstock</span>
      </div>
      <div className="segmented">
        <motion.div
          className="segmented-track"
          animate={{ x: value === 'olivine' ? 0 : '100%' }}
          transition={{ type: 'spring', stiffness: 500, damping: 38 }}
        />
        <button
          className={`segmented-btn ${value === 'olivine' ? 'active' : ''}`}
          onClick={() => onChange('olivine')}
        >
          Olivine
        </button>
        <button
          className={`segmented-btn ${value === 'sodium_hydroxide' ? 'active' : ''}`}
          onClick={() => onChange('sodium_hydroxide')}
        >
          NaOH
        </button>
      </div>
    </div>
  )
}
