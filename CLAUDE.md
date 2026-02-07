# Agentic Ads

## What is this?

An MCP server that enables **advertising in AI agent conversations**. Two sides:

1. **Advertiser side**: Brands publish ads via MCP tools (budget, targeting, creative, pricing model)
2. **Consumer side**: AI agents (initially OpenClaw bots) query the MCP for relevant ads to show users contextually

The bot developer earns a commission when ads are consumed (shown, clicked, or converted).

## Vision

Think "Google AdSense for AI agents." Adidas publishes a shoe ad with a $100 budget. Alice asks her OpenClaw bot to help find sneakers. The bot searches the web AND queries our MCP. If there's a relevant ad, the bot weaves it naturally into the response: "Here's the Nike you wanted, and I also found these Adidas at a better price!" If Alice clicks or buys, the bot developer earns a cut.

## Architecture Overview

```
┌─────────────┐     MCP Tools      ┌──────────────────┐     MCP Tools      ┌──────────────┐
│  Advertiser  │ ──────────────────▶│  Agentic Ads MCP │◀────────────────── │ Consumer Bot  │
│  (Brand/API) │  publish_ad        │     Server       │  search_ads        │  (OpenClaw)   │
│              │  manage_campaign   │                  │  report_event      │              │
│              │  get_analytics     │  - Matching      │  get_guidelines    │  Shows ads   │
└─────────────┘                    │  - Billing       │                    │  to users    │
                                   │  - Analytics     │                    └──────────────┘
                                   │  - Anti-fraud    │
                                   └──────────────────┘
```

## Tech Stack

- **Runtime**: Node.js / TypeScript
- **MCP SDK**: `@modelcontextprotocol/sdk`
- **Transport**: Streamable HTTP (remote) + stdio (local dev)
- **Database**: TBD (PostgreSQL likely)
- **Target platform**: OpenClaw (via openclaw-mcp-adapter or native MCP when available)

## Key Concepts

- **Ad**: A creative unit with targeting criteria, pricing model, and budget
- **Campaign**: A collection of ads under a shared budget and objective
- **Impression**: The ad was included in an agent's response to a user
- **Click**: The user followed the ad's link
- **Conversion**: The user completed the desired action (purchase, signup)
- **Commission**: Revenue paid to the bot developer per billable event

## Project Status

**Phase**: Research & PRD — No code yet.

## Key Documents

- `docs/PRD.md` — Product Requirements Document
- `docs/research/traditional-ads-flow.md` — Reference on how traditional ads work
- `docs/research/` — Investigation notes and market research

## Development Guidelines

- Follow the GitHub Issues workflow from the global CLAUDE.md
- Branch naming: `feature/#N-description`, `fix/#N-description`
- Commit format: `feat(#N): description`, `fix(#N): description`
- All code changes require a GitHub issue first
- Main branch is protected — PRs only
