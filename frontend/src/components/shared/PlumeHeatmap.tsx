import { Source, Layer } from 'react-map-gl'
import type { SimulationResult } from '../../types'

interface PlumeHeatmapProps {
  visible: boolean
  simulationData?: SimulationResult
  centerLat?: number
  centerLon?: number
}

export function PlumeHeatmap({ visible, simulationData, centerLat, centerLon }: PlumeHeatmapProps) {
  const baseLon = centerLon ?? -119.50
  const baseLat = centerLat ?? 33.80

  const features = (() => {
    if (!visible) return []
    if (simulationData?.fields?.alkalinity) {
      const alk = simulationData.fields.alkalinity
      const gs = alk.length
      return alk.flatMap((row, i) =>
        row.map((val, j) => {
          const intensity = Math.max(0, Math.min(1, (val - 2300) / 1200))
          if (intensity <= 0.05) return null
          return {
            type: 'Feature' as const,
            properties: { intensity },
            geometry: {
              type: 'Point' as const,
              coordinates: [baseLon + (j - gs / 2) * 0.008, baseLat + (i - gs / 2) * 0.004],
            },
          }
        }).filter(Boolean)
      )
    }
    return Array.from({ length: 80 }, (_, i) => {
      const angle = (i / 80) * Math.PI * 2
      const dist = Math.random() * 0.04
      return {
        type: 'Feature' as const,
        properties: { intensity: Math.exp(-dist * 30) * (0.5 + Math.random() * 0.5) },
        geometry: {
          type: 'Point' as const,
          coordinates: [baseLon + Math.cos(angle) * dist, baseLat + Math.sin(angle) * dist * 0.5],
        },
      }
    })
  })()

  return (
    <Source id="plume" type="geojson" data={{ type: 'FeatureCollection', features: features as any[] }}>
      <Layer
        id="plume-heat"
        type="heatmap"
        paint={{
          'heatmap-weight': ['get', 'intensity'],
          'heatmap-intensity': 1.5,
          'heatmap-color': [
            'interpolate', ['linear'], ['heatmap-density'],
            0, 'rgba(0,0,255,0)',
            0.1, 'rgba(0,100,255,0.3)',
            0.3, 'rgba(0,200,255,0.5)',
            0.5, 'rgba(0,255,200,0.6)',
            0.7, 'rgba(100,255,100,0.7)',
            0.85, 'rgba(255,255,0,0.8)',
            1, 'rgba(255,100,0,0.9)',
          ],
          'heatmap-radius': 40,
          'heatmap-opacity': 0.85,
        }}
      />
    </Source>
  )
}
