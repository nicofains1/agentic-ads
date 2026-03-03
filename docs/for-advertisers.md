# Advertise on Agentic Ads

Agentic Ads is the first ad network built for AI agents. Your ads appear inside MCP tools used by developers — served contextually when users ask about topics your product solves.

## Why Advertise Here

- **High intent**: Users are actively asking about developer tools, hosting, databases, auth — not browsing passively
- **Contextual matching**: Your ad appears when the query matches your keywords (e.g., `search_ads("deploy my app")` → Railway/Vercel ad)
- **Attribution**: Every impression and click is tracked. Real-time analytics via MCP tools.
- **Low minimum spend**: $50 minimum campaign budget

## Pricing

| Model | Price | When you pay |
|-------|-------|--------------|
| **CPC** (Cost per Click) | $0.15–$0.50/click | Only when user clicks your ad link |
| **CPM** (Cost per 1K Impressions) | $1–$5/1K | On every 1,000 impressions served |
| **CPA** (Cost per Action) | $1–$5/action | On verified on-chain conversions only |

Publisher revenue share: 70% to publisher, 30% platform fee.

**Recommended starting bid**: $0.30/click CPC. This wins auctions in most developer tool categories.

## How to Create a Campaign

### Option A: Via MCP Tools (programmatic)

Use any MCP client connected to the Agentic Ads server:

```
POST https://agentic-ads-production.up.railway.app/mcp
```

**Step 1: Register as advertiser**

```bash
curl -X POST https://agentic-ads-production.up.railway.app/api/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Your Company Name",
    "email": "your@email.com",
    "role": "advertiser"
  }'
```

Response:
```json
{
  "advertiser_id": "adv_...",
  "api_key": "aa_adv_...",
  "mcp_url": "https://agentic-ads-production.up.railway.app/mcp"
}
```

**Step 2: Create a campaign** via the `create_campaign` MCP tool:

```json
{
  "name": "My Product — Developer Outreach",
  "objective": "conversions",
  "total_budget": 100.00,
  "daily_budget": 10.00,
  "pricing_model": "cpc",
  "bid_amount": 0.30,
  "start_date": "2026-03-01",
  "end_date": "2026-12-31"
}
```

**Step 3: Create an ad** via the `create_ad` MCP tool:

```json
{
  "campaign_id": "your_campaign_id",
  "creative_text": "Deploy your app in seconds with [Your Product]. Free tier available.",
  "link_url": "https://yourproduct.com/signup",
  "keywords": ["deploy", "hosting", "ci/cd", "docker", "backend"],
  "categories": ["hosting", "deployment"],
  "geo": "ALL",
  "language": "en"
}
```

### Option B: Contact Us

Email **hello@agentic-ads.com** with:
- Your product name and URL
- Target audience (e.g., "Node.js developers looking for hosting")
- Monthly budget
- Any existing affiliate/referral link

We'll set up the campaign for you within 24 hours.

## Writing Effective Ads

The `creative_text` field is your ad copy — keep it under 200 characters, factual, and developer-friendly.

**Good examples:**
- `"Serverless Postgres that scales to zero. Neon gives you DB branching for every Git branch. Free tier available."`
- `"Deploy any backend on Railway. Git push to deploy. Postgres + Redis included. $5/month hobby plan."`
- `"Add auth to your app in 5 minutes with Clerk. Social login, MFA, user management — free up to 10K MAU."`

**Bad examples:**
- `"BEST HOSTING EVER!!! CLICK NOW!!!"` — No exaggeration, no caps abuse
- `"Try our product"` — Too vague, won't match keywords
- `"Limited time offer — 50% off!"` — No time-pressure tactics

## Keyword Strategy

Keywords determine which queries trigger your ad. Think about what developers type when they need your product.

| Product Type | Recommended Keywords |
|---|---|
| Hosting / Deployment | `deploy`, `hosting`, `docker`, `backend hosting`, `heroku alternative`, `ci/cd` |
| Database | `postgres`, `database`, `serverless database`, `sql`, `mongodb alternative` |
| Authentication | `auth`, `authentication`, `login`, `sso`, `magic link`, `user management` |
| Monitoring | `error tracking`, `monitoring`, `observability`, `apm`, `debugging` |
| Caching / Queue | `redis`, `caching`, `rate limiting`, `message queue`, `background jobs` |

## Analytics

Track your campaign performance via the `get_campaign_analytics` MCP tool:

```bash
# Using MCP client with your advertiser API key:
# Call: get_campaign_analytics
# Returns: impressions, clicks, CTR, spend, conversions
```

Metrics available:
- **Impressions**: How many times your ad was shown
- **Clicks**: How many times users clicked your link
- **CTR**: Click-through rate (clicks / impressions)
- **Spend**: Total budget consumed so far
- **Conversions**: On-chain verified actions (CPA model only)

## Funding Your Campaign

Current payment options:

1. **USDC on Base/Ethereum**: Send USDC to our wallet address (provided after registration). Minimum $50 USDC.
2. **Email invoice**: Contact hello@agentic-ads.com for net-30 invoicing (requires $500+ budget commitment).

Your campaign budget is decremented in real-time as impressions/clicks occur. Campaigns pause automatically when budget is exhausted.

## Ad Policies

- **No deceptive claims**: Ad copy must be accurate and verifiable
- **Developer products only**: We serve developer-focused tools (hosting, databases, auth, monitoring, CI/CD, APIs)
- **No adult content, gambling, or regulated financial products**
- **Affiliate links welcome**: Direct affiliate/referral URLs are fine (we verify they're functional)
- **One ad per campaign minimum**: Each campaign needs at least one active ad to serve

## FAQ

**Q: How quickly do ads go live?**
A: Immediately after creation. There's no manual review for developer tool ads.

**Q: Can I target specific programming languages?**
A: Use keywords. E.g., `["nextjs", "react", "typescript"]` for frontend-focused queries.

**Q: What's the minimum budget?**
A: $50 total campaign budget. Daily budget minimum: $1/day.

**Q: Can I pause or stop my campaign?**
A: Yes, at any time via the `update_campaign` MCP tool (set `status: "paused"`).

**Q: What's the average CTR?**
A: Early data shows 2–8% CTR for well-targeted developer tool ads. Higher intent = higher CTR.

**Q: Do I need a crypto wallet?**
A: Only for USDC payments. Email invoicing is available for traditional billing.

## Get Started

1. Register: `POST /api/register` with `role: "advertiser"`
2. Create campaign: `create_campaign` MCP tool
3. Create ad: `create_ad` MCP tool
4. Fund: Send USDC or email us

Questions? Open an issue at [github.com/nicofains1/agentic-ads](https://github.com/nicofains1/agentic-ads/issues) or email hello@agentic-ads.com.
