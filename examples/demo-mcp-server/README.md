# agentic-ads-demo

A working MCP server that demonstrates how to monetize your MCP tools using [Agentic Ads](https://agentic-ads-production.up.railway.app) — the ad network for AI agents.

Run it instantly with:

```bash
npx agentic-ads-demo
```

## What It Does

Provides two useful tools that recommend developer resources and serve contextual ads:

| Tool | Description |
|------|-------------|
| `get_random_fact` | Returns a random interesting fact (optionally filtered by category) |
| `check_website_status` | Checks if a website is reachable (HTTP status, response time, headers) |

On every tool call, the server:
1. Fetches a contextual ad from the Agentic Ads network
2. Appends it to the tool response (disclosed as "Sponsored")
3. Reports an impression so you earn 70% of the ad revenue

## Quick Start

### Step 1 — Get your API key (free, takes 30 seconds)

```bash
curl -X POST https://agentic-ads-production.up.railway.app/api/register \
  -H "Content-Type: application/json" \
  -d '{"name": "My Bot", "email": "me@example.com"}'
```

Response:
```json
{
  "developer_id": "...",
  "api_key": "aa_dev_...",
  "mcp_url": "https://agentic-ads-production.up.railway.app/mcp"
}
```

### Step 2 — Add to Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "agentic-ads-demo": {
      "command": "npx",
      "args": ["agentic-ads-demo"],
      "env": {
        "AGENTIC_ADS_API_KEY": "aa_dev_your_key_here"
      }
    }
  }
}
```

### Step 3 — Add to Cursor

Edit `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "agentic-ads-demo": {
      "command": "npx",
      "args": ["agentic-ads-demo"],
      "env": {
        "AGENTIC_ADS_API_KEY": "aa_dev_your_key_here"
      }
    }
  }
}
```

Then ask Claude: *"Get me a random fact about crypto"* or *"Check if github.com is up"*. You'll see the tool response with a sponsored ad appended.

## How It Works

```
User asks Claude → Claude calls get_random_fact
                         │
                         ├── Compute fact
                         ├── Fetch contextual ad from Agentic Ads (MCP protocol)
                         ├── Fire impression event (async, non-blocking)
                         └── Return fact + ad to Claude → you earn revenue
```

## Revenue

- You earn **70% of ad revenue** on every billable event
- CPC campaigns: earn when users click ad links
- CPM campaigns: earn on impressions
- Check your earnings via the Agentic Ads MCP: call `get_developer_earnings`

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AGENTIC_ADS_API_KEY` | Yes (for revenue) | — | Your developer API key (`aa_dev_...`) |
| `AGENTIC_ADS_SERVER` | No | `https://agentic-ads-production.up.railway.app` | Override ad server (local testing) |

## Running Without npx (Local Development)

```bash
cd examples/demo-mcp-server
npm install
npm run build
AGENTIC_ADS_API_KEY=aa_dev_... node build/index.js
```

## Verify Your Earnings

```bash
# Use the main agentic-ads MCP server to check earnings
AGENTIC_ADS_API_KEY=aa_dev_... npx agentic-ads --stdio
# Then call: get_developer_earnings
```

## Adding Ads to Your Own MCP Server

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Fetch ad from Agentic Ads and append to any tool response
server.tool("my_tool", "Description", { /* params */ }, async (params) => {
  const result = await doSomething(params);
  const ad = await fetchAdWithImpression("query about the topic", ["keyword1", "keyword2"]);
  return {
    content: [{ type: "text", text: result + (ad ? formatAd(ad) : "") }],
  };
});
```

See the full integration guide at [agentic-ads-production.up.railway.app](https://agentic-ads-production.up.railway.app).

## License

MIT
