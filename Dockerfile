FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files + source
COPY package*.json tsconfig.json ./
COPY src ./src

# Install ALL deps (including devDependencies for build) and build
RUN npm ci && npm run build

# ─── Production stage ────────────────────────────────────────────────────────
FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Copy startup script
COPY scripts/start.sh ./scripts/start.sh
RUN chmod +x scripts/start.sh

# SQLite database will be stored in /data (persistent volume mount point)
RUN mkdir -p /data
ENV DATABASE_PATH=/data/agentic-ads.db

EXPOSE 3000

CMD ["sh", "scripts/start.sh"]
