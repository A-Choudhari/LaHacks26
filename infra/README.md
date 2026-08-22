# OceanOps — Infrastructure Roadmap

This directory contains everything needed to containerize, orchestrate, observe, and
continuously deploy OceanOps. Work through the phases in order — each one builds on the last.

---

## Directory Layout

```
infra/
├── docker/                  # Week 1 — Per-service Dockerfiles
│   ├── backend/
│   ├── frontend/
│   ├── nats/
│   ├── ollama/
│   └── julia/
├── docker-compose.yml       # Week 1 — Local wiring, runs before K8s
│
├── k8s/                     # Week 2 — Raw Kubernetes manifests
│   ├── namespace.yaml
│   ├── nats/
│   ├── backend/
│   ├── frontend/
│   ├── ollama/
│   └── julia/
│
├── helm/                    # Week 2-3 — Helm chart (replaces raw manifests)
│   └── oceanops/
│       ├── Chart.yaml
│       ├── values.yaml
│       ├── values.dev.yaml
│       ├── values.prod.yaml
│       └── templates/
│
├── observability/           # Week 3 — Prometheus + Grafana
│   ├── prometheus/
│   └── grafana/
│
├── scaling/                 # Week 4 — HPA + resource policy docs
│   └── hpa.yaml
│
└── .github/
    └── workflows/           # Week 4-5 — CI/CD pipelines
        ├── build-push.yml
        ├── helm-lint.yml
        └── deploy.yml
```

---

## Phase Checklist

| Phase | Goal | Status |
|-------|------|--------|
| Week 1 | Docker + docker-compose working locally | [ ] |
| Week 2 | Raw K8s manifests on kind/minikube | [ ] |
| Week 2-3 | Helm chart + values files | [ ] |
| Week 3 | Prometheus + Grafana, probes everywhere | [ ] |
| Week 4 | HPA, pod failure drills, resource limits | [ ] |
| Week 4-5 | GitHub Actions CI/CD | [ ] |
| Stretch | Ingress + TLS, Linkerd service mesh | [ ] |

---

## Services Map

| Service | Port | Image Tag | Notes |
|---------|------|-----------|-------|
| `backend` | 8000 | `oceanops/backend` | FastAPI + uvicorn |
| `frontend` | 5173 | `oceanops/frontend` | Vite / Nginx in prod |
| `nats` | 4222 / 8222 | `nats:2.10-alpine` | JetStream enabled |
| `ollama` | 11434 | `ollama/ollama` | Gemma4 model |
| `julia` | — | `oceanops/julia` | Sidecar / Job pattern |

---

## Quick Commands Reference

```bash
# Week 1 — bring everything up locally
docker compose -f infra/docker-compose.yml up --build

# Week 2 — spin up local cluster
kind create cluster --name oceanops

# Apply raw manifests
kubectl apply -k infra/k8s/

# Week 2-3 — install Helm chart
helm install oceanops infra/helm/oceanops -f infra/helm/oceanops/values.dev.yaml

# Week 3 — install observability stack
helm install kube-prometheus-stack prometheus-community/kube-prometheus-stack \
  -f infra/observability/prometheus/values.yaml

# Week 4 — apply HPA
kubectl apply -f infra/scaling/hpa.yaml
```
