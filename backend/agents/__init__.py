"""
ADK agents for The Tiered Edge Fleet.
"""

from .spatial_intelligence import SpatialIntelligenceAgent
from .geochemist import GeochemistAgent

__all__ = [
    "SpatialIntelligenceAgent",
    "GeochemistAgent",
    "get_spatial_agent",
    "get_geochemist_agent",
]

# Lazy-loaded singleton agents
_spatial_agent = None
_geochemist_agent = None


def get_spatial_agent():
    """Get or create the Spatial Intelligence Agent singleton."""
    global _spatial_agent
    if _spatial_agent is None:
        _spatial_agent = SpatialIntelligenceAgent()
    return _spatial_agent


def get_geochemist_agent():
    """Get or create the Geochemist Agent singleton."""
    global _geochemist_agent
    if _geochemist_agent is None:
        _geochemist_agent = GeochemistAgent()
    return _geochemist_agent
