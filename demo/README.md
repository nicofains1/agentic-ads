# Agentic Ads — 5-Minute Integration Demo

Run the full publisher flow in one command. No `npm install` needed.

## Quick start

```bash
node demo.js
```

That's it. The demo will:
1. Register a new publisher account (free, instant)
2. Fetch a sponsored recommendation for a sample query
3. Report an impression + a simulated click
4. Show your **real earnings** pulled from the live API

**Expected output:**
```
✓ Registered!  developer_id: xxxxxxxx-...
✓ Got 3 sponsored recommendation(s)

  Top result:
  [Sponsored by Agentic Ads]
  Monetize your MCP server in 5 minutes...

✓ Impression recorded
✓ Click recorded

╔══════════════════════════════════════════════════════╗
║                  YOUR EARNINGS                       ║
╠══════════════════════════════════════════════════════╣
║  Total earned (all-time):  $0.2100                   ║
║  Earnings last 24h:        $0.2100                   ║
║  Impressions:              1                         ║
║  Clicks:                   1                         ║
╚══════════════════════════════════════════════════════╝
```

## Requirements

- Node.js 18+ (built-in `fetch` — no npm install)

## Reuse your API key

On first run the demo auto-registers and prints your API key. Save it:

```bash
export AGENTIC_ADS_API_KEY="aa_dev_..."
node demo.js   # skips registration, shows cumulative earnings
```

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `AGENTIC_ADS_API_KEY` | _(auto-register)_ | Your developer API key |
| `AGENTIC_ADS_URL` | `https://agentic-ads-production.up.railway.app` | API base URL |
| `DEMO_QUERY` | `best tools for AI agent developers` | Sample query for ad search |

## Next step

Add Agentic Ads to your own MCP server: see [`../docs/quickstart.md`](../docs/quickstart.md)
