export type AppMode = 'global' | 'mission' | 'route'

export interface SimulationParams {
  vessel: { vessel_speed: number; discharge_rate: number }
  feedstock: { feedstock_type: 'olivine' | 'sodium_hydroxide' }
  ocean: { temperature: number; salinity: number }
}

export interface OceanConditions {
  temperature_c: number
  salinity_psu: number
  mixed_layer_depth_m: number
  baseline_alkalinity_umol_kg: number
  fetched_at: string
}

export interface SimulationResult {
  status: 'safe' | 'unsafe'
  safety_failures: string[]
  summary: { max_aragonite_saturation: number; max_total_alkalinity: number }
  fields?: { alkalinity?: number[][]; aragonite_saturation?: number[][] }
  coordinates?: { x: number[]; y: number[]; z: number[] }
  source: 'live' | 'live-conditions' | 'mock'
  timestamp: string
  mrv_hash?: string
  ocean_state_source?: string    // e.g. "noaa_erddap+calcofi"
  ocean_conditions?: OceanConditions
}

export interface ShipStatus {
  ship_id: string
  name: string
  position: { lat: number; lon: number }
  status: 'active' | 'idle' | 'deploying'
  co2_removed_tons: number
  heading: number    // degrees true north
  speed_kn: number   // knots
}

export interface HotspotImpact {
  lat: number
  lon: number
  ocean_state: {
    temperature_c: number
    salinity_psu: number
    mixed_layer_depth_m: number
    baseline_alkalinity_umol_kg: number
    source: string
  }
  plume: {
    peak_ta_increase_umol_kg: number
    plume_area_km2: number
    plume_depth_m: number
    max_aragonite_saturation: number
    aragonite_increase: number
  }
  co2_removal: {
    year_1: { tons_co2: number; usd: number }
    year_5: { tons_co2: number; usd: number }
    year_10: { tons_co2: number; usd: number }
    year_50: { tons_co2: number; usd: number }
    annual_tons: number
    oae_efficiency: number
  }
  chemistry: {
    ph_increase: number
    ph_baseline_approx: number
    ph_after_approx: number
    co2_solubility_improvement_pct: number
    aragonite_saturation_before: number
    aragonite_saturation_after: number
  }
  economics: {
    carbon_credit_price_usd_per_ton: number
    feedstock_cost_usd_per_ton_co2: number
    net_value_usd_per_ton_co2: number
    revenue_10yr_usd: number
    revenue_50yr_usd: number
  }
  safety: {
    risk_level: 'low' | 'medium' | 'high'
    max_aragonite: number
    max_alkalinity_umol_kg: number
    within_safe_thresholds: boolean
    safety_failures: string[]
  }
  suitability_score: number
  feedstock_type: string
  data_source: string
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
