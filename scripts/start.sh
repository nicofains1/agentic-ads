#!/bin/sh
# Startup script — ensures DB directory exists before starting server
# Used by Docker container to handle persistent volume mounts

set -e

# Ensure DB directory exists (for mounted volumes)
DB_PATH="${DATABASE_PATH:-/data/agentic-ads.db}"
DB_DIR="$(dirname "$DB_PATH")"

if [ "$DB_DIR" != "." ] && [ "$DB_DIR" != "" ]; then
  mkdir -p "$DB_DIR"
  echo "[startup] DB directory ensured: $DB_DIR" >&2
fi

echo "[startup] PORT=$PORT DATABASE_PATH=$DB_PATH" >&2
echo "[startup] dist/server.js port line:" >&2
grep -n "portFlag\|process.env.PORT" dist/server.js | head -5 >&2

# Server reads PORT env var directly (Railway/Render set this), defaults to 3000
exec node dist/server.js --http
