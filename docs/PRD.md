# Agentic Ads — Product Requirements Document

**Version**: 1.0
**Date**: 2026-02-08
**Status**: MVP Complete

---

## 1. Executive Summary

Agentic Ads is an MCP (Model Context Protocol) server that creates a two-sided advertising marketplace for AI agents. Advertisers publish ads through MCP tools, and consumer-facing AI agents query for relevant ads to show their users contextually. When an ad is consumed (viewed, clicked, or leads to a conversion), the bot developer earns a commission from the advertiser's budget.

**Initial target platform**: OpenClaw (145K+ GitHub stars, open-source AI agent with messaging integrations and nascent MCP support).

**Market context**: "Agentic advertising" is emerging rapidly. PubMatic launched AgenticOS, IAB Tech Lab published the ARTF standard, and the Agentic Advertising Organization (AAO) published AdCP on top of MCP. Meanwhile, Perplexity and ChatGPT are pioneering agentic commerce. McKinsey projects $1-5T in agentic commerce by 2030. However, no one has built the intermediary MCP that connects advertiser agents to consumer agents in an ad-auction model — this is our whitespace.

**Current state**: MVP is fully implemented with 8 MCP tools, 270 tests across 13 files, keyword matching + ranking engine, SQLite database, dual transport (stdio + Streamable HTTP), API key auth with rate limiting, and an OpenClaw skill. See `bulloak.md` for the complete behavioral specification.

---

## 2. Problem Statement

### For Bot Developers
- OpenClaw bots have no monetization mechanism beyond paid marketplace listings
- Developers build useful bots (shopping assistants, personal assistants) but can't earn revenue from user interactions
- There's no "AdSense equivalent" for AI agent conversations

### For Advertisers
- Traditional ads target web pages and apps, not AI agent conversations
- As users shift from browsing to asking agents, advertisers lose reach
- No programmatic way to place ads inside agent-mediated experiences

### For Users
- Users asking agents for product recommendations get results from web scraping only
- No mechanism for brands to surface relevant promotions through agents
- The experience could be improved with contextual, non-intrusive sponsored suggestions

---

## 3. Solution Overview

An MCP server with two sets of tools:

### Advertiser Tools (5)
| Tool | Status | Description |
|------|--------|-------------|
| `create_campaign` | ✅ Implemented | Create an ad campaign with budget, objective, and pricing model |
| `create_ad` | ✅ Implemented | Create an ad unit within a campaign (creative, targeting, link) |
| `update_campaign` | ✅ Implemented | Modify campaign parameters (budget, status, targeting). Covers pause/resume via status field |
| `get_campaign_analytics` | ✅ Implemented | Retrieve performance metrics (impressions, clicks, conversions, spend) |
| `list_campaigns` | ✅ Implemented | List all campaigns with summary stats, optional status filter |

### Consumer Agent Tools (3)
| Tool | Status | Description |
|------|--------|-------------|
| `search_ads` | ✅ Implemented | Query for ads matching a user intent/context (returns ranked results) |
| `report_event` | ✅ Implemented | Report an ad event (impression, click, conversion) |
| `get_ad_guidelines` | ✅ Implemented | Get formatting guidelines for how to present ads naturally |

### Internal/Admin Tools (future)
| Tool | Status | Description |
|------|--------|-------------|
| `get_platform_analytics` | Not started | Overall marketplace health metrics |
| `manage_developer_account` | Not started | Developer registration, payout config |
| `review_ad` | Not started | Ad moderation and approval |

---

## 4. End-to-End Flow

### 4.1 Advertiser Flow

```
1. Adidas creates an account on Agentic Ads platform
2. Adidas creates a campaign:
   - Budget: $100
   - Objective: "conversions" (drive purchases)
   - Pricing: CPC $0.50
   - Daily budget cap: $10/day
3. Adidas creates an ad within the campaign:
   - Creative: "Adidas Ultraboost 24 — Now 30% off! Free shipping."
   - Link: https://adidas.com/ultraboost?utm_source=agentic_ads&utm_campaign=123
   - Targeting:
     - Keywords: ["running shoes", "sneakers", "athletic shoes", "ultraboost"]
     - Categories: ["footwear", "sports", "running"]
     - Context: language=en, geo=US
4. Ad is immediately active (no review process in MVP)
5. Budget decrements as events occur
6. Adidas monitors analytics via `get_campaign_analytics`
7. Adidas can pause/resume via `update_campaign`
8. Adidas can list all campaigns via `list_campaigns`
```

### 4.2 Consumer Agent Flow

```
1. Alice messages her OpenClaw bot: "I want to buy running shoes, love Nike, budget around $150"
2. Bot gathers preferences: size 8, women's, neutral color, road running
3. Bot searches the web for options (existing OpenClaw behavior)
4. Bot ALSO calls `search_ads` on Agentic Ads MCP:
   - query: "women's running shoes"
   - keywords: ["running shoes", "nike", "women"]
   - category: "footwear"
   - language: "en"
   - geo: "US"
5. MCP returns ranked ads:
   [
     { ad_id: "abc", advertiser_name: "Adidas",
       creative_text: "Ultraboost 24 — 30% off!",
       link_url: "https://...", relevance_score: 0.87,
       disclosure: "sponsored" }
   ]
6. Bot integrates ad into response naturally:
   "Here are some great options:
    1. Nike Pegasus 41 — $130 at Nike.com (your search)
    2. ⭐ Adidas Ultraboost 24 — $112 (30% off!) at Adidas.com (sponsored)
    3. New Balance Fresh Foam — $125 at newbalance.com (your search)
    The Adidas is actually a great deal — better cushioning reviews than the Pegasus."
7. Bot calls `report_event` with type: "impression" for the Adidas ad
8. If Alice clicks the Adidas link → bot reports "click" event
9. If Alice purchases → conversion tracking reports "conversion" event
```

### 4.3 Revenue Flow

```
Advertiser spends $100 campaign budget
    ↓
Events occur (impressions, clicks, conversions)
    ↓
Revenue split per event:
    - Platform (Agentic Ads): 30% of event cost
    - Bot Developer: 70% of event cost
    ↓
Example: CPC $0.50 click
    - Platform gets: $0.15
    - Bot developer gets: $0.35
    ↓
Payouts aggregate and settle periodically
```

**Revenue share**: 70/30 in favor of bot developers (comparable to AdSense's 68% to publishers).

---

## 5. Matching & Ranking Algorithm

### Hybrid Approach: MCP Pre-filters, Agent Decides

The matching happens in two stages:

**Stage 1: MCP Server (Centralized Pre-filtering)** ✅ Implemented
- Receives query with keywords, category, and context signals
- Extracts keywords from natural language query (stopword filtering for EN + ES)
- Filters by: keyword relevance, category match, geo, language, budget availability, campaign status
- Ranks by score:
  - **Formula**: `Score = relevance² × bidFactor × quality_score`
  - `bidFactor = 0.7 + 0.3 × (bid / maxBid)` — range 0.7 to 1.0
  - `relevance²` exponentially penalizes low relevance (relevance dominates)
  - `MIN_RELEVANCE_THRESHOLD = 0.1` — below this, ad is discarded
- Returns top N candidates (configurable via `max_results`, default 3, max 10)

**Stage 2: Consumer Agent (Decentralized Final Selection)**
- The agent receives candidate ads with relevance scores
- Agent applies its own judgment:
  - Does this match what the user actually wants?
  - Is the price/product genuinely useful?
  - Does it fit naturally in the response?
- Agent may show 0, 1, or multiple ads based on context
- Agent has full user context that it NEVER shares with the MCP

**Privacy benefit**: The MCP never receives PII or full user context. It receives only an anonymized intent query (keywords + category + geo). The agent holds all sensitive user data locally.

---

## 6. Pricing Models

Advertisers choose their billing model per campaign:

| Model | Event | When Charged | Status |
|-------|-------|-------------|--------|
| **CPM** | Impression | Ad shown in agent response ($bid/1000) | ✅ Implemented |
| **CPC** | Click | User clicks the ad link | ✅ Implemented |
| **CPA** | Conversion | User completes target action | ✅ Implemented |
| **Hybrid** | Mixed | Combine models (e.g., CPC + CPA bonus) | Not implemented |

### Budget Controls ✅ Implemented
- **Campaign total budget**: Maximum lifetime spend
- **Daily budget cap**: Field exists in schema (enforcement in Phase 2)
- **Auto-pause**: When budget exhausted → campaign pauses automatically
- **Atomic billing**: Event insert + stats update + spend update in SQLite transaction

### Minimum Budget
- MVP: No minimum (attract early advertisers)

---

## 7. Targeting Capabilities

### MVP (Phase 1) ✅ Implemented
- **Keywords**: Exact match (+0.30) and partial match (+0.15) against user intent
- **Categories**: Category match (+0.20)
- **Geographic**: Country-level match (+0.10), "ALL" for global
- **Language**: Language match (+0.05)

### Future (Phase 2+) — See Issues
- **Budget pacing**: Even spend distribution (#43)
- **Fraud detection**: Anomaly heuristics (#47)
- **Dashboard REST API**: Advertiser/developer analytics (#40)
- **Frequency capping**: Max impressions per user per time period (#42)
- **A/B testing**: Ad creative variants (#41)
- **Audience segments**: Interest-based targeting (#44)
- **Multi-language creatives**: Localized ad text (#46)
- **Webhook notifications**: Campaign milestone alerts (#45)

---

## 8. Ad Guidelines & Disclosure

### For Consumer Agents ✅ Implemented via `get_ad_guidelines`
The tool returns 7 rules:

1. **Disclosure**: Ads MUST be clearly marked as "sponsored", "ad", or equivalent
2. **Natural integration**: Ads should fit contextually in the response, not feel forced
3. **Relevance threshold**: Only show ads above a minimum relevance score
4. **User benefit**: The ad should genuinely add value (better price, relevant alternative)
5. **Frequency**: Don't overwhelm — max 1-2 ads per response
6. **Opt-out**: Users should be able to say "no ads" and the bot should respect it
7. **Honesty**: Never misrepresent sponsored content as organic results

### For Advertisers
- Ads must be truthful and not misleading
- Link must go to a legitimate, relevant landing page
- No prohibited categories (TBD: define list)
- Creative must be appropriate for all audiences (initially)

---

## 9. Verification & Anti-Fraud (Open Problem)

This is the hardest technical challenge. In traditional ads, the platform controls the rendering surface. Here, we trust the agent to report events honestly.

### Threat Model
| Threat | Description | Severity |
|--------|------------|----------|
| **Fake impressions** | Bot reports showing an ad it never showed | High |
| **Fake clicks** | Bot reports clicks that never happened | High |
| **Fake conversions** | Bot reports conversions that didn't occur | Critical |
| **Click farming** | Bot developer creates fake users to generate events | High |
| **Ad suppression** | Bot queries ads but never shows them (free intelligence) | Medium |

### Current Mitigations (MVP)
- ✅ Rate limiting per API key per tool (sliding window)
- ✅ API key authentication (SHA-256 hashed, role-based access control)
- ✅ Trust-based event reporting
- See #47 for Phase 2 anomaly detection heuristics

### Future Mitigations
- Statistical anomaly detection (#47)
- Conversation hash verification
- Clickthrough redirect verification
- Conversion postback API
- Cryptographic attestation

---

## 10. Technical Architecture

### Actual File Structure

```
agentic-ads/
├── src/
│   ├── server.ts              # MCP server, tool registration, transport startup
│   ├── tools/
│   │   ├── advertiser/        # Stub files (tools defined inline in server.ts)
│   │   │   ├── create-campaign.ts
│   │   │   ├── create-ad.ts
│   │   │   └── get-analytics.ts
│   │   └── consumer/
│   │       ├── get-guidelines.ts  # Ad guidelines implementation
│   │       ├── report-event.ts
│   │       └── search-ads.ts
│   ├── matching/              # Ad matching & ranking engine
│   │   ├── index.ts           # Re-exports
│   │   ├── keyword-matcher.ts # matchAds, extractKeywords
│   │   └── ranker.ts          # rankAds formula
│   ├── db/
│   │   ├── schema.ts          # TypeScript interfaces + SQL DDL
│   │   └── index.ts           # CRUD operations
│   └── auth/
│       ├── middleware.ts       # API key auth (generate, hash, authenticate)
│       └── rate-limiter.ts    # Sliding window rate limiter
├── tests/                     # 270 tests across 13 files
├── scripts/
│   ├── seed.ts                # Demo data (Adidas, Spotify, TestBot)
│   └── smoke-test.ts          # MCP protocol smoke test
├── openclaw-skill/            # OpenClaw integration
│   ├── SKILL.md               # Agent instructions (YAML frontmatter)
│   ├── mcp-config.example.json
│   └── README.md              # Setup guide
├── docs/
│   ├── PRD.md                 # This document
│   └── research/
├── bulloak.md                 # Behavioral specification (SOURCE OF TRUTH)
├── CLAUDE.md                  # Development guidelines
├── .github/workflows/ci.yml   # GitHub Actions CI
├── package.json
└── tsconfig.json
```

### Data Model (Implemented)

```
Advertiser: id, name, company?, email?, created_at
Developer:  id, name, email?, reputation_score (default 1.0), created_at
Campaign:   id, advertiser_id(FK), name, objective, status, total_budget,
            daily_budget?, spent, pricing_model, bid_amount, start_date?,
            end_date?, created_at
Ad:         id, campaign_id(FK), creative_text, link_url, keywords(JSON),
            categories(JSON), geo, language, status, quality_score,
            impressions, clicks, conversions, spend, created_at
Event:      id, ad_id(FK), developer_id(FK), event_type, amount_charged,
            developer_revenue, platform_revenue, context_hash?, metadata(JSON),
            created_at
ApiKey:     id, key_hash(unique, SHA-256), entity_type, entity_id, created_at
```

### Transport & Hosting
- ✅ **Streamable HTTP** for remote access (`--http` flag, configurable port)
- ✅ **stdio** for local development and testing (`--stdio` flag)
- **Target deployment**: Self-hosted VPS (Railway, Fly.io, etc.)
- SQLite with WAL mode for concurrent reads

### Authentication ✅ Implemented
- **API keys**: Format `aa_adv_<64hex>` / `aa_dev_<64hex>`, SHA-256 hashed in DB
- **Role-based access**: Advertiser tools require `aa_adv_*`, consumer tools require `aa_dev_*`
- **Rate limiting**: Per-key, per-tool sliding window limits:
  - search_ads: 60/min, report_event: 120/min
  - create_campaign: 10/min, create_ad: 10/min
  - update_campaign: 20/min, list_campaigns: 30/min
  - get_campaign_analytics: 30/min, get_ad_guidelines: 60/min

---

## 11. OpenClaw Integration ✅ Implemented

### OpenClaw Skill
The `openclaw-skill/` directory contains everything needed:
- `SKILL.md`: Agent instructions with YAML frontmatter (name, version, env vars, tools)
- `mcp-config.example.json`: MCP adapter configuration
- `README.md`: Quick Start guide with setup steps

### Recommended Agent Behavior
The skill instructs the OpenClaw agent to:
1. After gathering user intent for a purchase/recommendation request
2. Call `search_ads` with extracted keywords, category, and context
3. Evaluate returned ads against user preferences
4. If an ad is relevant and adds value, include it in the response
5. Always disclose sponsored content ("Sponsored")
6. Report impression events for shown ads
7. Track and report clicks/conversions when possible
8. Respect user opt-out preferences ("no ads" / "stop showing ads")

---

## 12. Phases & Milestones

### Phase 0: Foundation ✅ Complete
- [x] Research traditional ad models
- [x] Research OpenClaw ecosystem
- [x] Research MCP protocol and agentic advertising landscape
- [x] PRD (this document)
- [x] API schemas (Zod validation in server.ts)
- [x] Set up project infrastructure (repo, CI, DB)

### Phase 1: MVP ✅ Complete
- [x] MCP server with 8 tools (create_campaign, create_ad, update_campaign, list_campaigns, get_campaign_analytics, search_ads, report_event, get_ad_guidelines)
- [x] Basic keyword matching (exact + partial + category + geo + language)
- [x] Ad ranking (relevance² × bidFactor × quality_score)
- [x] SQLite database (WAL mode, foreign keys, indices)
- [x] Budget tracking with atomic transactions + auto-pause
- [x] Pricing models: CPC, CPM, CPA
- [x] Revenue split: 70% developer / 30% platform
- [x] API key authentication (SHA-256 hashed)
- [x] Rate limiting (sliding window, per-key per-tool)
- [x] Dual transport: stdio + Streamable HTTP
- [x] OpenClaw skill for consumer bots
- [x] GitHub Actions CI
- [x] 270 tests across 13 files, behavioral spec in bulloak.md
- [ ] ~~Basic dashboard~~ → Moved to Phase 2 (#40)
- **Goal**: One advertiser, one bot, end-to-end flow working ✅

### Phase 2: Quality & Scale — GitHub Issues
- [ ] Dashboard REST API (#40) — priority
- [ ] Fraud detection heuristics (#47)
- [ ] Budget pacing (#43)
- [ ] Frequency capping (#42)
- [ ] Multi-language ad creatives (#46)
- [ ] Daily budget enforcement
- [ ] Semantic matching (embeddings-based)
- [ ] Clickthrough redirect verification
- [ ] Conversion postback API

### Phase 3: Growth
- [ ] A/B testing for ad creatives (#41)
- [ ] Webhook notifications (#45)
- [ ] Audience segments (#44)
- [ ] Ad review/moderation system
- [ ] Developer reputation system
- [ ] Stripe-based payouts to developers
- [ ] Advertiser self-service onboarding

### Phase 4: Advanced
- [ ] Cryptographic attestation for events
- [ ] Real-time bidding between multiple ads
- [ ] Multi-platform support (beyond OpenClaw)
- [ ] AdCP/A2A protocol compatibility
- [ ] Agent-to-agent negotiation

---

## 13. Competitive Landscape & Positioning

| Player | What they do | How we differ |
|--------|-------------|---------------|
| **Google AdSense** | Ads on websites | We do ads in agent conversations |
| **PubMatic AgenticOS** | Agent-to-agent between DSPs/SSPs | We connect directly to consumer agents |
| **AAO / AdCP** | Open protocol for agentic ads | We're the server implementation, not just a protocol |
| **Perplexity Shopping** | Product recs with purchase | No ad marketplace, no developer revenue |
| **ChatGPT Operator** | Autonomous shopping | No ad monetization for third-party developers |
| **Google UCP** | Commerce protocol for agents | Commerce protocol, not an ad marketplace |

**Our unique position**: The first MCP server that creates an ad marketplace specifically for AI agent developers. We monetize the conversation layer between brands and users through the agents that serve them.

---

## 14. Open Questions

1. **Legal/Regulatory**: Do agent-embedded ads need FTC disclosure? Likely yes — native advertising rules apply. Need legal review.
2. **User trust**: How do we prevent users from losing trust in their agent if it shows too many ads? Agent guidelines are key. ✅ `get_ad_guidelines` enforces max 1-2 ads + opt-out.
3. **Advertiser trust**: How do we prove ROI to advertisers in Phase 1 without strong verification? Start with trusted partners. ✅ `get_campaign_analytics` provides full metrics.
4. **Pricing calibration**: What should initial CPM/CPC/CPA rates be? Start low, let market discover prices.
5. **Deploy target**: Self-hosted VPS (decided: Railway/Fly.io with SQLite).
6. **Cross-platform identity**: How to track conversions across agent → website → purchase? UTM params + conversion postback API (Phase 2).
7. **Agent autonomy**: Should the agent be allowed to NOT show ads if it judges them irrelevant, even if the MCP returned them? Yes — agent autonomy is a feature, not a bug. ✅ Documented in guidelines.
8. **Hybrid pricing**: Deferred to Phase 2. CPC/CPM/CPA cover 95% of use cases.

---

## 15. Success Metrics

### MVP Success ✅ Technical complete
- [x] End-to-end flow: campaign creation → ad creation → search → impression → click → revenue recorded
- [x] Analytics visible to advertisers
- [x] 270 tests, 0 failures
- [ ] 1 real advertiser running a campaign (pending deployment)
- [ ] 1 real OpenClaw bot serving ads (pending deployment)

### Product-Market Fit Signals
- >10 advertisers actively spending
- >50 bot developers earning revenue
- CTR >2% (comparable to search ads)
- Advertiser retention >60% month-over-month
- Bot developer NPS >40

### Scale Metrics
- Monthly ad spend through platform
- Number of active campaigns
- Number of active bots serving ads
- Revenue per bot developer per month
- Platform take rate and profitability
