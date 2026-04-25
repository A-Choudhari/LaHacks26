"""
Configuration constants for The Tiered Edge Fleet backend.
"""

import subprocess
from pathlib import Path

# Paths
PROJECT_ROOT = Path(__file__).parent.parent
JULIA_SCRIPT = PROJECT_ROOT / "julia" / "plume_simulator.jl"
MOCK_DATA_DIR = PROJECT_ROOT / "data" / "mock"
REAL_DATA_DIR = PROJECT_ROOT / "data" / "real"


def is_julia_available() -> bool:
    """Check if Julia is actually installed and functional."""
    try:
        result = subprocess.run(["julia", "--version"], capture_output=True, timeout=5)
        return result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return False


JULIA_INSTALLED = is_julia_available()
USE_MOCK = not JULIA_SCRIPT.exists() or not JULIA_INSTALLED

# CORS origins
CORS_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:5173",
]

# AI prompts
SAFETY_PROMPT = """You are a marine geochemistry expert analyzing Ocean Alkalinity Enhancement (OAE) deployment results.

Given these simulation results:
- Maximum aragonite saturation: {max_aragonite}
- Maximum total alkalinity: {max_alkalinity} µmol/kg
- Feedstock type: {feedstock_type}
- Ocean temperature: {temperature}°C
- Discharge rate: {discharge_rate} m³/s

Safety thresholds:
- Ω_aragonite > 30.0 = runaway carbonate precipitation (UNSAFE)
- Total alkalinity > 3500 µmol/kg = olivine toxicity risk (UNSAFE)

Provide a brief (2-3 sentences) safety assessment. Be specific about which thresholds are met or exceeded."""

CO2_PROMPT = """You are a climate scientist projecting CO2 removal from Ocean Alkalinity Enhancement.

Given this deployment:
- Total alkalinity deployed: {alkalinity_deployed} µmol/kg
- Ocean temperature: {temperature}°C
- Deployment area (estimated): {area} km²

Using the standard OAE efficiency ratio (approximately 0.8 mol CO2 removed per mol alkalinity added for olivine dissolution):

Calculate and explain the projected CO2 removal over 10 years. Give a specific number in tons."""
