# Agentic Ads — Product Requirements Document

**Version**: 0.1 (Draft)
**Date**: 2026-02-06
**Status**: Research / Pre-development

---

## 1. Executive Summary

Agentic Ads is an MCP (Model Context Protocol) server that creates a two-sided advertising marketplace for AI agents. Advertisers publish ads through MCP tools, and consumer-facing AI agents query for relevant ads to show their users contextually. When an ad is consumed (viewed, clicked, or leads to a conversion), the bot developer earns a commission from the advertiser's budget.

**Initial target platform**: OpenClaw (145K+ GitHub stars, open-source AI agent with messaging integrations and nascent MCP support).

**Market context**: "Agentic advertising" is emerging rapidly. PubMatic launched AgenticOS, IAB Tech Lab published the ARTF standard, and the Agentic Advertising Organization (AAO) published AdCP on top of MCP. Meanwhile, Perplexity and ChatGPT are pioneering agentic commerce. McKinsey projects $1-5T in agentic commerce by 2030. However, no one has built the intermediary MCP that connects advertiser agents to consumer agents in an ad-auction model — this is our whitespace.

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

### Advertiser Tools
| Tool | Description |
|------|-------------|
| `create_campaign` | Create an ad campaign with budget, objective, and pricing model |
| `create_ad` | Create an ad unit within a campaign (creative, targeting, link) |
| `update_campaign` | Modify campaign parameters (budget, status, targeting) |
| `get_campaign_analytics` | Retrieve performance metrics (impressions, clicks, conversions, spend) |
| `list_campaigns` | List all campaigns with summary stats |
| `pause_campaign` / `resume_campaign` | Control campaign delivery |

### Consumer Agent Tools
| Tool | Description |
|------|-------------|
| `search_ads` | Query for ads matching a user intent/context (returns ranked results) |
| `report_event` | Report an ad event (impression, click, conversion) |
| `get_ad_guidelines` | Get formatting guidelines for how to present ads naturally |

### Internal/Admin Tools (future)
| Tool | Description |
|------|-------------|
| `get_platform_analytics` | Overall marketplace health metrics |
| `manage_developer_account` | Developer registration, payout config |
| `review_ad` | Ad moderation and approval |

---

## 4. End-to-End Flow

### 4.1 Advertiser Flow

```
1. Adidas creates an account on Agentic Ads platform
2. Adidas creates a campaign:
   - Budget: $100
   - Objective: "conversions" (drive purchases)
   - Pricing: CPC $0.50 + CPA $5.00 (dual model)
   - Daily budget cap: $10/day
3. Adidas creates an ad within the campaign:
   - Creative: "Adidas Ultraboost 24 — Now 30% off! Free shipping."
   - Link: https://adidas.com/ultraboost?utm_source=agentic_ads&utm_campaign=123
   - Targeting:
     - Keywords: ["running shoes", "sneakers", "athletic shoes", "ultraboost"]
     - Categories: ["footwear", "sports", "running"]
     - Context: language=en, geo=US
     - Price range: $100-$200 (product price context)
4. Ad goes through review → approved → active
5. Budget decrements as events occur
6. Adidas monitors analytics via `get_campaign_analytics`
```

### 4.2 Consumer Agent Flow

```
1. Alice messages her OpenClaw bot: "I want to buy running shoes, love Nike, budget around $150"
2. Bot gathers preferences: size 8, women's, neutral color, road running
3. Bot searches the web for options (existing OpenClaw behavior)
4. Bot ALSO calls `search_ads` on Agentic Ads MCP:
   - query: "women's running shoes"
   - context: {
       keywords: ["running shoes", "nike", "women"],
       category: "footwear",
       price_range: { min: 100, max: 200 },
       language: "en",
       geo: "US"
     }
5. MCP returns ranked ads:
   [
     { ad_id: "abc", brand: "Adidas", title: "Ultraboost 24 — 30% off!",
       link: "https://...", relevance_score: 0.87, pricing: "cpc",
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
    - Platform (Agentic Ads): ~30% of event cost
    - Bot Developer: ~70% of event cost
    ↓
Example: CPC $0.50 click
    - Platform gets: $0.15
    - Bot developer gets: $0.35
    ↓
Payouts aggregate and settle periodically
```

**Revenue share**: Initial target ~70/30 in favor of bot developers (comparable to AdSense's 68% to publishers). Open to iteration based on market dynamics.

---

## 5. Matching & Ranking Algorithm

### Hybrid Approach: MCP Pre-filters, Agent Decides

The matching happens in two stages:

**Stage 1: MCP Server (Centralized Pre-filtering)**
- Receives query with keywords, category, and context signals
- Filters by: keyword relevance, category match, geo, language, budget availability, campaign status
- Ranks by a score combining:
  - **Relevance**: keyword/category match to query (semantic similarity)
  - **Bid**: how much the advertiser is willing to pay
  - **Quality**: historical CTR, conversion rate of the ad
  - **Formula**: `Score = Relevance × (Bid × Quality_Factor)`
- Returns top N candidates (e.g., top 5)

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

| Model | Event | When Charged | Typical Range |
|-------|-------|-------------|---------------|
| **CPM** | Impression | Ad shown in agent response | $5-$50 per 1000 |
| **CPC** | Click | User clicks the ad link | $0.20-$5.00 |
| **CPA** | Conversion | User completes target action | $5-$100+ |
| **Hybrid** | Mixed | Combine models (e.g., CPC + CPA bonus) | Varies |

### Budget Controls
- **Campaign total budget**: Maximum lifetime spend
- **Daily budget cap**: Maximum spend per day
- **Bid cap**: Maximum per-event cost
- When budget exhausted → campaign pauses automatically

### Minimum Budget
- MVP: No minimum (attract early advertisers)
- Future: Consider minimums per pricing model

---

## 7. Targeting Capabilities

### MVP (Phase 1)
- **Keywords**: Exact and broad match against user intent
- **Categories**: Predefined product/service taxonomy
- **Geographic**: Country-level (from agent-provided context)
- **Language**: Language of the conversation

### Future (Phase 2+)
- **Contextual signals**: Time of day, conversation topic, user sentiment
- **Interest profiles**: Anonymized, agent-generated interest vectors
- **Negative targeting**: Exclude categories/keywords
- **Frequency capping**: Max impressions per user per time period
- **Competitor exclusions**: Don't show with competing brands

---

## 8. Ad Guidelines & Disclosure

### For Consumer Agents
The `get_ad_guidelines` tool returns instructions for how agents should present ads:

1. **Disclosure**: Ads MUST be clearly marked as "sponsored", "ad", or equivalent
2. **Natural integration**: Ads should fit contextually in the response, not feel forced
3. **Relevance threshold**: Only show ads above a minimum relevance score
4. **User benefit**: The ad should genuinely add value (better price, relevant alternative)
5. **Frequency**: Don't overwhelm — max 1-2 ads per response
6. **Opt-out**: Users should be able to say "no ads" and the bot should respect it

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

### Mitigation Strategies (Phased)

**Phase 1: Trust + Heuristics (MVP)**
- Trust agent-reported events initially
- Statistical anomaly detection: flag accounts with abnormal CTR, conversion rates
- Rate limiting per agent/developer
- Minimum reputation threshold to access high-value ads
- Manual review for top earners

**Phase 2: Verification Layer**
- **Conversation hash**: Agent provides a hash of the message containing the ad (proves the ad text was in a message, without revealing content)
- **Clickthrough verification**: Redirect links through our domain to verify clicks server-side
- **Conversion postback**: Advertiser's server reports conversions directly to us (like Facebook CAPI)
- **User confirmation sampling**: Randomly ask users "did you see a sponsored suggestion?" (via agent)

**Phase 3: Cryptographic Attestation (Future)**
- Signed attestations from the agent runtime
- Integration with Visa's Trusted Agent Protocol or similar
- Zero-knowledge proofs for impression verification
- Reputation scoring based on verified history

### Inspiration from Traditional Ads
- Google filters ~11.5% of clicks as invalid
- ~20% of all digital ad traffic is fraudulent globally
- Our advantage: agent-mediated interactions may actually have LESS fraud than web (no bots clicking, fewer automated scripts), but the agent itself is the trust boundary

---

## 10. Technical Architecture

### MCP Server Design

```
agentic-ads/
├── src/
│   ├── server.ts              # MCP server entry point
│   ├── tools/
│   │   ├── advertiser/        # Advertiser-facing tools
│   │   │   ├── create-campaign.ts
│   │   │   ├── create-ad.ts
│   │   │   ├── update-campaign.ts
│   │   │   └── get-analytics.ts
│   │   └── consumer/          # Consumer agent-facing tools
│   │       ├── search-ads.ts
│   │       ├── report-event.ts
│   │       └── get-guidelines.ts
│   ├── matching/              # Ad matching & ranking engine
│   │   ├── ranker.ts
│   │   ├── keyword-matcher.ts
│   │   └── relevance-scorer.ts
│   ├── billing/               # Budget management & billing
│   │   ├── budget-manager.ts
│   │   ├── event-processor.ts
│   │   └── revenue-split.ts
│   ├── fraud/                 # Anti-fraud heuristics
│   │   ├── anomaly-detector.ts
│   │   └── rate-limiter.ts
│   ├── db/                    # Database layer
│   │   ├── schema.ts
│   │   └── migrations/
│   └── auth/                  # OAuth 2.1 / API key auth
│       └── middleware.ts
├── tests/
├── docs/
├── CLAUDE.md
├── package.json
└── tsconfig.json
```

### Data Model (Core Entities)

```
Developer
  - id, name, email, payout_config, reputation_score

Advertiser
  - id, name, company, billing_info

Campaign
  - id, advertiser_id, name, objective, status
  - total_budget, daily_budget, spent, pricing_model
  - start_date, end_date

Ad
  - id, campaign_id, creative_text, link_url
  - targeting: { keywords[], categories[], geo, language }
  - bid_amount, status, quality_score
  - stats: { impressions, clicks, conversions, spend }

Event
  - id, ad_id, developer_id, event_type (impression|click|conversion)
  - timestamp, context_hash, verified, amount_charged

Payout
  - id, developer_id, period, total_earned, status
```

### Transport & Hosting
- **Streamable HTTP** for remote access (consumer agents connect over internet)
- **stdio** for local development and testing
- Host on Cloudflare Workers (serverless, global edge, native MCP support with billing via Stripe)
- Alternative: self-hosted Node.js server

### Authentication
- **Advertisers**: API key or OAuth 2.1 for campaign management
- **Consumer Agents**: API key per developer (identifies which bot is querying)
- **Rate limiting**: Per-key, per-tool limits

---

## 11. OpenClaw Integration

### How Consumer Bots Connect

**Option A: Via openclaw-mcp-adapter plugin (available now)**
- Install: `openclaw plugins install openclaw-mcp-adapter`
- Configure Agentic Ads as an MCP server in the adapter config
- All tools become native agent tools automatically

**Option B: Via OpenClaw skill (simpler, works today)**
- Create an Agentic Ads skill that wraps HTTP calls to our MCP server
- Skill handles auth, query construction, response parsing
- Lower barrier to entry, no MCP adapter needed

**Option C: Native MCP (future)**
- When OpenClaw adds native MCP support, direct connection

### Recommended Agent Behavior (Skill/Prompt)

The skill should instruct the OpenClaw agent to:

1. After gathering user intent for a purchase/recommendation request
2. Call `search_ads` with extracted keywords, category, and context
3. Evaluate returned ads against user preferences
4. If an ad is relevant and adds value, include it in the response
5. Always disclose sponsored content
6. Report impression events for shown ads
7. Track and report clicks/conversions when possible
8. Respect user opt-out preferences

---

## 12. Phases & Milestones

### Phase 0: Foundation (Current)
- [x] Research traditional ad models
- [x] Research OpenClaw ecosystem
- [x] Research MCP protocol and agentic advertising landscape
- [x] PRD (this document)
- [ ] Define detailed API schemas (JSON Schema for each tool)
- [ ] Set up project infrastructure (repo, CI, DB)

### Phase 1: MVP
- [ ] MCP server with core tools (`create_campaign`, `create_ad`, `search_ads`, `report_event`)
- [ ] Basic keyword matching (no ML, just text similarity)
- [ ] SQLite database (for simplicity)
- [ ] Simple budget tracking (decrement on event)
- [ ] OpenClaw skill for consumer bots
- [ ] Basic dashboard (CLI or simple web UI)
- [ ] Trust-based event reporting
- **Goal**: One advertiser, one bot, end-to-end flow working

### Phase 2: Quality & Scale
- [ ] Semantic matching (embeddings-based relevance scoring)
- [ ] PostgreSQL migration
- [ ] Clickthrough redirect verification
- [ ] Conversion postback API
- [ ] Anomaly detection heuristics
- [ ] Multiple pricing models (CPM, CPC, CPA, hybrid)
- [ ] Developer dashboard with earnings
- [ ] Advertiser dashboard with analytics

### Phase 3: Growth
- [ ] Ad review/moderation system
- [ ] Developer reputation system
- [ ] Category taxonomy expansion
- [ ] Frequency capping
- [ ] A/B testing for ad creatives
- [ ] Stripe-based payouts to developers
- [ ] Advertiser self-service onboarding

### Phase 4: Advanced
- [ ] Cryptographic attestation for events
- [ ] Interest-based targeting (privacy-preserving)
- [ ] Real-time bidding between multiple ads
- [ ] Multi-platform support (beyond OpenClaw)
- [ ] AdCP/A2A protocol compatibility
- [ ] Agent-to-agent negotiation (advertiser agent ↔ consumer agent)

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
2. **User trust**: How do we prevent users from losing trust in their agent if it shows too many ads? Agent guidelines are key.
3. **Advertiser trust**: How do we prove ROI to advertisers in Phase 1 without strong verification? Start with trusted partners.
4. **Pricing calibration**: What should initial CPM/CPC/CPA rates be? Start low, let market discover prices.
5. **MCP hosting**: Cloudflare Workers vs self-hosted? Cloudflare has native MCP + Stripe billing support.
6. **Cross-platform identity**: How to track conversions across agent → website → purchase? UTM params + conversion postback API.
7. **Agent autonomy**: Should the agent be allowed to NOT show ads if it judges them irrelevant, even if the MCP returned them? Yes — agent autonomy is a feature, not a bug.
8. **Competitor analysis**: Should we build AdCP compatibility from the start? Monitor but don't over-invest yet.

---

## 15. Success Metrics

### MVP Success
- 1 advertiser running a campaign
- 1 OpenClaw bot serving ads
- End-to-end flow: ad creation → impression → click → revenue recorded
- Basic analytics visible to both sides

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
