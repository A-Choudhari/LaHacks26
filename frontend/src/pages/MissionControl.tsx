import { useState, useRef, useEffect, useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import Map, { Marker, MapRef } from 'react-map-gl'
import { motion, AnimatePresence } from 'framer-motion'
import * as SliderPrimitive from '@radix-ui/react-slider'
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
import { PlumeThreeLayer } from '../ThreeLayer'

interface MissionControlProps {
  fleet?: ShipStatus[]
  fleetLoading?: boolean
}

export function MissionControl({ fleet, fleetLoading }: MissionControlProps) {
  const [simulationResult, setSimulationResult] = useState<SimulationResult>()
  const [showPlume, setShowPlume] = useState(false)
  const [depthLevel, setDepthLevel] = useState(0.5) // 0 = top, 1 = bottom
  const mapRef = useRef<MapRef>(null)
  const threeLayerRef = useRef<PlumeThreeLayer | null>(null)

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
    onError: () => alert('Simulation failed — is the backend running?'),
  })

  const handleMapLoad = useCallback(() => {
    const map = mapRef.current?.getMap()
    if (!map) return
    const layer = new PlumeThreeLayer(null)
    threeLayerRef.current = layer
    map.addLayer(layer)
  }, [])

  useEffect(() => {
    if (!simulationResult || !threeLayerRef.current) return
    if (simulationResult.fields?.aragonite_saturation && simulationResult.coordinates) {
      threeLayerRef.current.updateData({
        fields: {
          alkalinity: simulationResult.fields.alkalinity ?? [],
          aragonite_saturation: simulationResult.fields.aragonite_saturation,
        },
        coordinates: simulationResult.coordinates,
      })
    }
  }, [simulationResult])

  // Update Three.js layer when depth changes
  useEffect(() => {
    if (threeLayerRef.current && simulationResult) {
      threeLayerRef.current.setDepthLevel(depthLevel)
    }
  }, [depthLevel, simulationResult])

  return (
    <div className="mode-layout">
      <motion.div
        className="sidebar sidebar-left"
        initial={{ x: -280, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 30 }}
      >
        <SimulationPanel
          onRun={(p) => simulate.mutate(p)}
          isLoading={simulate.isPending}
          result={simulationResult}
        />
        <AIPanel result={simulationResult} />

        <AnimatePresence>
          {simulationResult && (
            <motion.div
              className="panel"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            >
              <div className="panel-label">3D Visualization</div>

              <div className="view-toggle-row">
                <motion.button
                  className="view-3d-btn"
                  onClick={() => {
                    const map = mapRef.current?.getMap()
                    if (map) {
                      map.easeTo({
                        pitch: 60,
                        bearing: -20,
                        center: [-118.24, 34.05],
                        zoom: 9,
                        duration: 1000,
                      })
                    }
                  }}
                  whileHover={{ scale: 1.015 }}
                  whileTap={{ scale: 0.985 }}
                >
                  3D View
                </motion.button>
                <motion.button
                  className="view-2d-btn"
                  onClick={() => {
                    const map = mapRef.current?.getMap()
                    if (map) {
                      map.easeTo({
                        pitch: 0,
                        bearing: 0,
                        center: [-119.1, 33.55],
                        zoom: 7,
                        duration: 1000,
                      })
                    }
                  }}
                  whileHover={{ scale: 1.015 }}
                  whileTap={{ scale: 0.985 }}
                >
                  2D View
                </motion.button>
              </div>

              <div className="param-item" style={{ marginTop: 16 }}>
                <div className="param-row">
                  <span className="param-label">Section Depth</span>
                  <motion.span
                    key={depthLevel}
                    className="param-value"
                    initial={{ scale: 1.18, opacity: 0.55 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', stiffness: 520, damping: 22 }}
                  >
                    {Math.round(depthLevel * 100)}<span className="param-unit">%</span>
                  </motion.span>
                </div>
                <SliderPrimitive.Root
                  className="slider-root"
                  min={0} max={1} step={0.05}
                  value={[depthLevel]}
                  onValueChange={([v]) => setDepthLevel(v)}
                >
                  <SliderPrimitive.Track className="slider-track">
                    <SliderPrimitive.Range className="slider-range" />
                  </SliderPrimitive.Track>
                  <SliderPrimitive.Thumb className="slider-thumb" aria-label="Section Depth" />
                </SliderPrimitive.Root>
                <div className="depth-labels">
                  <span>Surface</span>
                  <span>Deep</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <div className="map-container">
        <Map
          ref={mapRef}
          initialViewState={{ longitude: -119.1, latitude: 33.55, zoom: 7 }}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          mapboxAccessToken={MAPBOX_TOKEN}
          reuseMaps
          onLoad={handleMapLoad}
        >
          <MPAOverlay />
          <PlumeHeatmap visible={showPlume} simulationData={simulationResult} />
          {fleet?.map((ship) => (
            <Marker key={ship.ship_id} longitude={ship.position.lon} latitude={ship.position.lat} anchor="center">
              <ShipMarker status={ship.status} name={ship.name} lat={ship.position.lat} lon={ship.position.lon} co2={ship.co2_removed_tons} />
            </Marker>
          ))}
        </Map>
        <MapLegend showPlume={showPlume} />
        <ImpactMetrics result={simulationResult} fleet={fleet} />
      </div>

      <motion.div
        className="sidebar sidebar-right"
        initial={{ x: 280, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 30 }}
      >
        <FleetPanel ships={fleet} isLoading={fleetLoading} />
      </motion.div>
    </div>
  )
}
