# Deployment Guide — agentic-ads

## Option 1: Railway (Recommended — CLI Available)

Railway is already installed on this machine. Free tier includes:
- 500 hours/month execution time
- $5 free credit monthly
- Zero config needed with Nixpacks

### Deploy Steps:

```bash
cd /Users/nfainstein/Software-Development/agentic-ads

# Login to Railway (opens browser for auth)
railway login

# Create new project
railway init

# Deploy (builds and deploys automatically)
railway up

# Get the public URL
railway domain
```

Expected output: Public URL like `https://agentic-ads-production.up.railway.app`

### Cost: $0 (free tier)

---

## Option 2: Render.com (Web UI)

Free tier includes:
- 750 hours/month
- No credit card required
- Auto-deploys from GitHub

### Deploy Steps:

1. Go to https://dashboard.render.com
2. Click "New +" → "Web Service"
3. Connect GitHub account and select `nicofains1/agentic-ads` repo
4. Use branch: `deploy/render-free-tier`
5. Render auto-detects `render.yaml` config
6. Click "Create Web Service"

Render will build and deploy automatically. You'll get a URL like:
`https://agentic-ads.onrender.com`

### Cost: $0 (free tier)

---

## Option 3: Fly.io (Install Required)

Free tier includes:
- 3 shared-cpu VMs
- 256MB RAM per VM
- 3GB persistent storage

### Deploy Steps:

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Login
flyctl auth login

# Launch (interactive setup)
cd /Users/nfainstein/Software-Development/agentic-ads
flyctl launch --name agentic-ads

# Deploy
flyctl deploy
```

### Cost: $0 (free tier)

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

## Database

SQLite database will be initialized on first run. On Railway/Render free tiers, the database is ephemeral (resets on deploy). For persistent storage, upgrade to paid plan ($5-7/month) with mounted volumes.

For MVP testing, ephemeral is acceptable.
