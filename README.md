# Agentic Ads

**Monetize your MCP server in 5 minutes.** Privacy-respecting contextual ads for AI agents, with 70% revenue split to developers.

[![Tests](https://img.shields.io/badge/tests-270%20passing-brightgreen)](https://github.com/nicofains1/agentic-ads)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![MCP](https://img.shields.io/badge/MCP-v1.12.0-orange)](https://modelcontextprotocol.io)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org)

---

## What is this?

An **MCP server** that serves contextual ads to AI agents. Think "Google AdSense for AI agents."

- **For MCP developers**: Earn 70% revenue when your agent shows/clicks ads
- **For advertisers**: Reach users inside AI agent conversations
- **For users**: See relevant, privacy-respecting ads (no tracking, no profiling)

**Live demo**: [https://agentic-ads.onrender.com](https://agentic-ads.onrender.com)

---

## Quick Start (30 seconds)

### Option 1: Try it with npx (stdio)

```bash
# Install as MCP server
npx agentic-ads --stdio

# Or run smoke test
git clone https://github.com/nicofains1/agentic-ads.git
cd agentic-ads
npm install && npm run build
tsx scripts/smoke-test.ts --db test.db --dev-key demo-dev --adv-key demo-adv
```

### Option 2: Connect to live HTTP server

Add to your MCP client config:

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

---

## How It Works

```
┌─────────────┐     MCP Tools      ┌──────────────────┐     MCP Tools      ┌──────────────┐
│  Advertiser  │ ──────────────────▶│  Agentic Ads MCP │◀────────────────── │  Your Agent   │
│  (Brand/API) │  create_campaign   │     Server       │  search_ads        │  (MCP client) │
│              │  create_ad         │                  │  report_event      │               │
│              │  get_analytics     │  - Matching      │  get_guidelines    │  Shows ads    │
└─────────────┘                    │  - Billing       │                    │  to users     │
                                   │  - Auth & Rate   │                    └──────────────┘
                                   │  - Analytics     │
                                   └──────────────────┘
```

**Example**: User asks your agent "best running shoes for marathon" → Your agent calls `search_ads` → Gets relevant ad → Weaves it naturally into response → User clicks → You earn 70% of $0.50 CPC = $0.35

---

## MCP Tools (8)

### For Developers (Consumer Side)

| Tool | Auth | Description |
|------|------|-------------|
| `search_ads` | Public | Search for relevant ads by query/keywords/category/geo |
| `report_event` | Developer key | Report impression/click/conversion events |
| `get_ad_guidelines` | Public | Get ad formatting guidelines for agents |

### For Advertisers (Publisher Side)

| Tool | Auth | Description |
|------|------|-------------|
| `create_campaign` | Advertiser key | Create campaign with budget and pricing model |
| `create_ad` | Advertiser key | Create ad with creative, keywords, targeting |
| `get_campaign_analytics` | Advertiser key | Get campaign performance metrics |
| `update_campaign` | Advertiser key | Update campaign fields, pause/resume |
| `list_campaigns` | Advertiser key | List all campaigns with summary stats |

---

## Example: Search for Ads

```typescript
// Tool: search_ads
{
  "query": "best running shoes for marathon",
  "keywords": ["running shoes", "sneakers"],
  "category": "footwear",
  "geo": "US",
  "language": "en",
  "max_results": 3
}

// Response:
{
  "ads": [
    {
      "ad_id": "ad_abc123",
      "creative_text": "Ultraboost 23 - $180. Engineered for marathon runners.",
      "link_url": "https://adidas.com/ultraboost",
      "relevance_score": 0.95,
      "disclosure": "sponsored",
      "pricing_model": "cpc",
      "bid_amount": 0.50
    }
  ],
  "request_id": "req_xyz789"
}
```

---

## Example: Report Events

```typescript
// Tool: report_event (impression)
{
  "ad_id": "ad_abc123",
  "event_type": "impression"
}

// Response (CPC model = impressions are free):
{
  "event_type": "impression",
  "amount_charged": 0.00,
  "developer_revenue": 0.00
}

// Tool: report_event (click)
{
  "ad_id": "ad_abc123",
  "event_type": "click"
}

// Response (CPC $0.50 → you earn $0.35):
{
  "event_type": "click",
  "amount_charged": 0.50,
  "developer_revenue": 0.35
}
```

---

## Revenue Models

| Model | Advertiser Pays | Developer Earns | When Charged |
|-------|----------------|-----------------|--------------|
| **CPC** (Click) | $0.50 per click | $0.35 (70%) | User clicks ad link |
| **CPM** (Impression) | $5.00 per 1000 impressions | $3.50 (70%) | Ad shown to user |
| **CPA** (Conversion) | $10.00 per conversion | $7.00 (70%) | User completes action |

**Revenue split**: 70% developer / 30% platform (industry-leading for developers)

---

## Installation

### As MCP Server (stdio)

```bash
npm install -g agentic-ads

# Run as stdio MCP server
agentic-ads --stdio

# Or with custom database
agentic-ads --stdio --db /path/to/db.sqlite
```

### As HTTP Server (remote)

```bash
git clone https://github.com/nicofains1/agentic-ads.git
cd agentic-ads
npm install
npm run build

# Start HTTP server
npm run start:http

# Or with custom port
PORT=8080 npm run start:http
```

### Environment Variables

```bash
PORT=19877              # HTTP server port (default: 19877)
DB_PATH=./ads.db        # SQLite database path
API_KEY_DEV=your-key    # Developer API key (optional, for auth)
API_KEY_ADV=your-key    # Advertiser API key (optional, for auth)
```

---

## Integration Examples

### Claude Desktop (stdio)

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

### Cursor / Windsurf (HTTP)

Add to MCP config:

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

### Custom Agent (TypeScript)

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
    max_results: 3
  }
});

console.log(result.content[0].text);
```

---

## Development

```bash
# Clone repo
git clone https://github.com/nicofains1/agentic-ads.git
cd agentic-ads

# Install dependencies
npm install

# Run tests (270 passing)
npm test

# Build
npm run build

# Run smoke test
tsx scripts/smoke-test.ts --db test.db --dev-key demo-dev --adv-key demo-adv

# Seed demo data
npm run seed
```

---

## Key Features

- **Privacy-respecting**: No user tracking, no profiling, no cookies
- **Contextual matching**: Keyword-based relevance scoring (like early Google AdWords)
- **Fair revenue split**: 70/30 in favor of developers (industry-leading)
- **Multiple pricing models**: CPC, CPM, CPA
- **Rate limiting**: Protects against abuse (100 req/min default)
- **Auth & access control**: Developer vs advertiser role separation
- **Analytics**: Real-time campaign performance tracking
- **Production-ready**: 270 tests, SQLite (WAL mode), TypeScript, ESM

---

## Architecture

- **Runtime**: Node.js 22+ / TypeScript (ESM)
- **MCP SDK**: `@modelcontextprotocol/sdk` ^1.12.0
- **Transport**: Streamable HTTP + stdio
- **Database**: SQLite via `better-sqlite3` (WAL mode, foreign keys)
- **Validation**: Zod schemas for all inputs
- **Testing**: Vitest (270 tests across 13 files)

---

## Documentation

- **[CLAUDE.md](CLAUDE.md)** — Project overview for developers
- **[bulloak.md](bulloak.md)** — Behavioral specification (source of truth)
- **[docs/PRD.md](docs/PRD.md)** — Product Requirements Document
- **[scripts/smoke-test.ts](scripts/smoke-test.ts)** — Reference implementation

---

## Roadmap

- [x] MVP: 8 MCP tools, auth, billing, matching (v0.1.0)
- [ ] Submit to Anthropic MCP Registry
- [ ] Submit to Smithery.ai marketplace
- [ ] One-click demo (CodeSandbox/Replit)
- [ ] Video tutorial: "Monetize your MCP server in 5 minutes"
- [ ] Dashboard UI for advertisers
- [ ] Webhook support for conversions

---

## FAQ

**Q: How do I get API keys?**
A: For testing, use `demo-dev` / `demo-adv`. For production, run `npm run seed` to generate real keys.

**Q: Is this production-ready?**
A: Yes. 270 passing tests, deployed at https://agentic-ads.onrender.com (Render free tier).

**Q: Do you track users?**
A: No. We only match ads to the query/keywords you send. No cookies, no user IDs, no profiling.

**Q: What if my agent shows ads but user doesn't click?**
A: Depends on pricing model. CPC = you earn $0 (only charged on click). CPM = you earn revenue per 1000 impressions.

**Q: Can I use this for my OpenClaw bot?**
A: Yes! See `openclaw-skill/SKILL.md` for integration instructions.

**Q: How do I create ads?**
A: Use the `create_campaign` and `create_ad` MCP tools with an advertiser API key. See [smoke-test.ts](scripts/smoke-test.ts) for examples.

---

## Contributing

This project follows the GitHub Issues workflow. Before making changes:

1. Check if an issue exists for your idea
2. If not, create one: `gh issue create --title "Your idea"`
3. Get approval before starting work
4. Branch: `feature/#N-description`
5. Commit: `feat(#N): description`
6. PR to `main` branch

See [CLAUDE.md](CLAUDE.md) for detailed workflow.

---

## License

MIT — see [LICENSE](LICENSE) for details.

---

## Questions?

- **GitHub Issues**: [https://github.com/nicofains1/agentic-ads/issues](https://github.com/nicofains1/agentic-ads/issues)
- **Email**: (coming soon)
- **Discord**: (coming soon — MCP Developers community)

---

**Built with** [Model Context Protocol (MCP)](https://modelcontextprotocol.io) — the open standard for connecting AI agents to tools.
