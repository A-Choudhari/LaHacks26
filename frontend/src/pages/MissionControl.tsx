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
import { PlumeThreeLayer } from '../ThreeLayer'

interface MissionControlProps {
  fleet?: ShipStatus[]
}

export function MissionControl({ fleet }: MissionControlProps) {
  const [simulationResult, setSimulationResult] = useState<SimulationResult>()
  const [showPlume, setShowPlume] = useState(false)
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
      </motion.div>

      <div className="map-container">
        <Map
          ref={mapRef}
          initialViewState={{ longitude: -119.1, latitude: 33.55, zoom: 7 }}
          style={{ width: '100%', height: '100%' }}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          mapboxAccessToken={MAPBOX_TOKEN}
          onLoad={handleMapLoad}
        >
          <MPAOverlay />
          <PlumeHeatmap visible={showPlume} simulationData={simulationResult} />
          {fleet?.map((ship) => (
            <Marker key={ship.ship_id} longitude={ship.position.lon} latitude={ship.position.lat} anchor="center">
              <ShipMarker status={ship.status} />
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
        <FleetPanel ships={fleet} />
      </motion.div>
    </div>
  )
}
