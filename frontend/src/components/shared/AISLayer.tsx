/**
 * AISLayer — GPU-rendered AIS vessel traffic.
 *
 * Individual vessels render as ship silhouette icons (SDF image, rotates
 * with heading, tinted amber / red for conflict zones). Nearby vessels
 * cluster into amber bubbles at low zoom. Zero DOM elements.
 */

import { useEffect, useMemo } from 'react'
import { Source, Layer, useMap } from 'react-map-gl'

export interface AISVessel {
  vessel_id: string
  name:        string
  vessel_type: string
  lat:         number
  lon:         number
  heading:     number
  speed_kn:    number
  conflict_risk?: boolean
}

interface AISLayerProps {
  vessels?: AISVessel[]
}

// White-on-transparent top-down ship SVG — loaded as SDF so icon-color tints it at runtime
const SHIP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 20" width="14" height="20">
  <path d="M7 1 C4.8 1 3.5 3 3.5 5.5 L3.5 15.5 C3.5 17.5 5 19 7 19 C9 19 10.5 17.5 10.5 15.5 L10.5 5.5 C10.5 3 9.2 1 7 1 Z" fill="white"/>
  <rect x="5.5" y="9" width="3" height="3" rx="0.5" fill="black" fill-opacity="0.45"/>
  <line x1="7" y1="1" x2="7" y2="5" stroke="black" stroke-width="1.2" stroke-opacity="0.35" stroke-linecap="round"/>
</svg>`

const IMAGE_ID = 'ais-ship-sdf'

function useShipImage() {
  const maps = useMap()

  useEffect(() => {
    const mapRef = Object.values(maps)[0]
    if (!mapRef) return
    const map = mapRef.getMap()
    if (!map) return

    const load = () => {
      if (map.hasImage(IMAGE_ID)) return
      const blob = new Blob([SHIP_SVG], { type: 'image/svg+xml' })
      const url  = URL.createObjectURL(blob)
      const img  = new Image(14, 20)
      img.onload = () => {
        if (!map.hasImage(IMAGE_ID)) map.addImage(IMAGE_ID, img, { sdf: true })
        URL.revokeObjectURL(url)
      }
      img.src = url
    }

    if (map.isStyleLoaded()) load()
    else map.once('styledata', load)
  }, [maps])
}

export function AISLayer({ vessels }: AISLayerProps) {
  useShipImage()

  const geojson = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: (vessels ?? []).map(v => ({
      type: 'Feature' as const,
      properties: {
        name:        v.name,
        vessel_type: v.vessel_type,
        speed_kn:    v.speed_kn,
        heading:     v.heading ?? 0,
        conflict:    v.conflict_risk ?? false,
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
      {/* ── Cluster bubble ── */}
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
            13, 20,
            19, 100,
            26,
          ],
          'circle-stroke-width': 1,
          'circle-stroke-color': 'rgba(255,255,255,0.12)',
        }}
      />

      {/* ── Cluster count label ── */}
      <Layer
        id="ais-cluster-count"
        type="symbol"
        filter={['has', 'point_count']}
        layout={{
          'text-field':  '{point_count_abbreviated}',
          'text-font':   ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
          'text-size':   11,
        }}
        paint={{
          'text-color':        '#0c0f14',
          'text-halo-color':   'rgba(0,0,0,0.15)',
          'text-halo-width':   1,
        }}
      />

      {/* ── Individual ship icon ── */}
      <Layer
        id="ais-points"
        type="symbol"
        filter={['!', ['has', 'point_count']]}
        layout={{
          'icon-image':                  IMAGE_ID,
          'icon-size':                   0.9,
          'icon-rotate':                 ['get', 'heading'],
          'icon-rotation-alignment':     'map',
          'icon-pitch-alignment':        'map',
          'icon-allow-overlap':          true,
          'icon-ignore-placement':       true,
        }}
        paint={{
          'icon-color': [
            'case',
            ['==', ['get', 'conflict'], true], '#ef4444',
            '#f59e0b',
          ],
          'icon-opacity': 0.92,
          'icon-halo-color': 'rgba(0,0,0,0.35)',
          'icon-halo-width': 1,
        }}
      />
    </Source>
  )
}

export const AIS_INTERACTIVE_LAYERS = ['ais-clusters', 'ais-points']
