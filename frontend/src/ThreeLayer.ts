import * as THREE from 'three'
import mapboxgl from 'mapbox-gl'

// Ship origin for coordinate mapping
const SHIP_LNG = -118.2437
const SHIP_LAT = 34.0522

// Ω_aragonite value above which we consider the plume "enhanced"
const ARAGONITE_THRESHOLD = 4.5

// Visual altitude of the bounding box above sea surface (meters)
// Exaggerated for visibility — real plume is underwater
const BOX_MIN_ALT = 200
const BOX_MAX_ALT = 700

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

  constructor(data: PlumeSimData | null = null) {
    this.simData = data
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

    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const sizeX = Math.max(maxX - minX, 20)
    const sizeY = Math.max(maxY - minY, 20)
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
    })
    const wireframe = new THREE.LineSegments(edges, lineMat)
    wireframe.position.set(cx, cy, cz)
    this.scene.add(wireframe)

    // --- Semi-transparent floor plane at BOX_MIN_ALT ---
    const planeGeo = new THREE.PlaneGeometry(sizeX, sizeY)
    const planeMat = new THREE.MeshBasicMaterial({
      color: 0x00d4ff,
      transparent: true,
      opacity: 0.07,
      side: THREE.DoubleSide,
    })
    const plane = new THREE.Mesh(planeGeo, planeMat)
    plane.position.set(cx, cy, BOX_MIN_ALT)
    this.scene.add(plane)

    // --- Vertical corner pillars ---
    const corners = [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]]
    corners.forEach(([px, py]) => {
      const geo = new THREE.CylinderGeometry(3, 3, sizeZ, 6)
      const mat = new THREE.MeshBasicMaterial({
        color: 0x00d4ff,
        transparent: true,
        opacity: 0.4,
      })
      const pillar = new THREE.Mesh(geo, mat)
      // CylinderGeometry is along Y; rotate to align with Z (up)
      pillar.rotation.x = Math.PI / 2
      pillar.position.set(px, py, cz)
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
        const origin = new THREE.Vector3(xs[c], ys[r], BOX_MIN_ALT + 20)

        const arrow = new THREE.ArrowHelper(
          dir,
          origin,
          22,        // length (meters)
          0x00ff88,  // color
          6,         // head length
          4          // head width
        )
        this.scene.add(arrow)
      }
    }
  }

  render(_gl: WebGLRenderingContext, matrix: number[]): void {
    const { translateX, translateY, translateZ, scale } = this.modelTransform

    // Build combined transform: Mapbox matrix × local-to-Mercator transform
    // Note: Y is negated because Mapbox Mercator y increases southward
    const localToMercator = new THREE.Matrix4()
      .makeTranslation(translateX, translateY, translateZ)
      .scale(new THREE.Vector3(scale, -scale, scale))

    this.camera.projectionMatrix = new THREE.Matrix4()
      .fromArray(matrix)
      .multiply(localToMercator)

    this.renderer.resetState()
    this.renderer.render(this.scene, this.camera)
  }
}
