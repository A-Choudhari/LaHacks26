import re

with open('frontend/src/ThreeLayer.ts', 'r') as f:
    content = f.read()

# 1. Add class properties
props_search = "private sectionPlane: THREE.Mesh | null = null"
props_replace = """private sectionPlane: THREE.Mesh | null = null
  private clock = new THREE.Clock()
  private flowParticles: THREE.Points | null = null
  private particleVelocities: THREE.Vector3[] = []
  private particleOrigins: THREE.Vector3[] = []
  private wireframeBox: THREE.LineSegments | null = null
  private animatedArrows: { arrow: THREE.ArrowHelper, origin: THREE.Vector3, dir: THREE.Vector3 }[] = []"""

content = content.replace(props_search, props_replace)

# 2. Capture wireframe in buildIsosurfaceBBox
wireframe_search = """    const wireframe = new THREE.LineSegments(edges, lineMat)
    wireframe.position.set(cx, cy, cz)
    wireframe.renderOrder = 10
    this.scene.add(wireframe)"""
wireframe_replace = """    const wireframe = new THREE.LineSegments(edges, lineMat)
    wireframe.position.set(cx, cy, cz)
    wireframe.renderOrder = 10
    this.wireframeBox = wireframe
    this.scene.add(wireframe)"""

content = content.replace(wireframe_search, wireframe_replace)

# 3. Add flow particles in buildVelocityArrows (and animate arrows)
build_arrows_search = r"  private buildVelocityArrows\(\): void \{.*?(?=\s+/\*\*\n\s+\* Builds a horizontal)"
build_arrows_replace = """  private buildVelocityArrows(): void {
    const { fields, coordinates } = this.simData!
    const alk = fields.alkalinity
    const xs = coordinates.x
    const ys = coordinates.y
    const rows = alk.length
    const cols = alk[0]?.length ?? 0
    const step = Math.max(3, Math.floor(rows / 12)) // More dense

    this.animatedArrows = []
    this.particleVelocities = []
    this.particleOrigins = []

    const particlePositions: number[] = []
    const particleColors: number[] = []
    const color = new THREE.Color(0x00ffcc)

    for (let r = step; r < rows - step; r += step) {
      for (let c = step; c < cols - step; c += step) {
        const dvx = (alk[r][c + 1] ?? alk[r][c]) - (alk[r][c - 1] ?? alk[r][c])
        const dvy =
          ((alk[r + 1]?.[c] ?? alk[r][c]) - (alk[r - 1]?.[c] ?? alk[r][c]))

        const mag = Math.sqrt(dvx * dvx + dvy * dvy)
        if (mag < 5) continue // skip negligible gradient

        const dir = new THREE.Vector3(dvx / mag, dvy / mag, 0).normalize()
        const scaledX = (xs[c] - 250) * COORD_SCALE
        const scaledY = ys[r] * COORD_SCALE
        const origin = new THREE.Vector3(scaledX, scaledY, BOX_MIN_ALT + 200 + Math.random() * 800)

        // Only draw arrows for every other point to avoid clutter
        if ((r + c) % (step * 2) === 0) {
          const arrow = new THREE.ArrowHelper(dir, origin, 1200, 0x00ff88, 300, 200)
          arrow.traverse((child) => {
            if ((child as any).material) {
              (child as any).material.depthTest = false
              ;(child as any).material.transparent = true
              ;(child as any).material.opacity = 0.6
            }
          })
          arrow.renderOrder = 15
          this.scene.add(arrow)
          this.animatedArrows.push({ arrow, origin: origin.clone(), dir })
        }

        // Add 2-3 particles per flow point
        for (let i = 0; i < 3; i++) {
          const pOrigin = origin.clone().add(new THREE.Vector3(
            (Math.random() - 0.5) * 800,
            (Math.random() - 0.5) * 800,
            (Math.random() - 0.5) * 800
          ))
          particlePositions.push(pOrigin.x, pOrigin.y, pOrigin.z)
          color.setHSL(0.45 + Math.random() * 0.1, 1.0, 0.6 + Math.random() * 0.4)
          particleColors.push(color.r, color.g, color.b)
          this.particleOrigins.push(pOrigin)
          
          // Velocity includes an upward drift
          const pVel = dir.clone().multiplyScalar(600 + Math.random() * 400)
          pVel.z = 200 + Math.random() * 300
          this.particleVelocities.push(pVel)
        }
      }
    }

    if (particlePositions.length > 0) {
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(particlePositions, 3))
      geo.setAttribute('color', new THREE.Float32BufferAttribute(particleColors, 3))
      
      // Use a glowing additive blending material
      const mat = new THREE.PointsMaterial({
        size: 150,
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthTest: false,
      })
      
      this.flowParticles = new THREE.Points(geo, mat)
      this.flowParticles.renderOrder = 18
      this.scene.add(this.flowParticles)
    }
  }
"""

content = re.sub(build_arrows_search, build_arrows_replace, content, flags=re.DOTALL)

# 4. Add animation to render loop
render_search = """    // Disable depth test to render on top of Mapbox tiles
    const gl = this.renderer.getContext()
    gl.disable(gl.DEPTH_TEST)

    this.renderer.render(this.scene, this.camera)"""

render_replace = """    // --- ANIMATION UPDATE ---
    const dt = Math.min(this.clock.getDelta(), 0.1)
    const elapsed = this.clock.getElapsedTime()

    if (this.wireframeBox) {
      const mat = this.wireframeBox.material as THREE.LineBasicMaterial
      mat.opacity = 0.4 + 0.5 * Math.sin(elapsed * 2)
    }

    if (this.animatedArrows.length > 0) {
      this.animatedArrows.forEach(item => {
        // Arrows bob back and forth along their direction
        const offset = Math.sin(elapsed * 3 + item.origin.x) * 400
        item.arrow.position.copy(item.origin).addScaledVector(item.dir, offset)
      })
    }

    if (this.flowParticles) {
      const posAttr = this.flowParticles.geometry.attributes.position
      const positions = posAttr.array as Float32Array
      for (let i = 0; i < this.particleVelocities.length; i++) {
        const vel = this.particleVelocities[i]
        const orig = this.particleOrigins[i]
        const idx = i * 3
        
        let px = positions[idx] + vel.x * dt
        let py = positions[idx + 1] + vel.y * dt
        let pz = positions[idx + 2] + vel.z * dt
        
        // Reset particle if it travels too far from its origin
        const distSq = (px - orig.x)**2 + (py - orig.y)**2 + (pz - orig.z)**2
        if (distSq > 4000000 || pz > BOX_MAX_ALT) { // ~2000 units away
          px = orig.x
          py = orig.y
          pz = orig.z
        }
        
        positions[idx] = px
        positions[idx + 1] = py
        positions[idx + 2] = pz
      }
      posAttr.needsUpdate = true
    }

    // Request continuous repaint from Mapbox to keep animation running
    this.map.triggerRepaint()
    // ------------------------

    // Disable depth test to render on top of Mapbox tiles
    const gl = this.renderer.getContext()
    gl.disable(gl.DEPTH_TEST)

    this.renderer.render(this.scene, this.camera)"""

content = content.replace(render_search, render_replace)

with open('frontend/src/ThreeLayer.ts', 'w') as f:
    f.write(content)

