# Demo MCP Server with Agentic Ads

A working MCP server that demonstrates how to monetize your MCP tools using [Agentic Ads](https://agentic-ads.fly.dev) — the ad network for AI agents.

## What It Does

This server provides two useful tools:

| Tool | Description |
|------|-------------|
| `get_random_fact` | Returns a random interesting fact (optionally filtered by category) |
| `check_website_status` | Checks if a website is reachable (HTTP status, response time, headers) |

On every tool call, the server:
1. Calls the Agentic Ads MCP endpoint to fetch a relevant contextual ad
2. Appends the ad to the tool response (disclosed as "Sponsored")
3. Reports an impression event so you earn 70% of the ad revenue

## Quick Start

### 1. Install dependencies

```bash
cd examples/demo-mcp-server
npm install
npm run build
```

### 2. Get your API key

```bash
curl -X POST https://agentic-ads.fly.dev/api/register \
  -H "Content-Type: application/json" \
  -d '{"name": "My Bot", "email": "me@example.com"}'
```

Response:
```json
{
  "developer_id": "...",
  "api_key": "aa_dev_...",
  "mcp_url": "https://agentic-ads.fly.dev/mcp"
}
```

### 3. Set your API key

```bash
export AGENTIC_ADS_API_KEY=aa_dev_your_key_here
```

### 4. Add to Claude Desktop

Edit your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "demo-with-ads": {
      "command": "node",
      "args": ["/absolute/path/to/examples/demo-mcp-server/build/index.js"],
      "env": {
        "AGENTIC_ADS_API_KEY": "aa_dev_your_key_here"
      }
    }
  }
}
```

### 5. Add to Cursor

Edit your `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "demo-with-ads": {
      "command": "node",
      "args": ["/absolute/path/to/examples/demo-mcp-server/build/index.js"],
      "env": {
        "AGENTIC_ADS_API_KEY": "aa_dev_your_key_here"
      }
    }
  }
}
```

### 6. Test it manually

```bash
# Run interactively
AGENTIC_ADS_API_KEY=aa_dev_... node build/index.js
# Then ask Claude: "Get me a random fact about crypto"
# You'll see a fact + a sponsored ad from the network
```

## How It Works

```
User asks Claude → Claude calls get_random_fact
                         │
                         ├── Compute fact
                         ├── Fetch contextual ad from Agentic Ads (MCP protocol)
                         ├── Fire impression event (async, non-blocking)
                         └── Return fact + ad to Claude
```

The ad fetch uses the Agentic Ads MCP protocol directly:
1. `POST /mcp` → `initialize` → get `mcp-session-id`
2. `POST /mcp` → `notifications/initialized`
3. `POST /mcp` → `tools/call` → `search_ads` (returns top ad)
4. `POST /mcp` → `tools/call` → `report_event` (impression, fire-and-forget)

## Revenue

- You earn **70% of ad revenue** on every billable event
- CPM campaigns: earn on impressions
- CPC campaigns: earn when users click ad links
- Check your earnings: `get_developer_earnings` tool (on the Agentic Ads MCP server)

## Verify Your Earnings

After running the demo and making tool calls, check your earnings via the Agentic Ads MCP server:

```bash
# Using the agentic-ads npm package
AGENTIC_ADS_API_KEY=aa_dev_... npx agentic-ads --stdio
# Then call: get_developer_earnings
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AGENTIC_ADS_API_KEY` | Yes (for revenue) | — | Your developer API key (`aa_dev_...`) |
| `AGENTIC_ADS_SERVER` | No | `https://agentic-ads.fly.dev` | Override ad server URL (for local testing) |

## Local Testing with Custom Ad Server

```bash
# Start a local agentic-ads server
npx agentic-ads --http --port 3001 --db ./test.db

# Run demo server against local ad server
AGENTIC_ADS_SERVER=http://localhost:3001 \
AGENTIC_ADS_API_KEY=aa_dev_your_local_key \
node build/index.js
```

## Extending

To add more tools with ads:

```typescript
server.tool("my_tool", "Description", { /* params */ }, async (params) => {
  // 1. Do your tool's work
  const result = await doSomething(params);

  // 2. Fetch contextual ad
  const ad = await fetchAdWithImpression("query about the topic", ["keyword1", "keyword2"]);

  // 3. Return result + optional ad
  return {
    content: [{
      type: "text",
      text: result + (ad ? formatAd(ad) : ""),
    }],
  };
});
```

## License

MIT
