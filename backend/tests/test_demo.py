import os
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

os.environ["OCEANOPS_DEMO"] = "true"

from main import app


class DemoTest(unittest.TestCase):
    def setUp(self):
        self.no_http = patch("httpx.AsyncClient.get", side_effect=AssertionError("Unexpected outbound GET"))
        self.no_requests = patch("requests.get", side_effect=AssertionError("Unexpected outbound request"))
        self.no_http.start()
        self.no_requests.start()
        self.addCleanup(self.no_http.stop)
        self.addCleanup(self.no_requests.stop)
        self.client = self.enterContext(TestClient(app))

    def test_simulation_responds_to_controls(self):
        low = self.client.post("/simulate", json={"vessel": {"discharge_rate": 0.1}})
        high = self.client.post("/simulate", json={"vessel": {"discharge_rate": 0.8}})
        self.assertEqual(low.status_code, 200)
        self.assertEqual(high.status_code, 200)
        base, changed = low.json(), high.json()
        self.assertEqual(changed["source"], "mock")
        self.assertEqual(changed["ocean_state_source"], "demo")
        self.assertIsNone(changed["mrv_hash"])
        self.assertEqual(changed["params"]["discharge_rate"], 0.8)
        self.assertGreater(
            changed["summary"]["max_total_alkalinity"],
            base["summary"]["max_total_alkalinity"],
        )

    def test_manual_conditions_and_rule_based_analysis(self):
        simulation = self.client.post("/simulate", json={
            "use_manual_ocean": True,
            "ocean": {"temperature": 20, "mixed_layer_depth": 75},
        })
        self.assertEqual(simulation.status_code, 200)
        result = simulation.json()
        self.assertEqual(result["ocean_state_source"], "manual")
        self.assertEqual(result["ocean_conditions"]["mixed_layer_depth_m"], 75)
        with patch("httpx.AsyncClient.post", side_effect=AssertionError("Unexpected model call")) as post:
            analysis = self.client.post("/analyze", json={"simulation_result": result})
        post.assert_not_called()
        self.assertEqual(analysis.status_code, 200)
        self.assertIn("rule", analysis.json()["model_used"].lower())

    def test_demo_inputs_for_all_three_views(self):
        health = self.client.get("/health").json()
        self.assertTrue(health["demo_mode"])
        self.assertFalse(health["ais_live"])
        for path in ("/fleet", "/traffic", "/oceanographic"):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200, path)
            self.assertTrue(response.json(), path)

        stream = self.client.get("/discover/stream")
        self.assertEqual(stream.status_code, 200)
        self.assertIn('"phase": "fast"', stream.text)
        self.assertIn('"event": "done"', stream.text)
        self.assertTrue(self.client.post("/discover", json={}).json())
        impact = self.client.post("/hotspot-impact", json={"lat": 33.8, "lon": -119.5})
        self.assertEqual(impact.status_code, 200)
        self.assertGreater(impact.json()["plume"]["plume_area_km2"], 0)
