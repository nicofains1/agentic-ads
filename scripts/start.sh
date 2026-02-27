#!/bin/sh
# Startup script — ensures DB directory exists before starting server
# Used by Docker container to handle persistent volume mounts

set -e

# Ensure DB directory exists (for mounted volumes)
DB_PATH="${DATABASE_PATH:-/data/agentic-ads.db}"
DB_DIR="$(dirname "$DB_PATH")"

if [ "$DB_DIR" != "." ] && [ "$DB_DIR" != "" ]; then
  mkdir -p "$DB_DIR"
  echo "[startup] DB directory ensured: $DB_DIR"
fi

echo "[startup] Starting agentic-ads with DATABASE_PATH=$DB_PATH"

# Use PORT from env (Railway/Fly.io set this) or default to 3000
exec node dist/server.js --http --port "${PORT:-3000}"
