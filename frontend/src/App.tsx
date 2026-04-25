import { useState } from 'react'
import { QueryClient, QueryClientProvider, useQuery, useMutation } from '@tanstack/react-query'
import Map, { Source, Layer, Marker } from 'react-map-gl'
import 'mapbox-gl/dist/mapbox-gl.css'

const queryClient = new QueryClient()

// API base URL
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8001'

// Mapbox token - replace with your token
const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || 'YOUR_MAPBOX_TOKEN'

interface SimulationParams {
  vessel: {
    vessel_speed: number
    discharge_rate: number
  }
  feedstock: {
    feedstock_type: 'olivine' | 'sodium_hydroxide'
  }
  ocean: {
    temperature: number
    salinity: number
  }
}

interface SimulationResult {
  status: 'safe' | 'unsafe'
  safety_failures: string[]
  summary: {
    max_aragonite_saturation: number
    max_total_alkalinity: number
  }
  fields?: {
    alkalinity?: number[][]
    aragonite_saturation?: number[][]
  }
  coordinates?: {
    x: number[]
    y: number[]
    z: number[]
  }
  source: 'live' | 'mock'
  timestamp: string
}

interface ShipStatus {
  ship_id: string
  name: string
  position: { lat: number; lon: number }
  status: 'active' | 'idle' | 'deploying'
  co2_removed_tons: number
}

// Simulation control panel
function SimulationPanel({ onRun, isLoading, result }: {
  onRun: (params: SimulationParams) => void
  isLoading: boolean
  result?: SimulationResult
}) {
  const [vesselSpeed, setVesselSpeed] = useState(5.0)
  const [dischargeRate, setDischargeRate] = useState(0.1)
  const [feedstock, setFeedstock] = useState<'olivine' | 'sodium_hydroxide'>('olivine')

  const handleSubmit = () => {
    console.log('handleSubmit called')
    onRun({
      vessel: { vessel_speed: vesselSpeed, discharge_rate: dischargeRate },
      feedstock: { feedstock_type: feedstock },
      ocean: { temperature: 15.0, salinity: 35.0 }
    })
  }

  return (
    <div className="panel simulation-panel">
      <h2>Mission Control</h2>

      <div className="param-group">
        <label>Vessel Speed (m/s)</label>
        <input
          type="range"
          min="1"
          max="15"
          step="0.5"
          value={vesselSpeed}
          onChange={(e) => setVesselSpeed(parseFloat(e.target.value))}
        />
        <span>{vesselSpeed}</span>
      </div>

      <div className="param-group">
        <label>Discharge Rate (m³/s)</label>
        <input
          type="range"
          min="0.01"
          max="1.0"
          step="0.01"
          value={dischargeRate}
          onChange={(e) => setDischargeRate(parseFloat(e.target.value))}
        />
        <span>{dischargeRate}</span>
      </div>

      <div className="param-group">
        <label>Feedstock</label>
        <select value={feedstock} onChange={(e) => setFeedstock(e.target.value as any)}>
          <option value="olivine">Olivine</option>
          <option value="sodium_hydroxide">Sodium Hydroxide</option>
        </select>
      </div>

      <button onClick={handleSubmit} disabled={isLoading}>
        {isLoading ? 'Simulating...' : 'Run Simulation'}
      </button>

      {result && (
        <div className={`result ${result.status}`}>
          <h3>Result: {result.status.toUpperCase()}</h3>
          <p>Source: {result.source}</p>
          <p>Max Ω aragonite: {result.summary.max_aragonite_saturation.toFixed(2)}</p>
          <p>Max TA: {result.summary.max_total_alkalinity.toFixed(0)} µmol/kg</p>
          {result.safety_failures.length > 0 && (
            <ul className="failures">
              {result.safety_failures.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// Fleet status panel (Arista challenge)
function FleetPanel({ ships }: { ships?: ShipStatus[] }) {
  if (!ships) return null

  const totalCO2 = ships.reduce((sum, s) => sum + s.co2_removed_tons, 0)

  return (
    <div className="panel fleet-panel">
      <h2>Fleet Status</h2>
      <div className="fleet-summary">
        <div className="metric">
          <span className="value">{ships.length}</span>
          <span className="label">Ships</span>
        </div>
        <div className="metric">
          <span className="value">{totalCO2.toFixed(0)}</span>
          <span className="label">Tons CO₂ Removed</span>
        </div>
      </div>
      <div className="ship-list">
        {ships.map(ship => (
          <div key={ship.ship_id} className={`ship-card ${ship.status}`}>
            <div className="ship-name">{ship.name}</div>
            <div className="ship-status">{ship.status}</div>
            <div className="ship-co2">{ship.co2_removed_tons.toFixed(1)} tons CO₂</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// AI Analysis response type
interface AnalysisResult {
  safety_assessment: string
  co2_projection: string
  recommendations: string[]
  confidence: number
  model_used: string
}

// AI Analysis panel
function AIPanel({ result }: { result?: SimulationResult }) {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const analyzeSimulation = async () => {
    if (!result) return

    setIsAnalyzing(true)
    setError(null)

    try {
      const response = await fetch(`${API_URL}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          simulation_result: {
            summary: result.summary,
            params: {
              feedstock_type: 'olivine',
              temperature: 15,
              discharge_rate: 0.1
            }
          },
          analysis_type: 'full'
        })
      })

      if (!response.ok) throw new Error('Analysis failed')

      const data: AnalysisResult = await response.json()
      setAnalysis(data)
    } catch (err) {
      setError('Failed to analyze results. Is the backend running?')
    } finally {
      setIsAnalyzing(false)
    }
  }

  return (
    <div className="panel ai-panel">
      <h2>AI Analysis</h2>
      <button onClick={analyzeSimulation} disabled={!result || isAnalyzing}>
        {isAnalyzing ? 'Analyzing...' : 'Analyze Results'}
      </button>

      {error && <div className="error">{error}</div>}

      {analysis && (
        <div className="analysis">
          <div className="analysis-section">
            <h4>Safety Assessment</h4>
            <p>{analysis.safety_assessment}</p>
          </div>

          <div className="analysis-section">
            <h4>CO₂ Projection</h4>
            <p>{analysis.co2_projection}</p>
          </div>

          <div className="analysis-section">
            <h4>Recommendations</h4>
            <ul>
              {analysis.recommendations.map((rec, i) => (
                <li key={i}>{rec}</li>
              ))}
            </ul>
          </div>

          <div className="analysis-meta">
            Model: {analysis.model_used} | Confidence: {(analysis.confidence * 100).toFixed(0)}%
          </div>
        </div>
      )}
    </div>
  )
}

// Heatmap layer for plume visualization
function PlumeHeatmap({ visible, simulationData }: { visible: boolean; simulationData?: SimulationResult }) {
  // Base location for plume (Pacific Guardian ship position)
  const baseLon = -118.2437
  const baseLat = 34.0522

  // Generate heatmap from simulation alkalinity data or use demo pattern
  const generateHeatmapFeatures = () => {
    if (!visible) return []

    // If we have simulation data with alkalinity field, use it
    if (simulationData?.fields?.alkalinity) {
      const alkalinity = simulationData.fields.alkalinity as number[][]
      const features: any[] = []

      // Convert grid data to geographic points
      const gridSize = alkalinity.length
      for (let i = 0; i < gridSize; i++) {
        for (let j = 0; j < (alkalinity[i]?.length || 0); j++) {
          const value = alkalinity[i][j]
          // Normalize alkalinity (2300-3500 range) to 0-1 intensity
          const intensity = Math.max(0, Math.min(1, (value - 2300) / 1200))

          if (intensity > 0.05) {
            features.push({
              type: 'Feature' as const,
              properties: { intensity },
              geometry: {
                type: 'Point' as const,
                coordinates: [
                  baseLon + (j - gridSize / 2) * 0.008,
                  baseLat + (i - gridSize / 2) * 0.004
                ]
              }
            })
          }
        }
      }
      return features
    }

    // Fallback: Gaussian plume pattern for demo
    const features: any[] = []
    for (let i = 0; i < 80; i++) {
      const angle = (i / 80) * Math.PI * 2
      const distance = Math.random() * 0.04
      const intensity = Math.exp(-distance * 30) * (0.5 + Math.random() * 0.5)

      features.push({
        type: 'Feature' as const,
        properties: { intensity },
        geometry: {
          type: 'Point' as const,
          coordinates: [
            baseLon + Math.cos(angle) * distance,
            baseLat + Math.sin(angle) * distance * 0.5
          ]
        }
      })
    }
    return features
  }

  const heatmapData = {
    type: 'FeatureCollection' as const,
    features: generateHeatmapFeatures()
  }

  return (
    <Source id="plume" type="geojson" data={heatmapData}>
      <Layer
        id="plume-heat"
        type="heatmap"
        paint={{
          'heatmap-weight': ['get', 'intensity'],
          'heatmap-intensity': 1.5,
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0, 'rgba(0, 0, 255, 0)',
            0.1, 'rgba(0, 100, 255, 0.3)',
            0.3, 'rgba(0, 200, 255, 0.5)',
            0.5, 'rgba(0, 255, 200, 0.6)',
            0.7, 'rgba(100, 255, 100, 0.7)',
            0.85, 'rgba(255, 255, 0, 0.8)',
            1, 'rgba(255, 100, 0, 0.9)'
          ],
          'heatmap-radius': 40,
          'heatmap-opacity': 0.85
        }}
      />
    </Source>
  )
}

// Marine Protected Area overlay
function MPAOverlay() {
  // Mock MPA data for Channel Islands National Marine Sanctuary area
  const mpaData = {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        properties: { name: 'Channel Islands NMS', type: 'sanctuary' },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[
            [-119.9, 34.15],
            [-119.9, 33.85],
            [-119.3, 33.85],
            [-119.3, 34.15],
            [-119.9, 34.15]
          ]]
        }
      },
      {
        type: 'Feature' as const,
        properties: { name: 'Point Dume SMCA', type: 'conservation' },
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[
            [-118.82, 34.02],
            [-118.82, 33.98],
            [-118.75, 33.98],
            [-118.75, 34.02],
            [-118.82, 34.02]
          ]]
        }
      }
    ]
  }

  return (
    <Source id="mpa" type="geojson" data={mpaData}>
      <Layer
        id="mpa-fill"
        type="fill"
        paint={{
          'fill-color': '#ef4444',
          'fill-opacity': 0.15
        }}
      />
      <Layer
        id="mpa-outline"
        type="line"
        paint={{
          'line-color': '#ef4444',
          'line-width': 2,
          'line-dasharray': [3, 2]
        }}
      />
    </Source>
  )
}

// Map legend for alkalinity heatmap and MPA
function MapLegend({ visible }: { visible: boolean }) {
  return (
    <div className="map-legend">
      <div className="legend-item">
        <div className="legend-mpa"></div>
        <span>Marine Protected Area</span>
      </div>
      {visible && (
        <>
          <div className="legend-title">Alkalinity (µmol/kg)</div>
          <div className="legend-bar">
            <div className="legend-gradient"></div>
            <div className="legend-labels">
              <span>2300</span>
              <span>2900</span>
              <span>3500</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// Impact metrics overlay
function ImpactMetrics({ result, fleet }: { result?: SimulationResult; fleet?: ShipStatus[] }) {
  const totalCO2 = fleet?.reduce((sum, s) => sum + s.co2_removed_tons, 0) || 0
  const maxAlk = result?.summary?.max_total_alkalinity || 0
  const isSafe = result?.status === 'safe'

  // Estimate CO2 impact from this simulation
  const estimatedCO2 = maxAlk > 2300 ? ((maxAlk - 2300) * 0.8 * 44 * 25) / 1e6 : 0

  return (
    <div className="impact-metrics">
      <div className="impact-card">
        <div className="impact-value">{totalCO2.toFixed(0)}</div>
        <div className="impact-label">Total CO₂ Removed (tons)</div>
      </div>
      {result && (
        <>
          <div className="impact-card">
            <div className={`impact-value ${isSafe ? 'safe' : 'unsafe'}`}>
              {isSafe ? 'SAFE' : 'UNSAFE'}
            </div>
            <div className="impact-label">Deployment Status</div>
          </div>
          <div className="impact-card">
            <div className="impact-value">+{estimatedCO2.toFixed(1)}</div>
            <div className="impact-label">Est. CO₂ Impact (tons)</div>
          </div>
        </>
      )}
    </div>
  )
}

// Main app
function AppContent() {
  const [simulationResult, setSimulationResult] = useState<SimulationResult>()
  const [showPlume, setShowPlume] = useState(false)

  // Fetch fleet status
  const { data: fleet } = useQuery({
    queryKey: ['fleet'],
    queryFn: () => fetch(`${API_URL}/fleet`).then(r => r.json()),
    refetchInterval: 10000
  })

  // Simulation mutation
  const simulateMutation = useMutation({
    mutationFn: async (params: SimulationParams) => {
      console.log('Starting simulation with params:', params)
      const res = await fetch(`${API_URL}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      })
      if (!res.ok) {
        const error = await res.text()
        console.error('Simulation failed:', error)
        throw new Error('Simulation failed')
      }
      const data = await res.json()
      console.log('Simulation result:', data)
      return data
    },
    onSuccess: (data) => {
      console.log('Setting simulation result')
      setSimulationResult(data)
      setShowPlume(true)
    },
    onError: (error) => {
      console.error('Mutation error:', error)
      alert('Simulation failed: ' + error.message)
    }
  })

  return (
    <div className="app">
      <header>
        <h1>The Tiered Edge Fleet</h1>
        <span className="subtitle">Ocean Alkalinity Enhancement Platform</span>
      </header>

      <main>
        <div className="sidebar">
          <SimulationPanel
            onRun={(params) => simulateMutation.mutate(params)}
            isLoading={simulateMutation.isPending}
            result={simulationResult}
          />
          <AIPanel result={simulationResult} />
        </div>

        <div className="map-container">
          <Map
            initialViewState={{
              longitude: -118.2437,
              latitude: 34.0522,
              zoom: 10
            }}
            style={{ width: '100%', height: '100%' }}
            mapStyle="mapbox://styles/mapbox/dark-v11"
            mapboxAccessToken={MAPBOX_TOKEN}
          >
            <MPAOverlay />
            <PlumeHeatmap visible={showPlume} simulationData={simulationResult} />

            {/* Ship markers */}
            {fleet?.map((ship: ShipStatus) => (
              <Marker
                key={ship.ship_id}
                longitude={ship.position.lon}
                latitude={ship.position.lat}
              >
                <div className={`ship-marker ${ship.status}`}>
                  🚢
                </div>
              </Marker>
            ))}
          </Map>
          <MapLegend visible={showPlume} />
          <ImpactMetrics result={simulationResult} fleet={fleet} />
        </div>

        <div className="sidebar right">
          <FleetPanel ships={fleet} />
        </div>
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
