import { useState, useRef, useEffect, useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import Map, { Marker, MapRef } from 'react-map-gl'
import { motion, AnimatePresence } from 'framer-motion'
import { API_URL, MAPBOX_TOKEN } from '../constants'
import type { SimulationParams, SimulationResult, ShipStatus } from '../types'
import { SimulationPanel } from '../components/mission/SimulationPanel'
import { AIPanel } from '../components/mission/AIPanel'
import { LiveImpactPanel } from '../components/mission/LiveImpactPanel'
import { FleetPanel } from '../components/shared/FleetPanel'
import { ShipMarker } from '../components/shared/ShipMarker'
import { MPAOverlay } from '../components/shared/MPAOverlay'
import { AISLayer } from '../components/shared/AISLayer'
import { PlumeHeatmap } from '../components/shared/PlumeHeatmap'
import { MapLegend } from '../components/shared/MapLegend'
import { ImpactMetrics } from '../components/shared/ImpactMetrics'
import type { PlumeThreeLayer } from '../ThreeLayer'

interface MissionControlProps {
  fleet?: ShipStatus[]
  fleetLoading?: boolean
  traffic?: any[]
}

interface HistoryPoint {
  ts: number
  arag: number
  alk: number
  co2est: number
}

const TICK_MS = 1500
const SIM_REFRESH_MS = 45_000

type RightTab = 'impact' | 'ai' | 'fleet'

function advanceShip(ship: ShipStatus, dtMs: number): ShipStatus {
  const dtS = dtMs / 1000
  const speedMs = ship.speed_kn * 0.5144
  const distKm = (speedMs * dtS) / 1000
  const headingRad = (ship.heading * Math.PI) / 180
  const dLat = (distKm * Math.cos(headingRad)) / 111.32
  const dLon = (distKm * Math.sin(headingRad)) / (111.32 * Math.cos((ship.position.lat * Math.PI) / 180))
  return { ...ship, position: { lat: ship.position.lat + dLat, lon: ship.position.lon + dLon } }
}

export function MissionControl({ fleet: initialFleet, fleetLoading, traffic }: MissionControlProps) {
  const [simulationResult, setSimulationResult] = useState<SimulationResult>()
  const [lastParams, setLastParams] = useState<SimulationParams>()
  const [showPlume, setShowPlume] = useState(false)
  const [isRunning, setIsRunning] = useState(true)
  const [elapsedS, setElapsedS] = useState(0)
  const [rightTab, setRightTab] = useState<RightTab>('impact')
  const [simHistory, setSimHistory] = useState<HistoryPoint[]>([])

  const [liveShips, setLiveShips] = useState<ShipStatus[]>(initialFleet ?? [])
  useEffect(() => {
    if (initialFleet?.length) setLiveShips(initialFleet)
  }, [initialFleet])

  const mapRef = useRef<MapRef>(null)
  const threeLayerRef = useRef<PlumeThreeLayer | null>(null)
  const tickRef = useRef<number | null>(null)
  const simRefreshRef = useRef<number | null>(null)

  // ── Simulation mutation ──────────────────────────────────────────────────
  const simulate = useMutation({
    mutationFn: async (params: SimulationParams) => {
      const res = await fetch(`${API_URL}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (!res.ok) throw new Error('Simulation failed')
      return res.json() as Promise<SimulationResult>
    },
    onSuccess: (data, params) => {
      setSimulationResult(data)
      setLastParams(params)
      setShowPlume(true)
      // Append to sparkline history
      const baseline = data.ocean_conditions?.baseline_alkalinity_umol_kg ?? 2280
      const deltaAlk = Math.max(0, data.summary.max_total_alkalinity - baseline)
      const temp = data.ocean_conditions?.temperature_c ?? 15
      const tempEff = Math.max(0.4, 0.8 - 0.012 * Math.max(0, temp - 15))
      const co2est = (deltaAlk * tempEff * 44 * 25e6 * (data.ocean_conditions?.mixed_layer_depth_m ?? 60) * 1025) / 1e15
      setSimHistory(prev => [...prev.slice(-9), {
        ts: Date.now(),
        arag: data.summary.max_aragonite_saturation,
        alk: data.summary.max_total_alkalinity,
        co2est,
      }])
    },
  })

  const defaultParams: SimulationParams = {
    vessel: { vessel_speed: 6.2, discharge_rate: 0.5 },
    feedstock: { feedstock_type: 'olivine' },
    ocean: { temperature: 15.0, salinity: 35.0 },
  }

  const handleRun = (p: SimulationParams) => {
    setLastParams(p)
    simulate.mutate(p)
  }

  useEffect(() => {
    simulate.mutate(defaultParams)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Ship animation tick ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isRunning) { if (tickRef.current) clearInterval(tickRef.current); return }
    tickRef.current = window.setInterval(() => {
      setLiveShips(prev => prev.map(s => advanceShip(s, TICK_MS)))
      setElapsedS(s => s + TICK_MS / 1000)
    }, TICK_MS)
    return () => { if (tickRef.current) clearInterval(tickRef.current) }
  }, [isRunning])

  // ── Periodic simulation refresh ─────────────────────────────────────────
  useEffect(() => {
    if (!isRunning) { if (simRefreshRef.current) clearInterval(simRefreshRef.current); return }
    simRefreshRef.current = window.setInterval(() => {
      simulate.mutate(lastParams ?? defaultParams)
    }, SIM_REFRESH_MS)
    return () => { if (simRefreshRef.current) clearInterval(simRefreshRef.current) }
  }, [isRunning, lastParams]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Three.js plume layer ─────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      try {
        const map = mapRef.current?.getMap()
        if (map?.getLayer('plume-three-layer')) map.removeLayer('plume-three-layer')
      } catch {}
    }
  }, [])

  const handleMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap()
    if (!map) return
    import('../ThreeLayer').then(({ PlumeThreeLayer }) => {
      try {
        if (map.getLayer('plume-three-layer')) map.removeLayer('plume-three-layer')
        const layer = new PlumeThreeLayer(null)
        threeLayerRef.current = layer
        map.addLayer(layer)
      } catch (err) {
        console.warn('PlumeThreeLayer init failed:', err)
      }
    }).catch(err => console.warn('ThreeLayer module load failed:', err))
  }, [])

  useEffect(() => {
    if (!simulationResult?.fields?.aragonite_saturation || !simulationResult.coordinates) return
    threeLayerRef.current?.updateData({
      fields: {
        alkalinity: simulationResult.fields.alkalinity ?? [],
        aragonite_saturation: simulationResult.fields.aragonite_saturation,
      },
      coordinates: simulationResult.coordinates,
    })
  }, [simulationResult])

  const activeShip = liveShips.find(s => s.status === 'deploying') ?? liveShips[0]

  const elapsedLabel = (() => {
    const h = Math.floor(elapsedS / 3600)
    const m = Math.floor((elapsedS % 3600) / 60)
    const s = Math.floor(elapsedS % 60)
    return h > 0
      ? `+${h}h ${m.toString().padStart(2, '0')}m`
      : `+${m}m ${s.toString().padStart(2, '0')}s`
  })()

  return (
    <div className="mode-layout">

      {/* ── Left sidebar ── */}
      <motion.div
        className="sidebar sidebar-left"
        initial={{ x: -280, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 30 }}
      >
        <div data-tour="mc-sim-panel">
          <SimulationPanel
            onRun={handleRun}
            isLoading={simulate.isPending}
            result={simulationResult}
            isRunning={isRunning}
            elapsedLabel={elapsedLabel}
            onToggleRunning={() => setIsRunning(r => !r)}
            onReset={() => {
              setIsRunning(false)
              setElapsedS(0)
              setSimHistory([])
              if (initialFleet?.length) setLiveShips(initialFleet)
              setSimulationResult(undefined)
              setShowPlume(false)
            }}
          />
        </div>
      </motion.div>

      {/* ── Map ── */}
      <div className="map-container" data-tour="mc-map">
        <Map
          ref={mapRef}
          initialViewState={{ longitude: -120.0, latitude: 33.8, zoom: 6.5 }}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          mapboxAccessToken={MAPBOX_TOKEN}
          reuseMaps
          onLoad={handleMapLoad}
        >
          <MPAOverlay />
          <AISLayer vessels={traffic} />
          <PlumeHeatmap
            visible={showPlume}
            simulationData={simulationResult}
            centerLat={activeShip?.position.lat}
            centerLon={activeShip?.position.lon}
          />
          {liveShips.map((ship) => (
            <Marker key={ship.ship_id} longitude={ship.position.lon} latitude={ship.position.lat} anchor="center">
              <ShipMarker
                status={ship.status}
                name={ship.name}
                lat={ship.position.lat}
                lon={ship.position.lon}
                co2={ship.co2_removed_tons}
                heading={ship.heading ?? 0}
              />
            </Marker>
          ))}
        </Map>

        <MapLegend showPlume={showPlume} trafficCount={traffic?.length} />
        <div data-tour="mc-impact"><ImpactMetrics result={simulationResult} fleet={liveShips} /></div>

        <div className="sim-status-bar">
          <div className={`sim-status-dot ${isRunning ? 'running' : 'paused'}`} />
          <span className="sim-status-label">{isRunning ? 'Live Simulation' : 'Paused'}</span>
          {isRunning && <span className="sim-elapsed">{elapsedLabel}</span>}
          {simulate.isPending && <span className="sim-fetching">↻ Fetching conditions…</span>}
        </div>
      </div>

      {/* ── Right sidebar — tabbed ── */}
      <motion.div
        data-tour="mc-fleet"
        className="sidebar sidebar-right mc-right-sidebar"
        initial={{ x: 280, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 30 }}
      >
        {/* Tab bar */}
        <div className="mc-tab-bar">
          {(['impact', 'ai', 'fleet'] as RightTab[]).map((tab) => (
            <button
              key={tab}
              className={`mc-tab-btn ${rightTab === tab ? 'active' : ''}`}
              onClick={() => setRightTab(tab)}
            >
              {tab === 'impact' ? 'Impact' : tab === 'ai' ? 'AI' : 'Fleet'}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="mc-tab-content">
          <AnimatePresence mode="wait">
            {rightTab === 'impact' && (
              <motion.div
                key="impact"
                className="mc-tab-pane"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              >
                <div data-tour="mc-impact-panel">
                  <LiveImpactPanel
                    result={simulationResult}
                    fleet={liveShips}
                    history={simHistory}
                  />
                </div>
              </motion.div>
            )}
            {rightTab === 'ai' && (
              <motion.div
                key="ai"
                className="mc-tab-pane"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              >
                <div data-tour="mc-ai-panel">
                  <AIPanel
                    result={simulationResult}
                    params={lastParams}
                    onApplyParams={(p) => {
                      handleRun(p)
                      setRightTab('impact')
                    }}
                  />
                </div>
              </motion.div>
            )}
            {rightTab === 'fleet' && (
              <motion.div
                key="fleet"
                className="mc-tab-pane"
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              >
                <FleetPanel ships={liveShips} isLoading={fleetLoading} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Notification dot on AI tab when analysis is running */}
        {simulate.isPending && rightTab !== 'ai' && (
          <div className="mc-ai-notify" onClick={() => setRightTab('ai')}>
            ↻ AI analyzing…
          </div>
        )}
      </motion.div>
    </div>
  )
}
