#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# start.sh — Full-stack launcher for The Tiered Edge Fleet
#
# Starts (in order):
#   1. Ollama AI service + Gemma4 model warm-up
#   2. Backend (FastAPI :8001) — triggers ocean data pre-caching on boot
#   3. Julia/Oceananigans CUDA warmup (background, optional)
#   4. Frontend (React+Vite :3000)
#
# Usage:
#   ./start.sh           # start everything
#   ./start.sh --no-julia  # skip Julia GPU warmup (faster cold start)
#   ./start.sh --stop    # kill all background processes
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail
REPO="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$REPO/.logs"
PID_FILE="$REPO/.pids"
SKIP_JULIA=false

# Parse args
for arg in "$@"; do
  case $arg in
    --no-julia) SKIP_JULIA=true ;;
    --stop)
      echo "Stopping all Tiered Edge Fleet processes..."
      if [[ -f "$PID_FILE" ]]; then
        while IFS= read -r pid; do
          kill "$pid" 2>/dev/null && echo "  killed PID $pid" || true
        done < "$PID_FILE"
        rm -f "$PID_FILE"
      fi
      echo "Done."
      exit 0
      ;;
  esac
done

mkdir -p "$LOG_DIR"
> "$PID_FILE"   # reset pid list

# ── Colors ──
GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${CYAN}[start]${NC} $*"; }
success() { echo -e "${GREEN}[  ok ]${NC} $*"; }
warn()    { echo -e "${YELLOW}[ warn]${NC} $*"; }
error()   { echo -e "${RED}[error]${NC} $*"; }

track_pid() {
  echo "$1" >> "$PID_FILE"
}

wait_for_port() {
  local port=$1 name=$2 timeout=${3:-30}
  local elapsed=0
  while ! nc -z localhost "$port" 2>/dev/null; do
    sleep 1; elapsed=$((elapsed + 1))
    if [[ $elapsed -ge $timeout ]]; then
      warn "$name did not start on :$port within ${timeout}s (continuing anyway)"
      return 1
    fi
  done
  success "$name ready on :$port"
}

# ─────────────────────────────────────────────────────────────────────────────
# 1. Ollama
# ─────────────────────────────────────────────────────────────────────────────
if command -v ollama &>/dev/null; then
  if ! pgrep -x ollama &>/dev/null; then
    info "Starting Ollama..."
    ollama serve >"$LOG_DIR/ollama.log" 2>&1 &
    track_pid $!
    sleep 2   # give it a moment before pulling
  else
    info "Ollama already running"
  fi

  # Pull Gemma4 model if not present (silently skip if already there)
  info "Ensuring gemma4:31b model is available..."
  ollama pull gemma4:31b >"$LOG_DIR/ollama-pull.log" 2>&1 &
  PULL_PID=$!

  # Warm up: send a no-op prompt in the background after pull completes
  ( wait $PULL_PID 2>/dev/null
    echo "Warming Gemma4 model..."
    ollama run gemma4:31b "ready" --nowordwrap >/dev/null 2>&1 || true
    success "Gemma4 warm-up complete"
  ) &
else
  warn "ollama not found — AI analysis will use rule-based fallback"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 2. Backend (FastAPI)
# ─────────────────────────────────────────────────────────────────────────────
info "Starting FastAPI backend on :8001..."
cd "$REPO/backend"
source venv/bin/activate
uvicorn main:app --port 8001 --host 0.0.0.0 >"$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
track_pid $BACKEND_PID
deactivate 2>/dev/null || true
cd "$REPO"

wait_for_port 8001 "Backend" 30

# ─────────────────────────────────────────────────────────────────────────────
# 3. Julia / Oceananigans CUDA warmup (optional, background)
# ─────────────────────────────────────────────────────────────────────────────
if [[ "$SKIP_JULIA" == false ]] && command -v julia &>/dev/null; then
  if [[ -f "$REPO/julia/plume_simulator.jl" ]]; then
    info "Julia detected — triggering CUDA kernel precompilation in background..."
    info "(This can take 3–5 min on first run; simulation falls back to physics model meanwhile)"
    (
      # Warmup: run a minimal test simulation so Julia JIT-compiles everything
      JULIA_WARMUP="$REPO/julia/warmup_stub.jl"
      if [[ ! -f "$JULIA_WARMUP" ]]; then
        cat > "$JULIA_WARMUP" <<'JULIA_EOF'
# Minimal warmup — compiles CUDA packages without running full sim
using Pkg
Pkg.activate(".")
try
    @eval using CUDA
    @eval CUDA.set_runtime_version!(v"13.0", local_toolkit=true)
    @eval using Oceananigans
    println("Julia warmup: packages compiled OK")
catch e
    println("Julia warmup: ", e)
end
JULIA_EOF
      fi
      julia --project="$REPO/julia" "$JULIA_WARMUP" >"$LOG_DIR/julia-warmup.log" 2>&1
      success "Julia precompilation done (check .logs/julia-warmup.log)"
    ) &
    track_pid $!
  fi
else
  [[ "$SKIP_JULIA" == true ]] && info "Skipping Julia warmup (--no-julia)"
  command -v julia &>/dev/null || info "Julia not found — GPU simulation unavailable; using physics model"
fi

# ─────────────────────────────────────────────────────────────────────────────
# 4. Frontend (React + Vite)
# ─────────────────────────────────────────────────────────────────────────────
info "Starting React frontend on :3000..."
cd "$REPO/frontend"
npm run dev >"$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
track_pid $FRONTEND_PID
cd "$REPO"

wait_for_port 3000 "Frontend" 30

# ─────────────────────────────────────────────────────────────────────────────
# Done
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  The Tiered Edge Fleet — all systems launched  ${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  Frontend  →  ${CYAN}http://localhost:3000${NC}"
echo -e "  Backend   →  ${CYAN}http://localhost:8001${NC}"
echo -e "  API docs  →  ${CYAN}http://localhost:8001/docs${NC}"
echo -e "  Logs      →  ${YELLOW}$LOG_DIR/${NC}"
echo -e "  Stop all  →  ${YELLOW}./start.sh --stop${NC}"
echo ""
echo -e "  Ocean data is being pre-cached in the background."
echo -e "  Run ${YELLOW}./smoke_test.sh${NC} to verify all components."
echo ""

# Keep script alive so Ctrl+C kills all children
wait
