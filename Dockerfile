# Multi-stage Dockerfile for zerion-ta-rebalancer.
# Builds the web SPA, then ships a slim runtime image.

# ── Build stage ──────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Copy package manifests first for better layer caching
COPY package.json package-lock.json* ./
COPY web/package.json ./web/
RUN npm install --no-audit --no-fund
RUN cd web && npm install --no-audit --no-fund

# Copy source and build the SPA
COPY . .
RUN npm run build

# ── Runtime stage ────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

# Copy production deps from builder, but install fresh to drop dev deps
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

# Copy the source (we run via tsx, no compile step) and the built SPA
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/web/dist ./web/dist
COPY --from=builder /app/tsconfig.json ./

# The forked Zerion CLI must be mounted at /app/zerion-ai or path provided via env
ENV ZERION_CLI_PATH=/app/zerion-ai/cli/zerion.js

# Persistent state — mount these as volumes
RUN mkdir -p /app/data /root/.zerion
VOLUME ["/app/data", "/root/.zerion"]

EXPOSE 3000

CMD ["node", "--import", "tsx", "src/index.ts"]
