# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────
# Stage 1: Build dependencies in a throwaway layer
# ─────────────────────────────────────────────────────
FROM python:3.11-slim AS builder

WORKDIR /build

# Copy requirements first — changes here invalidate the pip cache layer
COPY backend/requirements.txt .
RUN pip install --upgrade pip \
 && pip install --prefix=/install --no-cache-dir -r requirements.txt

# ─────────────────────────────────────────────────────
# Stage 2: Minimal runtime image
# ─────────────────────────────────────────────────────
FROM python:3.11-slim AS runtime

# Security: run as non-root
RUN addgroup --system app && adduser --system --ingroup app app

WORKDIR /app

# Copy installed packages from builder stage only (no pip, no build tools)
COPY --from=builder /install /usr/local

# Copy application source, excluding venv and cache (see .dockerignore)
COPY backend/ .

# Ensure the app user owns the working directory
RUN chown -R app:app /app

USER app

# Environment variable defaults — all overridden by K8s ConfigMap at runtime
ENV NATS_URL=nats://nats:4222 \
    OLLAMA_BASE_URL=http://ollama:11434 \
    USE_MOCK=true \
    PORT=8000

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
