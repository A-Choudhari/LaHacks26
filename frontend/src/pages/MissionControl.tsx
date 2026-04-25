import { useState, useRef, useEffect, useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import Map, { Marker, MapRef } from 'react-map-gl'
import { motion } from 'framer-motion'
import { API_URL, MAPBOX_TOKEN } from '../constants'
import type { SimulationParams, SimulationResult, ShipStatus } from '../types'
import { SimulationPanel } from '../components/mission/SimulationPanel'
import { AIPanel } from '../components/mission/AIPanel'
import { FleetPanel } from '../components/shared/FleetPanel'
import { ShipMarker } from '../components/shared/ShipMarker'
import { MPAOverlay } from '../components/shared/MPAOverlay'
import { PlumeHeatmap } from '../components/shared/PlumeHeatmap'
import { MapLegend } from '../components/shared/MapLegend'
import { ImpactMetrics } from '../components/shared/ImpactMetrics'
import type { PlumeThreeLayer } from '../ThreeLayer'

interface MissionControlProps {
  fleet?: ShipStatus[]
  fleetLoading?: boolean
}

const TICK_MS = 1500   // ship position update interval
const SIM_REFRESH_MS = 45_000  // re-fetch ocean conditions every 45s

// Move a ship one tick along its heading at its speed
function advanceShip(ship: ShipStatus, dtMs: number): ShipStatus {
  const dtS = dtMs / 1000
  const speedMs = ship.speed_kn * 0.5144
  const distM = speedMs * dtS
  const distKm = distM / 1000
  const headingRad = (ship.heading * Math.PI) / 180
  const dLat = (distKm * Math.cos(headingRad)) / 111.32
  const dLon =
    (distKm * Math.sin(headingRad)) /
    (111.32 * Math.cos((ship.position.lat * Math.PI) / 180))
  return {
    ...ship,
    position: {
      lat: ship.position.lat + dLat,
      lon: ship.position.lon + dLon,
    },
  }
}

export function MissionControl({ fleet: initialFleet, fleetLoading }: MissionControlProps) {
  const [simulationResult, setSimulationResult] = useState<SimulationResult>()
  const [showPlume, setShowPlume] = useState(false)
  const [isRunning, setIsRunning] = useState(true)
  const [elapsedS, setElapsedS] = useState(0)

  // Live ship positions — initialised from fleet prop, then animated client-side
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
    onSuccess: (data) => {
      setSimulationResult(data)
      setShowPlume(true)
    },
  })

  const defaultParams: SimulationParams = {
    vessel: { vessel_speed: 6.2, discharge_rate: 0.5 },
    feedstock: { feedstock_type: 'olivine' },
    ocean: { temperature: 15.0, salinity: 35.0 },
  }

  // Auto-start simulation on mount
  useEffect(() => {
    simulate.mutate(defaultParams)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Ship animation tick ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isRunning) {
      if (tickRef.current) clearInterval(tickRef.current)
      return
    }
    tickRef.current = window.setInterval(() => {
      setLiveShips(prev => prev.map(s => advanceShip(s, TICK_MS)))
      setElapsedS(s => s + TICK_MS / 1000)
    }, TICK_MS)
    return () => {
      if (tickRef.current) clearInterval(tickRef.current)
    }
  }, [isRunning])

  // ── Periodic simulation refresh (fresh ocean conditions) ─────────────────
  useEffect(() => {
    if (!isRunning) {
      if (simRefreshRef.current) clearInterval(simRefreshRef.current)
      return
    }
    simRefreshRef.current = window.setInterval(() => {
      simulate.mutate(defaultParams)
    }, SIM_REFRESH_MS)
    return () => {
      if (simRefreshRef.current) clearInterval(simRefreshRef.current)
    }
  }, [isRunning]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Three.js plume layer ─────────────────────────────────────────────────
  // Clean up the custom layer when the component unmounts so that re-entering
  // Mission Control mode (with reuseMaps) doesn't throw "layer already exists".
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
    // Lazy-import Three.js so module-init never blocks or crashes the first render
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

  // Deploying ship (Pacific Guardian) leads the plume
  const activeShip = liveShips.find(s => s.status === 'deploying') ?? liveShips[0]

  // Format elapsed time
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
        <SimulationPanel
          onRun={p => simulate.mutate(p)}
          isLoading={simulate.isPending}
          result={simulationResult}
          isRunning={isRunning}
          elapsedLabel={elapsedLabel}
          onToggleRunning={() => setIsRunning(r => !r)}
          onReset={() => {
            setIsRunning(false)
            setElapsedS(0)
            if (initialFleet?.length) setLiveShips(initialFleet)
            setSimulationResult(undefined)
            setShowPlume(false)
          }}
        />
        <AIPanel result={simulationResult} />
      </motion.div>

      {/* ── Map ── */}
      <div className="map-container">
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

          {/* Plume follows active (deploying) ship */}
          <PlumeHeatmap
            visible={showPlume}
            simulationData={simulationResult}
            centerLat={activeShip?.position.lat}
            centerLon={activeShip?.position.lon}
          />

          {liveShips.map((ship) => (
            <Marker
              key={ship.ship_id}
              longitude={ship.position.lon}
              latitude={ship.position.lat}
              anchor="center"
            >
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

        <MapLegend showPlume={showPlume} />
        <ImpactMetrics result={simulationResult} fleet={liveShips} />

        {/* Sim status bar */}
        <div className="sim-status-bar">
          <div className={`sim-status-dot ${isRunning ? 'running' : 'paused'}`} />
          <span className="sim-status-label">
            {isRunning ? 'Live Simulation' : 'Paused'}
          </span>
          {isRunning && <span className="sim-elapsed">{elapsedLabel}</span>}
          {simulate.isPending && (
            <span className="sim-fetching">↻ Fetching conditions…</span>
          )}
        </div>
      </div>

      {/* ── Right sidebar ── */}
      <motion.div
        className="sidebar sidebar-right"
        initial={{ x: 280, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 30 }}
      >
        <FleetPanel ships={liveShips} isLoading={fleetLoading} />
      </motion.div>
    </div>
  )
}
