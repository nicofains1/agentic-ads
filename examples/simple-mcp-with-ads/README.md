# Simple MCP Server with Agentic Ads

A minimal example showing how to integrate Agentic Ads into your MCP server.

## What This Does

This example MCP server provides a single tool (`get_weather`) and monetizes it with contextual ads from the Agentic Ads network.

## Quick Start

```bash
# 1. Clone or fork this directory
cd examples/simple-mcp-with-ads

# 2. Install dependencies
npm install

# 3. Build
npm run build

# 4. Configure Claude Desktop
# Add to your claude_desktop_config.json:
{
  "mcpServers": {
    "weather-with-ads": {
      "command": "node",
      "args": ["/path/to/examples/simple-mcp-with-ads/build/index.js"]
    }
  }
}

# 5. Restart Claude Desktop
```

## How It Works

The example uses direct HTTP calls to the Agentic Ads MCP endpoint. No SDK import needed.

```typescript
// Fetch a contextual ad via MCP protocol
const ad = await searchAds(`Weather in ${city}`, ["weather", "forecast", city]);

if (ad) {
  // Include ad in your response
  adContent = `\n\n---\nSponsored: ${ad.creative_text}\n${ad.link_url}`;
}
```

See `src/index.ts` for the full implementation.

## Getting Your API Key

Register as a developer to track revenue:

```bash
curl -X POST https://agentic-ads.onrender.com/api/register \
  -H "Content-Type: application/json" \
  -d '{"name": "My Bot", "email": "me@example.com"}'
# Returns: { "developer_id": "...", "api_key": "aa_dev_..." }
```

Set your key: `export AGENTIC_ADS_API_KEY=aa_dev_...`

## Revenue Sharing

- You earn 70% of ad revenue
- Ads are contextual and non-intrusive
- Revenue tracked per tool invocation via `report_event`

## Customization

### Ad Placement Strategies

```typescript
// Strategy 1: Bottom of response (least intrusive)
return {
  content: [
    { type: "text", text: mainContent },
    { type: "text", text: `\n---\n${ad.content}` },
  ],
};

// Strategy 2: Inline (higher engagement)
return {
  content: [
    { type: "text", text: `${mainContent}\n\n💡 ${ad.content}` },
  ],
};

// Strategy 3: Conditional (only for certain queries)
const shouldShowAd = isCommercialQuery(request.params.arguments);
if (shouldShowAd) {
  const ad = await ads.fetchAd({ ... });
}
```

### Targeting Keywords

```typescript
// Generic
keywords: ["weather", "forecast"]

// Location-specific
keywords: ["weather", city, "travel", "tourism"]

// Intent-based
keywords: ["weather", "outdoor", "planning", "vacation"]
```

## Next Steps

1. **Get API Key**: `POST https://agentic-ads.onrender.com/api/register` with `{name, email}`
2. **Set Key**: `export AGENTIC_ADS_API_KEY=aa_dev_...`
3. **Optimize Placement**: Experiment with ad positioning and keywords
4. **Scale Up**: Add ads to multiple tools in your server

## Support

- 🐛 [Report Issues](https://github.com/nicofains1/agentic-ads/issues)
- 💬 [Discussions](https://github.com/nicofains1/agentic-ads/discussions)
- 📖 [Full Documentation](https://github.com/nicofains1/agentic-ads/blob/main/README.md)

## License

MIT — Free to fork, modify, and use commercially.
