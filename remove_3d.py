import re

with open('frontend/src/pages/MissionControl.tsx', 'r') as f:
    content = f.read()

# 1. Imports
content = content.replace("import * as SliderPrimitive from '@radix-ui/react-slider'\n", "")
content = content.replace("import type { PlumeThreeLayer } from '../ThreeLayer'\n", "")
content = content.replace("import { useState, useRef, useEffect, useCallback } from 'react'", "import { useState, useRef, useEffect } from 'react'")

# 2. State & Refs
content = content.replace("  const [depthLevel, setDepthLevel] = useState(0.5) // 0 = top, 1 = bottom\n", "")
content = content.replace("  const threeLayerRef = useRef<PlumeThreeLayer | null>(null)\n", "")

# 3. Three.js plume layer
three_js_regex = r"  // ── Three\.js plume layer ─────────────────────────────────────────────────.*?// Deploying ship \(Pacific Guardian\) leads the plume"
content = re.sub(three_js_regex, "// Deploying ship (Pacific Guardian) leads the plume", content, flags=re.DOTALL)

# 4. Update Three.js layer when depth changes
depth_regex = r"  // Update Three\.js layer when depth changes.*?  \}, \[depthLevel, simulationResult\]\)\n"
content = re.sub(depth_regex, "", content, flags=re.DOTALL)

# 5. 3D Panel UI
panel_regex = r"        <AnimatePresence>.*?        </AnimatePresence>\n"
content = re.sub(panel_regex, "", content, flags=re.DOTALL)

# 6. Map onLoad
content = content.replace("          reuseMaps\n          onLoad={handleMapLoad}", "          reuseMaps")

with open('frontend/src/pages/MissionControl.tsx', 'w') as f:
    f.write(content)

