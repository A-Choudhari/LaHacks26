/**
 * AISLayer — GPU-rendered AIS vessel traffic via Mapbox GeoJSON + clustering.
 *
 * Replaces individual <Marker> components (one DOM node per vessel = lag)
 * with a single WebGL-rendered cluster source that handles 3000+ ships
 * at 60fps with zero DOM overhead.
 *
 * Usage: drop inside any <Map> component.
 */

import { useMemo } from 'react'
import { Source, Layer } from 'react-map-gl'

interface Vessel {
  vessel_id: string
  name: string
  vessel_type: string
  lat: number
  lon: number
  speed_kn: number
  conflict_risk?: boolean
}

interface AISLayerProps {
  vessels?: Vessel[]
}

export function AISLayer({ vessels }: AISLayerProps) {
  const geojson = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: (vessels ?? []).map(v => ({
      type: 'Feature' as const,
      properties: {
        name:         v.name,
        vessel_type:  v.vessel_type,
        speed_kn:     v.speed_kn,
        conflict:     v.conflict_risk ?? false,
      },
      geometry: { type: 'Point' as const, coordinates: [v.lon, v.lat] },
    })),
  }), [vessels])

  if (!vessels?.length) return null

  return (
    <Source
      id="ais-traffic"
      type="geojson"
      data={geojson}
      cluster={true}
      clusterMaxZoom={8}
      clusterRadius={48}
    >
      {/* Cluster bubble */}
      <Layer
        id="ais-clusters"
        type="circle"
        filter={['has', 'point_count']}
        paint={{
          'circle-color': [
            'step', ['get', 'point_count'],
            'rgba(245,158,11,0.50)',  20,
            'rgba(245,158,11,0.65)', 100,
            'rgba(239,68,68,0.65)',
          ],
          'circle-radius': [
            'step', ['get', 'point_count'],
            13,  20,
            19, 100,
            26,
          ],
          'circle-stroke-width': 1,
          'circle-stroke-color': 'rgba(255,255,255,0.12)',
        }}
      />

      {/* Cluster count label */}
      <Layer
        id="ais-cluster-count"
        type="symbol"
        filter={['has', 'point_count']}
        layout={{
          'text-field': '{point_count_abbreviated}',
          'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
          'text-size': 11,
        }}
        paint={{
          'text-color': '#0c0f14',
          'text-halo-color': 'rgba(0,0,0,0.15)',
          'text-halo-width': 1,
        }}
      />

      {/* Individual vessel dot */}
      <Layer
        id="ais-points"
        type="circle"
        filter={['!', ['has', 'point_count']]}
        paint={{
          'circle-radius': 4,
          'circle-color': [
            'case',
            ['==', ['get', 'conflict'], true], '#ef4444',
            '#f59e0b',
          ],
          'circle-opacity': 0.85,
          'circle-stroke-width': 1,
          'circle-stroke-color': 'rgba(255,255,255,0.22)',
        }}
      />
    </Source>
  )
}

/** Layer IDs used by AISLayer — pass to interactiveLayerIds to get click events */
export const AIS_INTERACTIVE_LAYERS = ['ais-clusters', 'ais-points']
