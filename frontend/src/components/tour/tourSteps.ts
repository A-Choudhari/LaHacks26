export interface TourStep {
  target?: string                             // data-tour="..." attribute; omit = centered modal
  title: string
  body: string
  pos?: 'top' | 'right' | 'bottom' | 'left'  // tooltip side relative to spotlight
}

export const GLOBAL_TOUR: TourStep[] = [
  {
    title: 'Welcome to OceanOps',
    body: 'This platform simulates Ocean Alkalinity Enhancement (OAE) — a carbon removal technique that adds alkaline minerals to seawater, increasing its natural CO₂ absorption. You\'re in <b>Global Intelligence</b> mode: a strategic overview of where on Earth OAE deployment will be most effective.',
  },
  {
    target: 'gi-zones',
    title: 'OAE Deployment Zones',
    body: 'Explore the example regions and any available ocean-data overlays. Each card shows a <b>suitability score</b> based on sea surface temperature, chlorophyll concentration, and mixing dynamics. Click a zone card to open its impact analysis with 50-year CO₂ projections.',
    pos: 'right',
  },
  {
    target: 'gi-calcofi',
    title: 'CalCOFI Oceanographic Data',
    body: 'Real measurements from the <b>California Cooperative Oceanic Fisheries Investigations</b> survey — 18 stations of actual CTD casts recording temperature, salinity, dissolved oxygen, and mixed layer depth. This is the same dataset used to score every deployment zone.',
    pos: 'right',
  },
  {
    target: 'gi-discover',
    title: 'AI-Powered Site Discovery',
    body: 'Click <b>Discover Optimal Zones</b> to rank candidate sites using bundled ocean conditions and simplified protected-area checks. Gemma 4 can add context when a local model is configured.',
    pos: 'right',
  },
  {
    target: 'gi-map',
    title: 'Interactive Ocean Map',
    body: 'The map shows OAE deployment zones as glowing blobs, CalCOFI sampling stations as teal circles, and Marine Protected Areas in red — shown as approximate boundaries in demo mode. <b>Click any zone</b> to open a full impact panel with revenue projections, ocean chemistry, and a safety assessment.',
    pos: 'left',
  },
]

export const MISSION_TOUR: TourStep[] = [
  {
    title: 'Welcome to Mission Control',
    body: 'Mission Control shows how a simulated alkalinity plume changes as you adjust a vessel or its discharge. Try a new scenario and compare the estimated alkalinity and aragonite saturation.',
  },
  {
    target: 'mc-sim-panel',
    title: 'Simulation Parameters',
    body: 'Adjust <b>vessel speed</b>, <b>discharge rate</b>, and <b>feedstock type</b> (Olivine vs NaOH). These feed the physics model: vessel speed sets plume length, mixed layer depth sets cross-track spread, and temperature drives olivine dissolution rate. Hit Run Simulation to fire it.',
    pos: 'right',
  },
  {
    target: 'mc-sim-controls',
    title: 'Simulation Controls',
    body: 'Ships advance every <b>1.5 seconds</b> and ocean conditions refresh every <b>45 seconds</b>. Use Pause to freeze, Resume to continue, and Reset to return ships to start. The pulsing dot turns amber when paused. Elapsed time tracks your deployment duration.',
    pos: 'right',
  },
  {
    target: 'mc-ai-panel',
    title: 'Model Thresholds and Analysis',
    body: 'After each simulation, the local <b>Geochemist Agent</b> evaluates two critical OAE thresholds: <b>Ω_aragonite &lt; 30.0</b> (above triggers runaway carbonate precipitation) and <b>total alkalinity &lt; 3500 µmol/kg</b> (above risks olivine toxicity). The demo uses rules. A configured local Gemma model can add an explanation.',
    pos: 'right',
  },
  {
    target: 'mc-map',
    title: 'Alkalinity Plume Heatmap',
    body: 'The heatmap shows the 2D surface projection of alkalinity concentration — it follows your active ship in real-time. Brighter colors indicate higher modeled alkalinity. The simplified plume responds to mixed layer depth, vessel speed, discharge rate, and feedstock.',
    pos: 'left',
  },
  {
    target: 'mc-fleet',
    title: 'Fleet Status',
    body: 'Track your three OAE vessels: <b>Pacific Guardian</b> (deploying off Channel Islands), <b>Ocean Sentinel</b> (standby south of Pt. Conception), and <b>Reef Protector</b> (monitoring north of Morro Bay). Hover any ship marker on the map for live position, heading, speed, and cumulative CO₂ removed.',
    pos: 'left',
  },
  {
    target: 'mc-impact',
    title: 'Live Impact Metrics',
    body: 'The top-center overlay shows aggregate mission performance: total CO₂ removed (tons), safety status (SAFE/UNSAFE), and the <b>MRV hash</b> — a SHA-256 cryptographic fingerprint of each simulation result logged to <code>mrv_log.jsonl</code>. This provides tamper-evident proof for carbon credit verification.',
    pos: 'bottom',
  },
]

export const ROUTE_TOUR: TourStep[] = [
  {
    title: 'Welcome to Route Planning',
    body: 'Route Planning optimizes how your fleet reaches the highest-impact OAE deployment zones. Choose <b>Fleet routes</b> to let the Spatial Intelligence Agent automatically assign each vessel the nearest high-scoring site, or <b>Manual</b> to click waypoints on the map and build a custom route.',
  },
  {
    target: 'rp-tabs',
    title: 'Two Routing Modes',
    body: '<b>Fleet routes</b> calls the Spatial Intelligence Agent — it fetches real NOAA data, scores 8 candidate sites for MPA proximity, mixed layer depth, and water chemistry, then uses a greedy nearest-neighbor algorithm (benchmarked at 1.054× optimal) to assign routes across your 3 ships. <b>Manual</b> gives you click-to-place waypoints with live CO₂ estimates per segment.',
    pos: 'right',
  },
  {
    target: 'rp-compute',
    title: 'Compute Fleet Routes',
    body: 'Clicking this fires the <b>Spatial Intelligence Agent</b> against all candidate sites. It returns top-5 zones by suitability score, filters out MPA conflicts, and assigns ships via nearest-neighbor. Each ship gets a color-coded dashed route on the map. Fleet assignment runs at <b>0.18ms per call</b>.',
    pos: 'right',
  },
  {
    target: 'rp-map',
    title: 'Route Visualization Map',
    body: 'AI-computed routes appear as glowing dashed lines per ship (cyan = Pacific Guardian, green = Ocean Sentinel, amber = Reef Protector). Pulsing lettered markers show discovered deployment sites. In Manual mode, <b>click the ocean</b> to place waypoints; click an existing waypoint to remove it. MPAs are shown in red.',
    pos: 'left',
  },
  {
    target: 'rp-ais',
    title: 'AIS Vessel Traffic',
    body: 'The right sidebar shows live <b>AIS (Automatic Identification System)</b> vessel traffic in your operational area. Red markers indicate route conflicts. This data helps you plan deployments that avoid commercial shipping lanes and fishing vessels — critical for safe OAE operations at sea.',
    pos: 'left',
  },
]

export const TOUR_STORAGE_KEYS = {
  global:  'tour_global_v1',
  mission: 'tour_mission_v1',
  route:   'tour_route_v1',
} as const
