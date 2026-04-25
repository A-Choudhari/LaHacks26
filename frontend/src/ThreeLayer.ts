import * as THREE from 'three'
import mapboxgl from 'mapbox-gl'

// Ship origin for coordinate mapping
const SHIP_LNG = -118.2437
const SHIP_LAT = 34.0522

// Ω_aragonite value above which we consider the plume "enhanced"
const ARAGONITE_THRESHOLD = 4.5

// Visual altitude of the bounding box above sea surface (meters)
// Exaggerated for visibility — real plume is underwater
const BOX_MIN_ALT = 2000
const BOX_MAX_ALT = 8000

// Scale factors to match the 2D heatmap coordinate system
// The heatmap uses 0.008° lon per grid cell ≈ 890m, 0.004° lat per grid cell ≈ 445m
// With 50 grid cells, that's ~35km x 22km total span
// The raw data is 500m x 500m, so we scale up by ~70x
const COORD_SCALE = 70

// Color stops for alkalinity gradient (blue → cyan → green → yellow → orange)
const ALKALINITY_COLORS = [
  [0, 100, 255],   // low - blue
  [0, 200, 255],   // cyan
  [0, 255, 200],   // teal
  [100, 255, 100], // green
  [255, 255, 0],   // yellow
  [255, 100, 0],   // high - orange
]

export interface PlumeSimData {
  fields: {
    alkalinity: number[][]
    aragonite_saturation: number[][]
  }
  coordinates: {
    x: number[]
    y: number[]
    z: number[]
  }
}

export class PlumeThreeLayer implements mapboxgl.CustomLayerInterface {
  readonly id = 'plume-three-layer'
  readonly type = 'custom' as const
  readonly renderingMode = '3d' as const

  private scene!: THREE.Scene
  private camera!: THREE.Camera
  private renderer!: THREE.WebGLRenderer
  private map!: mapboxgl.Map
  private modelTransform!: {
    translateX: number
    translateY: number
    translateZ: number
    scale: number
  }
  private simData: PlumeSimData | null = null
  private depthLevel: number = 0.5 // 0-1 normalized depth (0 = top, 1 = bottom)
  private sectionPlane: THREE.Mesh | null = null

  constructor(data: PlumeSimData | null = null) {
    this.simData = data
  }

  /** Set the depth level for the section cut (0 = top of plume, 1 = bottom) */
  setDepthLevel(level: number): void {
    this.depthLevel = Math.max(0, Math.min(1, level))
    if (this.simData && this.scene) {
      // Remove existing section plane and its edge
      if (this.sectionPlane) {
        this.scene.remove(this.sectionPlane)
        if (this.sectionPlane.geometry) this.sectionPlane.geometry.dispose()
        if (this.sectionPlane.material) {
          const mat = this.sectionPlane.material as THREE.MeshBasicMaterial
          if (mat.map) mat.map.dispose()
          mat.dispose()
        }
        this.sectionPlane = null
      }
      // Also remove edge line if it exists
      const edgeLine = this.scene.getObjectByName('section-edge')
      if (edgeLine) {
        this.scene.remove(edgeLine)
        if ((edgeLine as any).geometry) (edgeLine as any).geometry.dispose()
        if ((edgeLine as any).material) (edgeLine as any).material.dispose()
      }
      this.buildSectionCut()
      this.map?.triggerRepaint()
    }
  }

  onAdd(map: mapboxgl.Map, gl: WebGLRenderingContext): void {
    this.map = map
    this.camera = new THREE.Camera()
    this.scene = new THREE.Scene()

    // Compute Mercator origin + scale factor at ship position
    const origin = mapboxgl.MercatorCoordinate.fromLngLat(
      { lng: SHIP_LNG, lat: SHIP_LAT },
      0
    )
    this.modelTransform = {
      translateX: origin.x,
      translateY: origin.y,
      translateZ: origin.z,
      scale: origin.meterInMercatorCoordinateUnits(),
    }

    if (this.simData) this.buildScene()

    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl as WebGLRenderingContext,
      antialias: true,
    })
    this.renderer.autoClear = false
  }

  /** Call after receiving new simulation results to update the 3D overlay. */
  updateData(data: PlumeSimData): void {
    this.simData = data
    if (this.scene) {
      // Dispose old objects
      while (this.scene.children.length > 0) {
        const obj = this.scene.children[0]
        this.scene.remove(obj)
        if ((obj as any).geometry) (obj as any).geometry.dispose()
        if ((obj as any).material) (obj as any).material.dispose()
      }
      this.buildScene()
      this.map?.triggerRepaint()
    }
  }

  private buildScene(): void {
    this.buildIsosurfaceBBox()
    this.buildVelocityArrows()
    this.buildSectionCut()
  }

  /**
   * Finds the 2D footprint of all cells where Ω_aragonite > threshold,
   * then renders a wireframe box at a visible altitude above the ocean.
   */
  private buildIsosurfaceBBox(): void {
    const { coordinates, fields } = this.simData!
    const aragonite = fields.aragonite_saturation
    const xs = coordinates.x
    const ys = coordinates.y

    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity

    for (let row = 0; row < aragonite.length; row++) {
      for (let col = 0; col < (aragonite[row]?.length ?? 0); col++) {
        if (aragonite[row][col] > ARAGONITE_THRESHOLD) {
          if (xs[col] < minX) minX = xs[col]
          if (xs[col] > maxX) maxX = xs[col]
          if (ys[row] < minY) minY = ys[row]
          if (ys[row] > maxY) maxY = ys[row]
        }
      }
    }

    if (!isFinite(minX)) return

    // Scale up coordinates to match heatmap (which uses ~70x larger grid)
    const cx = ((minX + maxX) / 2 - 250) * COORD_SCALE  // Center relative to grid midpoint
    const cy = ((minY + maxY) / 2) * COORD_SCALE
    const sizeX = Math.max(maxX - minX, 20) * COORD_SCALE
    const sizeY = Math.max(maxY - minY, 20) * COORD_SCALE
    const sizeZ = BOX_MAX_ALT - BOX_MIN_ALT
    const cz = (BOX_MIN_ALT + BOX_MAX_ALT) / 2

    // --- Wireframe bounding box ---
    const boxGeo = new THREE.BoxGeometry(sizeX, sizeY, sizeZ)
    const edges = new THREE.EdgesGeometry(boxGeo)
    boxGeo.dispose()
    const lineMat = new THREE.LineBasicMaterial({
      color: 0x00d4ff,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    })
    const wireframe = new THREE.LineSegments(edges, lineMat)
    wireframe.position.set(cx, cy, cz)
    wireframe.renderOrder = 10
    this.scene.add(wireframe)

    // --- Semi-transparent floor plane at BOX_MIN_ALT ---
    const planeGeo = new THREE.PlaneGeometry(sizeX, sizeY)
    const planeMat = new THREE.MeshBasicMaterial({
      color: 0x00d4ff,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
      depthTest: false,
    })
    const plane = new THREE.Mesh(planeGeo, planeMat)
    plane.position.set(cx, cy, BOX_MIN_ALT)
    plane.renderOrder = 5
    this.scene.add(plane)

    // --- Vertical corner pillars ---
    const corners = [
      [(minX - 250) * COORD_SCALE, minY * COORD_SCALE],
      [(maxX - 250) * COORD_SCALE, minY * COORD_SCALE],
      [(maxX - 250) * COORD_SCALE, maxY * COORD_SCALE],
      [(minX - 250) * COORD_SCALE, maxY * COORD_SCALE],
    ]
    corners.forEach(([px, py]) => {
      const geo = new THREE.CylinderGeometry(200, 200, sizeZ, 6) // Larger pillars
      const mat = new THREE.MeshBasicMaterial({
        color: 0x00d4ff,
        transparent: true,
        opacity: 0.5,
        depthTest: false,
      })
      const pillar = new THREE.Mesh(geo, mat)
      // CylinderGeometry is along Y; rotate to align with Z (up)
      pillar.rotation.x = Math.PI / 2
      pillar.position.set(px, py, cz)
      pillar.renderOrder = 8
      this.scene.add(pillar)
    })
  }

  /**
   * Approximates ocean current vectors from the alkalinity gradient
   * and renders ArrowHelper instances on a coarse grid.
   */
  private buildVelocityArrows(): void {
    const { fields, coordinates } = this.simData!
    const alk = fields.alkalinity
    const xs = coordinates.x
    const ys = coordinates.y
    const rows = alk.length
    const cols = alk[0]?.length ?? 0
    const step = Math.max(4, Math.floor(rows / 10))

    for (let r = step; r < rows - step; r += step) {
      for (let c = step; c < cols - step; c += step) {
        const dvx = (alk[r][c + 1] ?? alk[r][c]) - (alk[r][c - 1] ?? alk[r][c])
        const dvy =
          ((alk[r + 1]?.[c] ?? alk[r][c]) - (alk[r - 1]?.[c] ?? alk[r][c]))

        const mag = Math.sqrt(dvx * dvx + dvy * dvy)
        if (mag < 8) continue // skip negligible gradient

        const dir = new THREE.Vector3(dvx / mag, dvy / mag, 0).normalize()
        const scaledX = (xs[c] - 250) * COORD_SCALE
        const scaledY = ys[r] * COORD_SCALE
        const origin = new THREE.Vector3(scaledX, scaledY, BOX_MIN_ALT + 500)

        const arrow = new THREE.ArrowHelper(
          dir,
          origin,
          1500,      // length (meters) - scaled up
          0x00ff88,  // color
          400,       // head length
          300        // head width
        )
        // Disable depth test on arrow materials
        arrow.traverse((child) => {
          if ((child as any).material) {
            (child as any).material.depthTest = false
          }
        })
        arrow.renderOrder = 15
        this.scene.add(arrow)
      }
    }
  }

  /**
   * Builds a horizontal section cut plane showing alkalinity concentration
   * as a colored texture at the current depth level.
   */
  private buildSectionCut(): void {
    const { fields, coordinates } = this.simData!
    const alk = fields.alkalinity
    const xs = coordinates.x
    const ys = coordinates.y
    const rows = alk.length
    const cols = alk[0]?.length ?? 0

    if (rows === 0 || cols === 0) return

    // Find data bounds
    let minX = Infinity, maxX = -Infinity
    let minY = Infinity, maxY = -Infinity
    let minAlk = Infinity, maxAlk = -Infinity

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const val = alk[r]?.[c] ?? 0
        if (val > 0) {
          if (xs[c] < minX) minX = xs[c]
          if (xs[c] > maxX) maxX = xs[c]
          if (ys[r] < minY) minY = ys[r]
          if (ys[r] > maxY) maxY = ys[r]
          if (val < minAlk) minAlk = val
          if (val > maxAlk) maxAlk = val
        }
      }
    }

    if (!isFinite(minX) || !isFinite(minAlk)) return

    // Calculate z position based on depth level
    const zPos = BOX_MAX_ALT - this.depthLevel * (BOX_MAX_ALT - BOX_MIN_ALT)
    // Scale up coordinates to match heatmap
    const sizeX = Math.max(maxX - minX, 20) * COORD_SCALE
    const sizeY = Math.max(maxY - minY, 20) * COORD_SCALE
    const cx = ((minX + maxX) / 2 - 250) * COORD_SCALE
    const cy = ((minY + maxY) / 2) * COORD_SCALE

    // Create texture data (RGBA)
    const textureData = new Uint8Array(rows * cols * 4)
    const alkRange = maxAlk - minAlk || 1

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = (r * cols + c) * 4
        const val = alk[r]?.[c] ?? 0

        if (val <= 0) {
          // Transparent for no data
          textureData[idx] = 0
          textureData[idx + 1] = 0
          textureData[idx + 2] = 0
          textureData[idx + 3] = 0
        } else {
          // Normalize to 0-1 and map to color gradient
          const t = (val - minAlk) / alkRange
          const colorIdx = Math.min(t * (ALKALINITY_COLORS.length - 1), ALKALINITY_COLORS.length - 1.001)
          const lower = Math.floor(colorIdx)
          const upper = Math.ceil(colorIdx)
          const frac = colorIdx - lower

          const c1 = ALKALINITY_COLORS[lower]
          const c2 = ALKALINITY_COLORS[upper]

          textureData[idx] = Math.round(c1[0] + frac * (c2[0] - c1[0]))
          textureData[idx + 1] = Math.round(c1[1] + frac * (c2[1] - c1[1]))
          textureData[idx + 2] = Math.round(c1[2] + frac * (c2[2] - c1[2]))
          textureData[idx + 3] = Math.round(200 + t * 55) // More opaque for visibility
        }
      }
    }

    // Create DataTexture
    const texture = new THREE.DataTexture(textureData, cols, rows, THREE.RGBAFormat)
    texture.needsUpdate = true
    texture.magFilter = THREE.LinearFilter
    texture.minFilter = THREE.LinearFilter

    // Create plane geometry and material
    const planeGeo = new THREE.PlaneGeometry(sizeX, sizeY)
    const planeMat = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    })

    // Create mesh
    this.sectionPlane = new THREE.Mesh(planeGeo, planeMat)
    this.sectionPlane.position.set(cx, cy, zPos)
    this.sectionPlane.renderOrder = 20
    this.scene.add(this.sectionPlane)

    // Add a bright edge around the section cut for visibility
    const edgeGeo = new THREE.EdgesGeometry(planeGeo)
    const edgeMat = new THREE.LineBasicMaterial({
      color: 0xffff00, // bright yellow
      linewidth: 2,
      depthTest: false,
    })
    const edgeLine = new THREE.LineSegments(edgeGeo, edgeMat)
    edgeLine.name = 'section-edge'
    edgeLine.position.set(cx, cy, zPos)
    edgeLine.renderOrder = 25
    this.scene.add(edgeLine)
  }

  render(_gl: WebGLRenderingContext, matrix: number[]): void {
    if (!this.modelTransform || !this.scene || !this.camera || !this.renderer) {
      return
    }

    const { translateX, translateY, translateZ, scale } = this.modelTransform

    // Rotation to convert from Three.js Y-up to Mapbox Z-up coordinate system
    const rotationX = new THREE.Matrix4().makeRotationAxis(
      new THREE.Vector3(1, 0, 0),
      Math.PI / 2  // Rotate 90 degrees around X
    )

    // Build the model transformation matrix
    const modelMatrix = new THREE.Matrix4()
      .makeTranslation(translateX, translateY, translateZ)
      .scale(new THREE.Vector3(scale, -scale, scale))
      .multiply(rotationX)

    // Combine Mapbox's projection matrix with our model transform
    this.camera.projectionMatrix = new THREE.Matrix4()
      .fromArray(matrix)
      .multiply(modelMatrix)

    this.renderer.resetState()

    // Disable depth test to render on top of Mapbox tiles
    const gl = this.renderer.getContext()
    gl.disable(gl.DEPTH_TEST)

    this.renderer.render(this.scene, this.camera)

    // Re-enable for Mapbox
    gl.enable(gl.DEPTH_TEST)
  }
}
