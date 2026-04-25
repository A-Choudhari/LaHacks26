import { Source, Layer } from 'react-map-gl'
import { MPA_DATA } from '../../constants'

export function MPAOverlay() {
  return (
    <Source id="mpa" type="geojson" data={MPA_DATA}>
      <Layer
        id="mpa-glow"
        type="line"
        paint={{ 'line-color': '#f87171', 'line-width': 14, 'line-blur': 10, 'line-opacity': 0.12 }}
      />
      <Layer
        id="mpa-fill"
        type="fill"
        paint={{ 'fill-color': '#f87171', 'fill-opacity': 0.07 }}
      />
      <Layer
        id="mpa-outline"
        type="line"
        paint={{ 'line-color': '#f87171', 'line-width': 1.8, 'line-dasharray': [1.5, 2.5], 'line-opacity': 0.7 }}
      />
    </Source>
  )
}
