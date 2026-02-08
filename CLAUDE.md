# Agentic Ads

## What is this?

An MCP server that enables **advertising in AI agent conversations**. Two sides:

1. **Advertiser side**: Brands publish ads via MCP tools (budget, targeting, creative, pricing model)
2. **Consumer side**: AI agents (initially OpenClaw bots) query the MCP for relevant ads to show users contextually

The bot developer earns a commission when ads are consumed (shown, clicked, or converted).

## ⚠️ Behavioral Specification — Source of Truth

**`bulloak.md`** es la especificación completa del comportamiento del MCP. Antes de modificar cualquier lógica de negocio, consultar bulloak.md. Cuando se agrega una feature nueva, actualizar bulloak.md PRIMERO.

Cubre:
- Todos los flows de publisher (advertiser) y consumer (developer)
- Expected behavior de cada tool (happy path + error paths)
- Pricing models (CPC/CPM/CPA) con montos exactos
- Auth, rate limiting, access control
- Matching algorithm, ranking formula, keyword extraction
- Transport (stdio + HTTP), sesiones, health check
- DB schema, constraints, indices

**Regla**: Si el código contradice bulloak.md, el código está mal.

## Vision

Think "Google AdSense for AI agents." Adidas publishes a shoe ad with a $100 budget. Alice asks her OpenClaw bot to help find sneakers. The bot searches the web AND queries our MCP. If there's a relevant ad, the bot weaves it naturally into the response: "Here's the Nike you wanted, and I also found these Adidas at a better price!" If Alice clicks or buys, the bot developer earns a cut.

## Architecture Overview

```
┌─────────────┐     MCP Tools      ┌──────────────────┐     MCP Tools      ┌──────────────┐
│  Advertiser  │ ──────────────────▶│  Agentic Ads MCP │◀────────────────── │ Consumer Bot  │
│  (Brand/API) │  create_campaign   │     Server       │  search_ads        │  (OpenClaw)   │
│              │  create_ad         │                  │  report_event      │              │
│              │  get_analytics     │  - Matching      │  get_guidelines    │  Shows ads   │
└─────────────┘                    │  - Billing       │                    │  to users    │
                                   │  - Auth & Rate   │                    └──────────────┘
                                   │  - Analytics     │
                                   └──────────────────┘
```

## Tech Stack

- **Runtime**: Node.js 22+ / TypeScript (ESM)
- **MCP SDK**: `@modelcontextprotocol/sdk` ^1.12.0
- **Transport**: Streamable HTTP (remote) + stdio (local)
- **Database**: SQLite via `better-sqlite3` (WAL mode, foreign keys ON)
- **Validation**: `zod` ^3.24.0
- **Testing**: `vitest` ^3.0.0
- **Target platform**: OpenClaw (via MCP adapter)

## Key Concepts

- **Campaign**: Budget container with pricing model (CPC/CPM/CPA) and objective
- **Ad**: Creative unit with targeting (keywords, categories, geo, language)
- **Impression**: Ad shown in agent response → billable only for CPM
- **Click**: User follows ad link → billable only for CPC
- **Conversion**: User completes action → billable only for CPA
- **Revenue split**: 70% developer / 30% platform
- **Ranking**: relevance² × bidFactor × quality_score (relevance dominates)

## Project Status

**Phase**: MVP complete — all 17 issues closed.

### MCP Tools (6)
| Tool | Auth | Description |
|------|------|-------------|
| `search_ads` | public | Search for relevant ads by query/keywords/category/geo |
| `report_event` | developer | Report impression/click/conversion events |
| `get_ad_guidelines` | public | Get ad formatting guidelines for agents |
| `create_campaign` | advertiser | Create campaign with budget and pricing model |
| `create_ad` | advertiser | Create ad with creative, keywords, targeting |
| `get_campaign_analytics` | advertiser | Get campaign performance metrics |

## Key Documents

- **`bulloak.md`** — Behavioral specification (source of truth)
- `docs/PRD.md` — Product Requirements Document
- `docs/research/traditional-ads-flow.md` — Reference on traditional ad flows
- `openclaw-skill/SKILL.md` — OpenClaw agent integration instructions

## Key Files

- `src/server.ts` — MCP server, tool registration, transport startup
- `src/db/schema.ts` — TypeScript interfaces + SQL DDL
- `src/db/index.ts` — CRUD operations
- `src/matching/keyword-matcher.ts` — Keyword matching algorithm
- `src/matching/ranker.ts` — Ad ranking formula
- `src/auth/middleware.ts` — API key auth (generate, hash, authenticate)
- `src/auth/rate-limiter.ts` — Sliding window rate limiter
- `src/tools/consumer/get-guidelines.ts` — Static ad guidelines
- `scripts/seed.ts` — Demo data (Adidas, Spotify, TestBot)
- `scripts/smoke-test.ts` — MCP protocol smoke test

## Development Guidelines

- Follow the GitHub Issues workflow from the global CLAUDE.md
- Branch naming: `feature/#N-description`, `fix/#N-description`, `docs/#N-description`
- Commit format: `feat(#N): description`, `fix(#N): description`, `docs(#N): description`
- All code changes require a GitHub issue first
- Main branch is protected — PRs only
- Before changing behavior: check bulloak.md, update it first if needed
- After changing behavior: run `npx vitest run` (38 tests) + smoke test
