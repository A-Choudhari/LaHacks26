#!/bin/bash
# Smoke test script for OceanOps
# Run before demo to verify all components are working

set -e

echo "=== OceanOps - Smoke Test ==="
echo ""

# Configurable ports
API_PORT=${API_PORT:-8001}
FRONTEND_PORT=${FRONTEND_PORT:-3000}

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
NC='\033[0m' # No Color

pass() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }

# 1. Check API health
echo "Checking API on port $API_PORT..."
if curl -s http://localhost:$API_PORT/health | grep -q "ok"; then
    JULIA_OK=$(curl -s http://localhost:$API_PORT/health | grep -o '"julia_available":[^,]*' | cut -d: -f2)
    MOCK_OK=$(curl -s http://localhost:$API_PORT/health | grep -o '"mock_data_available":[^,]*' | cut -d: -f2)
    pass "API healthy (julia: $JULIA_OK, mock: $MOCK_OK)"
else
    fail "API down - run: cd backend && source venv/bin/activate && uvicorn main:app --port $API_PORT"
fi

# 2. Check Ollama is running
echo "Checking Ollama..."
if curl -s http://localhost:11434/api/tags 2>/dev/null | grep -q "models"; then
    pass "Ollama running"
else
    warn "Ollama not running - run: ollama serve (optional, for AI analysis)"
fi

# 3. Check if Gemma model is available
echo "Checking Gemma model..."
if curl -s http://localhost:11434/api/tags 2>/dev/null | grep -qi "gemma"; then
    pass "Gemma model loaded"
else
    warn "Gemma model not found - run: ollama pull gemma2 (optional)"
fi

# 4. Run minimal simulation
echo "Running test simulation..."
RESULT=$(curl -s -X POST http://localhost:$API_PORT/simulate \
  -H "Content-Type: application/json" \
  -d '{"vessel":{},"feedstock":{},"ocean":{}}' 2>/dev/null)

if echo "$RESULT" | grep -q "coordinates"; then
    SOURCE=$(echo "$RESULT" | grep -o '"source":"[^"]*"' | cut -d'"' -f4)
    STATUS=$(echo "$RESULT" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
    pass "Simulation works (source: $SOURCE, status: $STATUS)"
else
    fail "Simulation failed"
fi

# 5. Check frontend loads
echo "Checking frontend on port $FRONTEND_PORT..."
if curl -s http://localhost:$FRONTEND_PORT 2>/dev/null | grep -q "html"; then
    pass "Frontend loads"
else
    fail "Frontend down - run: cd frontend && npm run dev"
fi

# 6. Check fleet endpoint
echo "Checking fleet status..."
FLEET_COUNT=$(curl -s http://localhost:$API_PORT/fleet 2>/dev/null | grep -o '"ship_id"' | wc -l | tr -d ' ')
if [ "$FLEET_COUNT" -gt 0 ]; then
    pass "Fleet endpoint works ($FLEET_COUNT ships)"
else
    fail "Fleet endpoint failed"
fi

# 7. Check AI analysis endpoint
echo "Checking AI analysis..."
ANALYSIS=$(curl -s -X POST http://localhost:$API_PORT/analyze \
  -H "Content-Type: application/json" \
  -d '{"simulation_result":{"summary":{"max_aragonite_saturation":14.5,"max_total_alkalinity":3450},"params":{"feedstock_type":"olivine","temperature":15}}}' 2>/dev/null)

if echo "$ANALYSIS" | grep -q "safety_assessment"; then
    MODEL=$(echo "$ANALYSIS" | grep -o '"model_used":"[^"]*"' | cut -d'"' -f4)
    pass "AI analysis works (model: $MODEL)"
else
    fail "AI analysis failed"
fi

echo ""
echo "=== Smoke Test Complete ==="
echo ""
echo "Open http://localhost:$FRONTEND_PORT in your browser to view the application"
