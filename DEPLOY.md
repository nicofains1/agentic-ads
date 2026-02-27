# Deployment Guide — agentic-ads

## DB Persistence

SQLite database is stored at the path set by `DATABASE_PATH` env var (default: `agentic-ads.db`).

For production, mount a persistent volume at `/data` and set:
```
DATABASE_PATH=/data/agentic-ads.db
```

The server reads this env var at startup (priority: `--db` CLI flag > `DATABASE_PATH` env > `agentic-ads.db`).

On first startup with an empty DB, the server **auto-seeds** production campaigns (OnlySwaps + Agentic Ads). No manual seed step needed.

---

## Option 1: Fly.io (Recommended — Free, Persistent Storage)

Fly.io free tier includes:
- 3 shared-cpu VMs, 256MB RAM
- 3GB persistent volume storage
- `fly.toml` already configured in this repo

### Deploy Steps:

```bash
# Install Fly CLI if not installed
curl -L https://fly.io/install.sh | sh

# Login (opens browser)
flyctl auth login

# First deploy — creates app and volume
cd /path/to/agentic-ads
flyctl launch --name agentic-ads --no-deploy
flyctl volumes create agentic_ads_data --region iad --size 1
flyctl deploy

# Get the public URL
flyctl status
```

Expected URL: `https://agentic-ads.fly.dev`

### Subsequent deploys:

```bash
npm run build && flyctl deploy
```

### Cost: $0 (free tier)

---

## Option 2: Railway (CLI Available — BLOCKED by free plan resource limit)

Railway is installed and authenticated on this machine, but the free plan resource limit is exceeded.

To unblock: upgrade Railway plan, or delete an unused Railway project to free up resources.

Once unblocked:

```bash
cd /path/to/agentic-ads

# Create project
railway init --name agentic-ads

# Create volume for persistent DB (1GB, mounted at /data)
railway volume create --mount /data --size 1

# Set DATABASE_PATH
railway variables set DATABASE_PATH=/data/agentic-ads.db

# Deploy
railway up
```

`railway.toml` is already configured with Nixpacks builder and health check.

### Cost: $0 (free tier — when resource limit allows)

---

## Option 3: Render.com (No Persistent Storage on Free Tier)

Render free tier wipes the filesystem on every deploy. SQLite data is lost.

**Workaround (not recommended):** The auto-seed feature means a fresh DB on every deploy still has demo campaigns. Advertisers would need to re-register after each deploy.

**For true persistence on Render:** Add a Render Disk ($7/month).

---

## Verification

Once deployed, verify the health endpoint:

```bash
curl https://YOUR-URL/health
```

Expected response:
```json
{"status":"ok","server":"agentic-ads","version":"0.1.0"}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_PATH` | `agentic-ads.db` | Path to SQLite database file |
| `PORT` | `3000` | HTTP port (set automatically by Railway/Fly.io) |
| `AGENTIC_ADS_API_KEY` | — | Optional default API key for stdio mode |
