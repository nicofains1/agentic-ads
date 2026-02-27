# Agentic Ads

> **Google AdSense for AI agents.** Add 3 lines of code to your MCP server. Earn 70% of every ad click.

[![npm version](https://img.shields.io/npm/v/agentic-ads?color=blue&label=npm)](https://www.npmjs.com/package/agentic-ads)
[![Tests](https://img.shields.io/badge/tests-270%20passing-brightgreen)](https://github.com/nicofains1/agentic-ads)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-v1.12.0-orange)](https://modelcontextprotocol.io)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org)

**[Live Demo](https://agentic-ads.onrender.com/health)** · **[Quick Start](#quick-start)** · **[MCP Tools](#mcp-tools-8-total)** · **[Self-Host](#option-3-self-host-production)**

---

## Quick Start

**Step 1 — Register and get your API key (30 seconds):**

```bash
curl -X POST https://agentic-ads.onrender.com/api/register \
  -H "Content-Type: application/json" \
  -d '{"name": "My MCP Bot", "email": "me@example.com"}'
# Returns: { "api_key": "aa_dev_...", "mcp_url": "https://agentic-ads.onrender.com/mcp" }
```

**Step 2 — Add to your MCP client config:**

```json
{
  "mcpServers": {
    "agentic-ads": {
      "url": "https://agentic-ads.onrender.com/mcp",
      "transport": "http"
    }
  }
}
```

**Step 3 — Call `search_ads` in your agent and earn on every click:**

```typescript
// In your agent logic — when context is relevant
const ads = await mcp.callTool({
  name: 'search_ads',
  arguments: { query: 'best running shoes for marathon', max_results: 1 }
});

// Report events to get paid
await mcp.callTool({
  name: 'report_event',
  arguments: { ad_id: ads[0].ad_id, event_type: 'impression' }
});
// User clicks → report 'click' → you earn $0.35 on a $0.50 CPC ad
```

That's it. You're monetizing.

---

## Why This Exists

You built an amazing MCP server. Users love it. But you're not making money.

**agentic-ads** is the missing monetization layer for the MCP ecosystem. It's like Google AdSense, but for AI agents instead of websites.

### The Problem

- 16,000+ MCP servers exist. Almost none monetize.
- Developers spend weeks building useful tools, earn $0.
- Users ask agents for product recommendations → agents scrape the web → brands can't reach them.

### The Solution

Privacy-respecting contextual ads served through MCP tools. Developers earn **70% revenue share** (industry-leading). Advertisers reach AI agent users. Everyone wins.

---

## Revenue Calculator

**Example:** Your MCP server gets 10,000 queries/month where ads make sense.

| Scenario | Impressions/mo | CTR | Clicks/mo | CPC | Your Revenue |
|----------|----------------|-----|-----------|-----|--------------|
| Conservative | 10,000 | 2% | 200 | $0.50 | **$70/mo** |
| Realistic | 10,000 | 5% | 500 | $0.50 | **$175/mo** |
| Strong | 10,000 | 8% | 800 | $0.75 | **$420/mo** |

**At 100k queries/month with 5% CTR:** $1,750/month passive income.

That's **$21,000/year** for adding 3 lines of code to your MCP server.

---

## Detailed Integration Guide

### For MCP Developers (Earn Money)

Connect the live server and start calling tools — no approval process, no minimums.

```typescript
// 1. When user asks about products/services
const ads = await mcp.callTool({
  name: 'search_ads',
  arguments: {
    query: 'best running shoes for marathon',
    max_results: 2
  }
});

// 2. Show relevant ad in your response (if it adds value)
// 3. Report impression
await mcp.callTool({
  name: 'report_event',
  arguments: { ad_id: 'ad_xyz', event_type: 'impression' }
});

// 4. If user clicks → report 'click' event
// You earn $0.35 on a $0.50 CPC click (70% revenue share)
```

### For Advertisers (Reach AI Users)

```bash
# Create campaign + ad via MCP tools
mcp.callTool({
  name: 'create_campaign',
  arguments: {
    name: 'Q1 Running Shoes',
    total_budget: 500,
    pricing_model: 'cpc',
    bid_amount: 0.50
  }
});

mcp.callTool({
  name: 'create_ad',
  arguments: {
    campaign_id: 1,
    creative_text: 'Ultraboost 24 — 30% off! Free shipping.',
    link_url: 'https://adidas.com/ultraboost',
    keywords: ['running shoes', 'sneakers', 'marathon'],
    category: 'footwear'
  }
});

# Monitor analytics
mcp.callTool({ name: 'get_campaign_analytics', arguments: { campaign_id: 1 } });
```

---

## How It Works

```
┌─────────────┐                    ┌──────────────────┐                    ┌──────────────┐
│  Advertiser  │────────────────────│  Agentic Ads MCP │────────────────────│  Your MCP     │
│  (Brand/API) │  create_campaign   │     Server       │  search_ads        │  Server       │
│              │  create_ad         │                  │  report_event      │               │
│              │  get_analytics     │  - Matching      │  get_guidelines    │  Shows ads    │
└─────────────┘                    │  - Billing       │                    │  to users     │
                                   │  - Auth & Rate   │                    └──────────────┘
                                   │  - Analytics     │
                                   └──────────────────┘
```

**Example flow:**

1. User asks your agent: "best running shoes for marathon"
2. Your agent calls `search_ads` → gets relevant ads ranked by bid × relevance
3. Agent shows ad naturally: "Ultraboost 24 — $126 (30% off) at Adidas.com (Sponsored)"
4. User clicks → you report `click` event → you earn $0.35 (70% of $0.50 CPC)

**Privacy:** No user tracking, no profiling, no cookies. Only contextual keyword matching.

---

## Why MCP Developers Love This

### 1. Industry-Leading Revenue Share

**70%** to you, 30% to platform. Compare:

| Platform | Developer Share |
|----------|-----------------|
| **agentic-ads** | **70%** |
| Google AdSense | 68% |
| Amazon Associates | 1-10% |
| Affiliate networks | 5-30% |

### 2. Zero Setup Friction

- No contracts, no minimums, no approval delays
- Register in seconds via `POST /api/register` → get your API key
- Add 1 MCP server to your config → start earning in 5 minutes

### 3. Privacy-Respecting

- No user tracking or profiling
- No cookies, no browser fingerprinting
- Only contextual keyword matching (like early Google AdWords)
- Your users' privacy stays intact

### 4. You Control What Ads Show

- Agent decides which ads (if any) to show
- Full user context stays local (never sent to ad server)
- Relevance threshold in your hands
- Users can opt out ("no ads please")

### 5. Transparent Analytics

- Real-time revenue tracking
- See exactly what you earned, when, and why
- No black-box algorithms or hidden fees

---

## MCP Tools (8 Total)

### For Developers (Consumer Side) — 3 Tools

| Tool | Auth | Description |
|------|------|-------------|
| `search_ads` | Public | Search for ads by query/keywords/category/geo. Returns ranked results with relevance scores. |
| `report_event` | Developer key | Report impression/click/conversion events. Triggers revenue calculation. |
| `get_ad_guidelines` | Public | Get formatting guidelines for how to present ads naturally to users. |

### For Advertisers (Publisher Side) — 5 Tools

| Tool | Auth | Description |
|------|------|-------------|
| `create_campaign` | Advertiser key | Create campaign with budget, objective, pricing model (CPC/CPM/CPA). |
| `create_ad` | Advertiser key | Create ad with creative text, keywords, targeting, link URL. |
| `get_campaign_analytics` | Advertiser key | Get performance metrics (impressions, clicks, conversions, spend, ROI). |
| `update_campaign` | Advertiser key | Update campaign (pause/resume, adjust budget, change targeting). |
| `list_campaigns` | Advertiser key | List all campaigns with summary stats, optional status filter. |

---

## Pricing Models

Choose how you want to pay (advertisers) or earn (developers):

| Model | Advertiser Pays | Developer Earns (70%) | When Charged |
|-------|----------------|-----------------------|--------------|
| **CPC** (Click) | $0.50 per click | $0.35 | User clicks ad link |
| **CPM** (Impression) | $5.00 per 1000 views | $3.50 | Ad shown to user |
| **CPA** (Conversion) | $10.00 per conversion | $7.00 | User completes action (purchase, signup, etc.) |

**Budget controls:** Set total budget + daily caps. Auto-pause when budget exhausted.

---

## Getting Your API Key

To call `report_event` or advertiser tools, you need an API key. Register via the REST endpoint:

```bash
curl -X POST https://agentic-ads.onrender.com/api/register \
  -H "Content-Type: application/json" \
  -d '{"name": "My MCP Bot", "email": "me@example.com"}'
```

Response:
```json
{
  "developer_id": "...",
  "api_key": "aa_dev_...",
  "mcp_url": "https://agentic-ads.onrender.com/mcp"
}
```

Use the `api_key` in the `Authorization` header: `Authorization: Bearer aa_dev_...`

> **Note on Render free tier:** The live server at `agentic-ads.onrender.com` runs on Render's free tier, which spins down after 15 minutes of inactivity. Cold starts may take 15-30 seconds. The SQLite database is ephemeral on the free tier — data resets on each deploy. **For persistent data**, deploy to [Fly.io](DEPLOY.md) (free, persistent volume) or self-host with `DATABASE_PATH=/data/ads.db` pointing to a mounted volume.

---

## Installation

### Option 1: Connect to Live Server (Easiest)

Add to your MCP client config (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "agentic-ads": {
      "url": "https://agentic-ads.onrender.com/mcp",
      "transport": "http"
    }
  }
}
```

**Health check:** https://agentic-ads.onrender.com/health

### Option 2: Local stdio (Development)

```bash
npm install -g agentic-ads

# Add to MCP config
{
  "mcpServers": {
    "agentic-ads": {
      "command": "npx",
      "args": ["agentic-ads", "--stdio"]
    }
  }
}
```

### Option 3: Self-Host (Production)

```bash
git clone https://github.com/nicofains1/agentic-ads.git
cd agentic-ads
npm install && npm run build

# Start HTTP server
PORT=19877 npm run start:http

# Or stdio
npm run start:stdio
```

**Flags:**

```bash
node dist/server.js --http --port 19877 --db ./ads.db
```

| Flag | Default | Description |
|------|---------|-------------|
| `--http` | — | Start HTTP server (default is stdio) |
| `--port N` | `3000` | HTTP port |
| `--db PATH` | `agentic-ads.db` | SQLite database path |
| `--api-key KEY` | — | Pre-authenticate stdio sessions |

**Environment Variables:**

```bash
PORT=19877                     # HTTP server port (alternative to --port)
DATABASE_PATH=/data/ads.db     # SQLite database path (default: agentic-ads.db)
AGENTIC_ADS_API_KEY=aa_dev_... # Developer API key for stdio mode
```

**DB Persistence:** Set `DATABASE_PATH` to a path on a persistent volume. On first run with an empty DB, demo campaigns are auto-seeded. See [DEPLOY.md](DEPLOY.md) for full deployment guide (Fly.io recommended for free persistent storage).

---

## Integration Examples

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agentic-ads": {
      "command": "npx",
      "args": ["agentic-ads", "--stdio"]
    }
  }
}
```

### Cursor / Windsurf

```json
{
  "mcpServers": {
    "agentic-ads": {
      "url": "https://agentic-ads.onrender.com/mcp",
      "transport": "http"
    }
  }
}
```

### Custom TypeScript Agent

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['agentic-ads', '--stdio']
});

const client = new Client({ name: 'my-agent', version: '1.0.0' });
await client.connect(transport);

// Search for ads
const result = await client.callTool({
  name: 'search_ads',
  arguments: {
    query: 'best laptops for coding',
    keywords: ['laptop', 'programming'],
    category: 'electronics',
    max_results: 3
  }
});

console.log(result.content[0].text);
// Returns: { "ads": [ { "ad_id": "...", "creative_text": "...", "relevance_score": 0.87 } ] }
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  MCP Server (Node.js 22 + TypeScript)                       │
│  ┌───────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ Tool Registry │  │ Auth & Rate  │  │ Matching Engine │  │
│  │ (8 tools)     │  │ Limiting     │  │ (relevance²     │  │
│  │               │  │ (SHA-256)    │  │ × bid × quality)│  │
│  └───────────────┘  └──────────────┘  └─────────────────┘  │
│  ┌───────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │ SQLite (WAL)  │  │ Revenue      │  │ Analytics       │  │
│  │ - Campaigns   │  │ Split Engine │  │ (real-time)     │  │
│  │ - Ads         │  │ (70/30)      │  │                 │  │
│  │ - Events      │  │              │  │                 │  │
│  └───────────────┘  └──────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────┘
          │                                          │
          │                                          │
  Streamable HTTP (remote)                     stdio (local)
```

**Key Features:**

- **Privacy:** No user tracking, contextual matching only
- **Relevance:** `score = relevance² × bidFactor × quality_score` (relevance dominates)
- **Atomicity:** Event insert + stats update + revenue split in single SQLite transaction
- **Rate Limiting:** Per-key sliding window (60-120 req/min depending on tool)
- **Auth:** SHA-256 hashed API keys, role-based access control
- **Testing:** 270 tests across 13 files, all passing

---

## Demo: Full Flow

```bash
# Clone repo
git clone https://github.com/nicofains1/agentic-ads.git
cd agentic-ads

# Install + build
npm install && npm run build

# Seed a local DB with demo data (generates real API keys)
tsx scripts/seed.ts --db test.db
# Note: seed.ts prints the generated dev/adv keys — use them below

# Run smoke test with real keys from seed output
tsx scripts/smoke-test.ts --db test.db --dev-key aa_dev_... --adv-key aa_adv_...
```

**Output:**

```
✅ Created advertiser: Adidas
✅ Created campaign: Q1 Running Shoes ($500 budget, CPC $0.50)
✅ Created ad: "Ultraboost 24 — 30% off!"
✅ Created developer: TestBot
✅ Searched ads for "running shoes" → 1 result (relevance 0.95)
✅ Reported impression → $0.00 charged (CPC model)
✅ Reported click → $0.50 charged, developer earned $0.35
✅ Analytics: 1 impression, 1 click, $0.50 spent, $0.35 developer revenue
```

---

## FAQ

### For Developers

**Q: How do I get an API key?**
A: Register via the REST endpoint:

```bash
curl -X POST https://agentic-ads.onrender.com/api/register \
  -H "Content-Type: application/json" \
  -d '{"name": "Your Name", "email": "you@example.com"}'
# Returns: { "developer_id": "...", "api_key": "aa_dev_...", "mcp_url": "..." }
```

Use the returned `api_key` as `Authorization: Bearer aa_dev_...` in your MCP requests.

**Q: Do I HAVE to show ads?**
A: No. You control which ads to show. Only show ads if they genuinely add value to the user. Agent autonomy is a feature.

**Q: What if my users hate ads?**
A: Follow the guidelines from `get_ad_guidelines`: max 1-2 ads per response, always disclose "sponsored", respect opt-out ("no ads please").

**Q: Is this production-ready?**
A: Yes. 270 passing tests, live at https://agentic-ads.onrender.com, MIT license.

**Q: What MCP clients are supported?**
A: Any MCP client supporting stdio or Streamable HTTP. Tested with Claude Desktop, Cursor, Windsurf, custom agents.

### For Advertisers

**Q: How do I create ads?**
A: Use the `create_campaign` and `create_ad` MCP tools with an advertiser API key. See [smoke-test.ts](scripts/smoke-test.ts) for examples.

**Q: How is my budget protected?**
A: Budget tracking is atomic (SQLite transaction). When budget exhausted → campaign auto-pauses. No overspend.

**Q: Can I track conversions?**
A: Yes, use CPA pricing model + `report_event` with `event_type: 'conversion'`. Add UTM params to your link URL for attribution.

**Q: What targeting options exist?**
A: MVP has keywords (exact + partial match), categories, geo (country-level), and language. Semantic matching coming in Phase 2.

### General

**Q: Do you track users?**
A: No. We only receive anonymized keyword queries from agents. No user IDs, no cookies, no profiling. Privacy-first.

**Q: How do you prevent fraud?**
A: MVP uses API key auth + rate limiting + trust-based reporting. Phase 2 adds anomaly detection heuristics (see [issue #47](https://github.com/nicofains1/agentic-ads/issues/47)).

**Q: Is this open source?**
A: Yes, MIT license. Fork it, self-host it, contribute to it.

---

## Roadmap

- [x] **MVP** — 8 MCP tools, keyword matching, billing, auth, 270 tests
- [x] **Deployed** — Live at https://agentic-ads.onrender.com
- [ ] **Marketplace Listings** — Submit to Anthropic Registry, Smithery, Glama, PulseMCP (Week 1)
- [ ] **Dashboard REST API** — Web UI for advertisers/developers ([#40](https://github.com/nicofains1/agentic-ads/issues/40))
- [ ] **Fraud Detection** — Anomaly heuristics ([#47](https://github.com/nicofains1/agentic-ads/issues/47))
- [ ] **Semantic Matching** — Embeddings-based relevance (Phase 2)
- [ ] **A/B Testing** — Ad creative variants ([#41](https://github.com/nicofains1/agentic-ads/issues/41))
- [ ] **Stripe Payouts** — Automated developer payments (Phase 3)

---

## Contributing

We follow the GitHub Issues workflow:

1. Check if an issue exists for your idea
2. If not: `gh issue create --title "Your idea"`
3. Get approval before starting work
4. Branch: `feature/#N-description`
5. Commit: `feat(#N): description`
6. PR to `main`

See [CLAUDE.md](CLAUDE.md) for detailed guidelines.

---

## Documentation

- **[CLAUDE.md](CLAUDE.md)** — Development guidelines
- **[bulloak.md](bulloak.md)** — Behavioral specification (source of truth for tests)
- **[docs/PRD.md](docs/PRD.md)** — Full Product Requirements Document
- **[scripts/smoke-test.ts](scripts/smoke-test.ts)** — Reference implementation

---

## Support

- **GitHub Issues:** [https://github.com/nicofains1/agentic-ads/issues](https://github.com/nicofains1/agentic-ads/issues)
- **Discussions:** (coming soon)
- **Discord:** (coming soon — join MCP Developers community)

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

## Why This Matters

AI agents are eating the web. Users ask agents instead of searching Google. Agents answer instead of websites.

**The old internet:** Users browse websites → see ads → advertisers reach users.

**The new internet:** Users ask agents → agents scrape websites → **advertisers can't reach users**.

**agentic-ads fixes this.** It's the ad layer for the agent economy.

And you — the MCP developer — earn 70% of the revenue for being the intermediary.

**The opportunity:** 16,000+ MCP servers, almost none monetize. You can be first.

---

**Built with** [Model Context Protocol (MCP)](https://modelcontextprotocol.io) — the open standard for connecting AI agents to tools.

**Live demo:** [https://agentic-ads.onrender.com](https://agentic-ads.onrender.com)

**Get started:** Add the MCP server to your config, earn your first dollar this week.
