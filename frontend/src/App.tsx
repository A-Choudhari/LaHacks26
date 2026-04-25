import { useState, Component } from 'react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import 'mapbox-gl/dist/mapbox-gl.css'

import { API_URL } from './constants'
import type { AppMode, ShipStatus } from './types'
import { ModeSelector } from './components/shared/ModeSelector'
import { GlobalIntelligence } from './pages/GlobalIntelligence'
import { MissionControl } from './pages/MissionControl'
import { RoutePlanning } from './pages/RoutePlanning'
import { TourOverlay } from './components/tour/TourOverlay'
import { GLOBAL_TOUR, MISSION_TOUR, ROUTE_TOUR, TOUR_STORAGE_KEYS } from './components/tour/tourSteps'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (this.state.error) {
      const err = this.state.error as Error
      return (
        <div style={{ padding: 32, color: '#f87171', fontFamily: 'monospace', fontSize: 13, background: '#0c0f14', height: '100%', overflow: 'auto' }}>
          <div style={{ marginBottom: 8, color: '#dde3ea', fontWeight: 700 }}>Runtime Error (check console for full trace)</div>
          <div style={{ color: '#f87171' }}>{err.message}</div>
          <pre style={{ marginTop: 12, color: '#6b7a8d', fontSize: 11, whiteSpace: 'pre-wrap' }}>{err.stack}</pre>
        </div>
      )
    }
    return this.props.children
  }
}

const queryClient = new QueryClient()

interface HealthData {
  status: string
  julia_available: boolean
  mock_data_available: boolean
  ollama_available: boolean
  latency: number
}

const TOUR_STEPS = {
  global:  GLOBAL_TOUR,
  mission: MISSION_TOUR,
  route:   ROUTE_TOUR,
}

function AppContent() {
  const [mode, setMode] = useState<AppMode>('mission')
  const [restartSignal, setRestartSignal] = useState(0)

  const { data: fleet, isLoading: fleetLoading } = useQuery<ShipStatus[]>({
    queryKey: ['fleet'],
    queryFn: () => fetch(`${API_URL}/fleet`).then(r => r.json()),
    refetchInterval: 10000,
  })

  const { data: health } = useQuery<HealthData>({
    queryKey: ['health'],
    queryFn: async () => {
      const t = Date.now()
      const res = await fetch(`${API_URL}/health`)
      const data = await res.json()
      return { ...data, latency: Date.now() - t }
    },
    refetchInterval: 5000,
  })

  const storageKey = TOUR_STORAGE_KEYS[mode]

  const handleModeChange = (next: AppMode) => {
    setMode(next)
    setRestartSignal(0)
  }

  return (
    <div className="app">
      <motion.header
        className="header"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 30, delay: 0.05 }}
      >
        <div className="header-left">
          <motion.span
            className="header-logo"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15, duration: 0.35 }}
          >
            The Tiered Edge Fleet
          </motion.span>
          <motion.div
            className="header-sep"
            initial={{ scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ delay: 0.25, duration: 0.25 }}
          />
          <motion.span
            className="header-sub"
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3, duration: 0.35 }}
          >
            Ocean Alkalinity Enhancement
          </motion.span>
        </div>

        <div className="header-center">
          <ModeSelector mode={mode} onModeChange={handleModeChange} />
        </div>

        <motion.div
          className="header-right"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.4 }}
        >
          <div className="online-dot" />
          <span>Online</span>
          <AnimatePresence>
            {health && (
              <motion.div
                className="header-chips"
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              >
                <div className="header-chip">{health.latency}ms</div>
                <div className={`header-chip ${health.ollama_available ? 'chip-ok' : 'chip-off'}`}>
                  Gemma {health.ollama_available ? '✓' : '✗'}
                </div>
                <div className={`header-chip ${health.julia_available ? 'chip-ok' : 'chip-off'}`}>
                  GPU {health.julia_available ? '✓' : '✗'}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Tour restart button */}
          <motion.button
            className="tour-restart-btn"
            title="Restart tour"
            onClick={() => {
              localStorage.removeItem(storageKey)
              setRestartSignal(s => s + 1)
            }}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.92 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            ?
          </motion.button>
        </motion.div>
      </motion.header>

      <main>
        <ErrorBoundary>
          {mode === 'global'  && <GlobalIntelligence fleet={fleet} />}
          {mode === 'mission' && <MissionControl fleet={fleet} fleetLoading={fleetLoading} />}
          {mode === 'route'   && <RoutePlanning fleet={fleet} />}
        </ErrorBoundary>
      </main>

      {/* Per-mode tour overlay — mounts outside ErrorBoundary so it never crashes */}
      <AnimatePresence mode="wait">
        <TourOverlay
          key={mode}
          steps={TOUR_STEPS[mode]}
          storageKey={storageKey}
          restartSignal={restartSignal}
        />
      </AnimatePresence>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppContent />
    </QueryClientProvider>
  )
}
