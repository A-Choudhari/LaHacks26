# syntax=docker/dockerfile:1
# ─────────────────────────────────────────────────────
# Stage 1: Node build (Vite + TypeScript compile)
# ─────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /build

# Install deps first — separate layer so npm ci is cached unless package.json changes
COPY frontend/package*.json ./
RUN npm ci --prefer-offline

# Copy source files
COPY frontend/ .

RUN npm run build

# ─────────────────────────────────────────────────────
# Stage 2: Nginx static file server
# ─────────────────────────────────────────────────────
FROM nginx:stable-alpine AS runtime

# Drop default nginx config, replace with ours
RUN rm /etc/nginx/conf.d/default.conf
COPY infra/docker/frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Copy the compiled Vite bundle from the builder stage
COPY --from=builder /build/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
