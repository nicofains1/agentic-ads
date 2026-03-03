# ADK Integration Guide — Agentic Ads MCP Server

This guide shows how to connect Google's [Agent Development Kit (ADK)](https://github.com/google/adk-python) to the Agentic Ads MCP server so your ADK agent can serve contextual ads and earn revenue.

## Overview

Agentic Ads exposes a [Streamable HTTP MCP server](https://modelcontextprotocol.io/docs/concepts/transports#streamable-http). ADK supports Streamable HTTP natively — no SSE adapter needed.

```
ADK Agent → MCP Client (Streamable HTTP) → Agentic Ads MCP Server
```

When a user asks your agent something, it calls `search_ads` to find relevant ads, shows them in the response, and earns 70% of the click revenue.

---

## Quick Start

### 1. Register as a Developer

```bash
curl -X POST https://agentic-ads-production.up.railway.app/api/register \
  -H "Content-Type: application/json" \
  -d '{"name": "My ADK Bot", "email": "bot@example.com"}'
```

Response:
```json
{
  "developer": { "id": "dev-uuid", "name": "My ADK Bot" },
  "api_key": "aa_dev_xxxxxxxxxxxxxxxxxxxx"
}
```

Save the `api_key` — you'll use it as `AGENTIC_ADS_KEY`.

### 2. Python ADK Agent with Agentic Ads

Install dependencies:
```bash
pip install google-adk
```

Create `agent.py`:

```python
import os
import asyncio
from google.adk.agents import LlmAgent
from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset, StreamableHTTPConnectionParams

AGENTIC_ADS_KEY = os.environ["AGENTIC_ADS_KEY"]  # aa_dev_xxx

async def main():
    # Connect to Agentic Ads MCP server via Streamable HTTP
    toolset = MCPToolset(
        connection_params=StreamableHTTPConnectionParams(
            url="https://agentic-ads-production.up.railway.app/mcp",
            headers={"Authorization": f"Bearer {AGENTIC_ADS_KEY}"},
        )
    )

    agent = LlmAgent(
        model="gemini-2.0-flash",
        name="my_assistant",
        instruction="""You are a helpful assistant.

        When the user asks about tools, services, databases, hosting, or any developer product,
        call search_ads with a relevant query. If relevant ads are returned, present them naturally
        at the end of your response as "Sponsored: [ad text] → [link]".

        Always call report_event with event_type=impression after showing an ad,
        and event_type=click if the user clicks (follow up question about the product).""",
        tools=[toolset],
    )

    # Example: user query that triggers ad search
    response = await agent.run("What's a good database for my serverless app?")
    print(response)
    await toolset.close()

if __name__ == "__main__":
    asyncio.run(main())
```

Run it:
```bash
AGENTIC_ADS_KEY=aa_dev_xxx python agent.py
```

---

## Available MCP Tools

Once connected, your ADK agent has access to these tools:

### Consumer Tools (for developer bots)

| Tool | Description |
|------|-------------|
| `search_ads` | Find contextually relevant ads for a query |
| `report_event` | Report impression/click/conversion events |
| `get_ad_guidelines` | Get content policy and ad format specs |
| `get_developer_earnings` | Check your cumulative earnings |
| `register_wallet` | Register crypto wallet for USDC payouts |
| `request_withdrawal` | Withdraw earnings to your wallet |

### Advertiser Tools (for campaign managers)

| Tool | Description |
|------|-------------|
| `create_campaign` | Create a new ad campaign |
| `create_ad` | Add ad creative to a campaign |
| `get_campaign_analytics` | View spend, clicks, conversions |
| `update_campaign` | Pause, resume, or modify campaigns |
| `list_campaigns` | List all campaigns |

---

## search_ads Example

```python
# The ADK agent calls this automatically when you use MCPToolset,
# but here's the raw tool call for reference:

result = await toolset.call_tool("search_ads", {
    "query": "serverless database for my Next.js app",
    "context": "User building a web app, asking about database options",
    "max_ads": 3,
    "min_relevance": 0.3
})

# Example response:
# {
#   "ads": [
#     {
#       "ad_id": "...",
#       "creative_text": "Serverless Postgres that scales to zero...",
#       "link_url": "https://neon.tech",
#       "relevance_score": 0.85,
#       "pricing_model": "cpc",
#       "bid_amount": 0.15
#     }
#   ],
#   "developer_id": "dev-uuid"
# }
```

## report_event Example

```python
# After showing an ad, report the impression:
await toolset.call_tool("report_event", {
    "ad_id": "ad-uuid-from-search_ads",
    "event_type": "impression"
})

# If the user clicked (e.g., asked follow-up about the product):
await toolset.call_tool("report_event", {
    "ad_id": "ad-uuid-from-search_ads",
    "event_type": "click"
})
```

---

## ADK Multi-Agent Pattern

For multi-agent architectures, add Agentic Ads as a tool to your orchestrator agent:

```python
from google.adk.agents import LlmAgent
from google.adk.tools.mcp_tool.mcp_toolset import MCPToolset, StreamableHTTPConnectionParams

# Create a sub-agent specialized in monetization
ads_toolset = MCPToolset(
    connection_params=StreamableHTTPConnectionParams(
        url="https://agentic-ads-production.up.railway.app/mcp",
        headers={"Authorization": f"Bearer {os.environ['AGENTIC_ADS_KEY']}"},
    )
)

monetization_agent = LlmAgent(
    model="gemini-2.0-flash",
    name="monetization_agent",
    instruction="Find and report contextual ads for user queries.",
    tools=[ads_toolset],
)

# Root orchestrator delegates to the monetization agent
root_agent = LlmAgent(
    model="gemini-2.0-flash",
    name="root_agent",
    instruction="Route monetization tasks to monetization_agent.",
    sub_agents=[monetization_agent],
)
```

---

## Revenue Model

- **Impressions**: Free (no charge, no earnings)
- **Clicks (CPC)**: $0.15–$0.40 per click → **you earn 70%** ($0.105–$0.28)
- **Conversions (CPA)**: $2.00 per verified on-chain conversion → **you earn $1.40**

Earnings accumulate in your developer account. Withdraw anytime via `request_withdrawal` (USDC on Polygon).

---

## Live Server

| Endpoint | URL |
|----------|-----|
| MCP (Streamable HTTP) | `https://agentic-ads-production.up.railway.app/mcp` |
| Health | `https://agentic-ads-production.up.railway.app/health` |
| Register (REST) | `POST https://agentic-ads-production.up.railway.app/api/register` |
| Search (REST) | `GET https://agentic-ads-production.up.railway.app/api/search?q=...` |

---

## Related Issues
- #104: This doc (ADK integration example and docs)
- #55: First consumer bot (clawdbot)
- #108: E2E demo payment flow script
