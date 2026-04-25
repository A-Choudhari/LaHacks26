export const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8001'
export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN || ''

// Framer Motion variants shared across components
export const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 420, damping: 32 },
  },
}

export const staggerList = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.07 } },
}

// Static GeoJSON — OAE deployment candidate zones (organic blob shapes)
export const OAE_ZONES = {
  type: 'FeatureCollection' as const,
  features: [
    {
      type: 'Feature' as const,
      properties: { name: 'Zone Alpha', label: 'High Priority', score: 0.92, reason: 'Deep mixed layer, high CO₂ uptake potential, no MPA overlap' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[
          [-122.8, 35.2], [-122.5, 35.9], [-121.7, 36.3],
          [-120.7, 36.1], [-120.1, 35.5], [-119.9, 34.7],
          [-120.3, 34.2], [-121.1, 34.1], [-122.0, 34.6],
          [-122.7, 34.9], [-122.8, 35.2],
        ]],
      },
    },
    {
      type: 'Feature' as const,
      properties: { name: 'Zone Beta', label: 'Medium Priority', score: 0.71, reason: 'Good MLD, moderate current flow, marginal MPA proximity' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[
          [-119.7, 33.3], [-119.2, 33.7], [-118.5, 33.8],
          [-117.9, 33.6], [-117.5, 33.1], [-117.6, 32.4],
          [-117.9, 32.0], [-118.6, 31.8], [-119.2, 32.1],
          [-119.6, 32.7], [-119.7, 33.3],
        ]],
      },
    },
    {
      type: 'Feature' as const,
      properties: { name: 'Zone Gamma', label: 'Active Deployment', score: 0.85, reason: 'Current active deployment — Pacific Guardian operational at this site' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[
          [-119.3, 34.5], [-118.9, 34.8], [-118.3, 34.7],
          [-117.8, 34.4], [-117.6, 33.9], [-117.8, 33.5],
          [-118.3, 33.3], [-119.0, 33.4], [-119.4, 33.8],
          [-119.3, 34.5],
        ]],
      },
    },
  ],
}

// Static GeoJSON — Marine Protected Areas (organic blob shapes)
export const MPA_DATA = {
  type: 'FeatureCollection' as const,
  features: [
    {
      type: 'Feature' as const,
      properties: { name: 'Channel Islands NMS', type: 'sanctuary' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[
          [-120.42, 33.97], [-120.28, 34.14], [-120.05, 34.23],
          [-119.76, 34.22], [-119.48, 34.16], [-119.18, 34.06],
          [-119.02, 33.91], [-119.10, 33.74], [-119.36, 33.67],
          [-119.64, 33.69], [-119.91, 33.75], [-120.18, 33.83],
          [-120.38, 33.91], [-120.42, 33.97],
        ]],
      },
    },
    {
      type: 'Feature' as const,
      properties: { name: 'Point Dume SMCA', type: 'conservation' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[
          [-118.858, 34.013], [-118.832, 34.038],
          [-118.800, 34.031], [-118.772, 34.010],
          [-118.765, 33.981], [-118.788, 33.964],
          [-118.822, 33.961], [-118.848, 33.978],
          [-118.858, 34.001], [-118.858, 34.013],
        ]],
      },
    },
    {
      type: 'Feature' as const,
      properties: { name: 'Santa Monica Bay CA', type: 'conservation' },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [[
          [-118.660, 34.022], [-118.608, 34.058],
          [-118.548, 34.061], [-118.490, 34.038],
          [-118.458, 33.995], [-118.476, 33.955],
          [-118.530, 33.931], [-118.594, 33.928],
          [-118.645, 33.951], [-118.668, 33.990],
          [-118.660, 34.022],
        ]],
      },
    },
  ],
}
