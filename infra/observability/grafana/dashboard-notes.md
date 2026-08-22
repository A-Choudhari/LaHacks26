# dashboard-notes.md — What to build in Grafana (Week 3)
#
# Once Grafana is running (kubectl port-forward svc/kube-prometheus-stack-grafana 3001:80),
# create a dashboard with these panels. Export the JSON and save it here as
# infra/observability/grafana/oceanops-overview.json

## Panels to add (in order of importance)

### Row 1 — System Health
- [ ] Backend pod count (available vs desired)
- [ ] NATS connection count (`nats_server_total_connections`)
- [ ] Ollama model load status (HTTP probe to /api/tags)

### Row 2 — Request Metrics (add after prometheus-fastapi-instrumentator)
- [ ] Request rate (req/s) — `rate(http_requests_total[5m])`
- [ ] P95 latency — `histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))`
- [ ] 5xx error rate

### Row 3 — Resource Utilization
- [ ] Backend CPU (actual vs request vs limit)
- [ ] Backend memory (working set vs limit)
- [ ] Ollama memory (it'll use most of it)

### Row 4 — NATS Throughput
- [ ] Messages in/out per second per subject (health.backend, fleet.*.position, ais.batch)
- [ ] JetStream consumer lag

### Row 5 — Simulation-specific (OceanOps custom)
- [ ] /simulate call rate and P95 latency (most expensive endpoint)
- [ ] /analyze call rate (Gemma4 inference calls)
- [ ] Julia simulation duration histogram (if USE_MOCK=false)

## Data Sources to configure in Grafana
1. Prometheus → http://kube-prometheus-stack-prometheus:9090
2. (optional) Loki for log aggregation if you add it later
