import { useState } from 'react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import 'mapbox-gl/dist/mapbox-gl.css'

import { API_URL } from './constants'
import type { AppMode, ShipStatus } from './types'
import { ModeSelector } from './components/shared/ModeSelector'
import { GlobalIntelligence } from './pages/GlobalIntelligence'
import { MissionControl } from './pages/MissionControl'
import { RoutePlanning } from './pages/RoutePlanning'

const queryClient = new QueryClient()

function AppContent() {
  const [mode, setMode] = useState<AppMode>('mission')

  const { data: fleet } = useQuery<ShipStatus[]>({
    queryKey: ['fleet'],
    queryFn: () => fetch(`${API_URL}/fleet`).then(r => r.json()),
    refetchInterval: 10000,
  })

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
          <ModeSelector mode={mode} onModeChange={setMode} />
        </div>

        <motion.div
          className="header-right"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.4 }}
        >
          <div className="online-dot" />
          <span>System Online</span>
        </motion.div>
      </motion.header>

      <main>
        {mode === 'global'  && <GlobalIntelligence fleet={fleet} />}
        {mode === 'mission' && <MissionControl fleet={fleet} />}
        {mode === 'route'   && <RoutePlanning fleet={fleet} />}
      </main>
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
