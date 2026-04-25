export type AppMode = 'global' | 'mission' | 'route'

export interface SimulationParams {
  vessel: { vessel_speed: number; discharge_rate: number }
  feedstock: { feedstock_type: 'olivine' | 'sodium_hydroxide' }
  ocean: { temperature: number; salinity: number }
}

export interface SimulationResult {
  status: 'safe' | 'unsafe'
  safety_failures: string[]
  summary: { max_aragonite_saturation: number; max_total_alkalinity: number }
  fields?: { alkalinity?: number[][]; aragonite_saturation?: number[][] }
  coordinates?: { x: number[]; y: number[]; z: number[] }
  source: 'live' | 'mock'
  timestamp: string
  mrv_hash?: string
}

export interface ShipStatus {
  ship_id: string
  name: string
  position: { lat: number; lon: number }
  status: 'active' | 'idle' | 'deploying'
  co2_removed_tons: number
}

export interface AnalysisResult {
  safety_assessment: string
  co2_projection: string
  recommendations: string[]
  confidence: number
  model_used: string
}

export interface CalCOFIStation {
  station_id: string
  lat: number
  lon: number
  temperature_c: number
  salinity_psu: number
  alkalinity_umol_kg: number
  chlorophyll_mg_m3: number
  suitability_score: number
}

export interface DiscoveryZone {
  lat: number
  lon: number
  score: number
  reason: string
  mpa_conflict: boolean
}
