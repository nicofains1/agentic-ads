# Agentic Ads — OpenClaw Skill

Monetize your OpenClaw bot by showing relevant sponsored suggestions to users. Earn revenue every time a user sees or clicks a sponsored ad.

## Quick Start

### 1. Get API Keys

Run the Agentic Ads server and use the seed script to create a developer account:

```bash
cd /path/to/agentic-ads
npm run seed -- --clean
```

Save the developer API key printed to stdout (format: `aa_dev_...`).

### 2. Start the Agentic Ads Server

```bash
# HTTP mode (for remote connections)
npm start -- --http --port 3000

# Or stdio mode (for local MCP adapter)
npm start -- --stdio --api-key aa_dev_YOUR_KEY
```

### 3. Configure OpenClaw

#### Option A: Via MCP Adapter (Recommended)

If your OpenClaw instance supports MCP via `openclaw-mcp-adapter`:

```json
{
  "mcpServers": {
    "agentic-ads": {
      "command": "node",
      "args": ["/path/to/agentic-ads/dist/server.js", "--stdio", "--api-key", "aa_dev_YOUR_KEY"],
      "env": {}
    }
  }
}
```

#### Option B: Via HTTP

Set environment variables for your OpenClaw bot:

```bash
export AGENTIC_ADS_API_KEY="aa_dev_YOUR_KEY"
export AGENTIC_ADS_URL="http://localhost:3000/mcp"
```

Then add the `openclaw-skill/SKILL.md` to your bot's skill directory.

### 4. Install the Skill

Copy the `SKILL.md` file to your OpenClaw skills directory:

```bash
cp openclaw-skill/SKILL.md /path/to/your/openclaw-bot/skills/agentic-ads.md
```

## How It Works

1. User asks your bot for a product/service recommendation
2. Bot searches Agentic Ads for relevant sponsored suggestions
3. If relevant ads exist, bot presents them naturally with "Sponsored" disclosure
4. Bot reports impressions/clicks, earning you 70% of the ad revenue
5. Advertiser gets their product in front of interested users

## Revenue Model

- **CPM**: You earn per 1,000 impressions shown
- **CPC**: You earn per click on a sponsored link
- **CPA**: You earn per conversion (purchase, signup, etc.)

Revenue split: **70% developer / 30% platform**.

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `search_ads` | Search for relevant ads matching user intent |
| `report_event` | Report ad events (impression, click, conversion) |
| `get_ad_guidelines` | Get formatting guidelines for ad presentation |

## Support

- Issues: https://github.com/nicofains1/agentic-ads/issues
- Docs: See `docs/PRD.md` for the full product specification
