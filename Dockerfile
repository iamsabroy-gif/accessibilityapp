# ── Stage 1: Build the Go binary ──────────────────────────────────────────────
FROM golang:1.23-alpine AS go-builder

WORKDIR /app

# Cache dependency downloads separately from source
COPY go.mod go.sum ./
RUN go mod download

# Build a statically-linked binary (no CGO, no external deps)
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-s -w" -o server ./cmd/server

# ── Stage 2: Runtime – Node 22 + Chromium + Go binary ─────────────────────────
FROM node:22-slim

# Chromium system dependencies required by Puppeteer's bundled browser
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      libgbm1 \
      libxkbcommon0 \
      ca-certificates \
      fonts-liberation \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libcups2 \
      libdbus-1-3 \
      libgdk-pixbuf2.0-0 \
      libglib2.0-0 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libx11-6 \
      libx11-xcb1 \
      libxcb1 \
      libxcomposite1 \
      libxcursor1 \
      libxdamage1 \
      libxext6 \
      libxfixes3 \
      libxi6 \
      libxrandr2 \
      libxrender1 \
      libxss1 \
      libxtst6 \
      lsb-release \
      wget \
      xdg-utils \
   && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Configure Puppeteer to skip downloading Chromium and use the system-installed version instead
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Install Node deps (skips Puppeteer Chrome download via env var)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy the axe-runner script (Puppeteer entry-point for scans)
COPY scripts/ ./scripts/

# Copy the compiled Go server from the builder stage
COPY --from=go-builder /app/server ./server

# ── Security: run as a non-root user ─────────────────────────────────────────
RUN groupadd -r appuser \
 && useradd -r -g appuser -G audio,video appuser \
 && chown -R appuser:appuser /app
USER appuser

# ── Runtime configuration (overridden by Render env vars) ────────────────────
ENV PORT=8080 \
    NODE_BIN=node \
    AXE_RUNNER_SCRIPT=scripts/axe_runner.js \
    WCAG_LEVEL=AA \
    SCAN_TIMEOUT_SECONDS=60 \
    MAX_CONCURRENT_SCANS=3

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-8080}/api/v1/health || exit 1

CMD ["./server"]
