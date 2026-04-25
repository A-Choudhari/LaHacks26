import { motion } from 'framer-motion'
import type { AppMode } from '../../types'

const MODES: { id: AppMode; label: string }[] = [
  { id: 'global',  label: 'Global Intelligence' },
  { id: 'mission', label: 'Mission Control' },
  { id: 'route',   label: 'Route Planning' },
]

const MODE_INDEX: Record<AppMode, number> = { global: 0, mission: 1, route: 2 }

interface ModeSelectorProps {
  mode: AppMode
  onModeChange: (m: AppMode) => void
}

export function ModeSelector({ mode, onModeChange }: ModeSelectorProps) {
  return (
    <div className="mode-seg">
      <motion.div
        className="mode-seg-track"
        animate={{ x: `${MODE_INDEX[mode] * 100}%` }}
        transition={{ type: 'spring', stiffness: 500, damping: 38 }}
      />
      {MODES.map(m => (
        <button
          key={m.id}
          className={`mode-seg-btn ${mode === m.id ? 'active' : ''}`}
          onClick={() => onModeChange(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}
