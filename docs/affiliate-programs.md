# Developer Tool Affiliate Programs

Research for Issue #120 — Real affiliate campaigns in autoSeed.

**Workflow**: campaigns are seeded with direct product URLs. Once approved for an affiliate program, replace `link_url` with your personal affiliate link and redeploy.

---

## Confirmed Programs (open & free to join)

### 1. Railway
- **Program page**: https://railway.com/affiliate-program
- **Docs**: https://docs.railway.com/community/affiliate-program
- **Commission**: 15% of everything each referral spends for the first 12 months
- **Approval**: Instant — no review process, just get your link and share
- **Payout**: via Stripe
- **CPC estimate**: avg user ~$30/mo × 12 mo × 15% = **$54 per signup** → CPC $0.40 at 0.7% click→signup
- **Status**: ✅ Seed with direct URL, swap for affiliate link immediately
- **Affiliate link template**: `https://railway.com?referralCode=YOUR_CODE`

### 2. Vercel
- **Program page**: https://vercel.com/legal/affiliate-marketing-terms
- **Blog**: https://vercel.com/blog/vercel-partner-program-updates
- **Commission**: $10 per new paying signup + 5% recurring on subscription fees
- **Network**: Managed via Dub Technologies (dub.co)
- **Approval**: Standard application (typically < 1 week)
- **CPC estimate**: $10/signup at 2.5% click→signup = **$0.25 CPC**
- **Status**: ✅ Apply at vercel.com/partners, seed with direct URL for now

### 3. DigitalOcean
- **Affiliate program**: https://www.digitalocean.com/affiliates
- **Referral program** (simpler): https://www.digitalocean.com/referral-program
- **Commission**: 10% recurring for 12 months on paid accounts (affiliate); or $25 credit when referral spends $25 (referral)
- **Network**: CJ Affiliate (Commission Junction) / Impact
- **Approval**: CJ application, typically 1-3 days
- **CPC estimate**: avg $25/mo × 12 × 10% = **$30/signup** → CPC $0.30 at 1%
- **Status**: ✅ Apply via CJ, seed with direct URL for now
- **Referral bonus**: Also qualifies for $200 free credits for referred users (good ad hook)

### 4. Neon (Serverless Postgres)
- **Program page**: https://neon.com/programs/open-source
- **Commission**: $10 per referred user who signs up and spends $10+
- **Payout**: Monthly via GitHub Sponsors
- **Approval**: Application required, usually quick for open-source projects
- **CPC estimate**: $10/signup at 1% = **$0.10 CPC** (bidding $0.15 for margin)
- **Status**: ✅ Apply at neon.com/programs/open-source

---

## Promising Programs (apply to confirm details)

### 5. Supabase
- **Partner page**: https://supabase.com/partners
- **Partner request form**: https://forms.supabase.com/partner
- **Commission**: Not publicly listed — contact partnerships team
- **Community program**: SupaSquad advocate program (non-monetary)
- **Status**: 🔲 Apply via partner form; seed with direct URL
- **Contact**: partnerships@supabase.io

### 6. Clerk (Auth)
- **Creators program**: https://clerk.com/creators
- **Commission**: Flexible partnership — terms vary per creator/influencer
- **Eligibility**: Developer content creators (blog, YouTube, social)
- **Status**: 🔲 Apply via clerk.com/creators; seed with direct URL

### 7. Upstash
- **Website**: https://upstash.com
- **Commission**: No public affiliate program found (as of March 2026)
- **Status**: 🔲 Contact hello@upstash.com to ask about partnership
- **Note**: Strong product, seed with direct URL — worth reaching out

### 8. Sentry
- **Website**: https://sentry.io
- **Commission**: No public affiliate program found (as of March 2026)
- **Status**: 🔲 Contact partnerships@sentry.io; seed with direct URL
- **Note**: Developer-first, widely used — worth direct outreach

---

## Programs with No Affiliate Commission

| Product     | Status                                    |
|-------------|-------------------------------------------|
| Cloudflare  | No public affiliate — partner/reseller only |
| Render.com  | No affiliate program (feature requested) |
| PlanetScale | No affiliate program found               |
| Cursor AI   | No affiliate/referral program            |
| GitHub Copilot | No affiliate program                  |

---

## CPC Rationale

CPC is set based on: **estimated affiliate commission × click→signup conversion rate**

| Product      | Est. Commission | Conv. Rate | CPC Bid |
|--------------|----------------|-----------|---------|
| Railway      | $54/year       | 0.7%      | $0.40   |
| DigitalOcean | $30/year       | 1.0%      | $0.30   |
| Vercel       | $10 flat       | 2.5%      | $0.25   |
| Clerk        | ~$20 est.      | 1.2%      | $0.25   |
| Sentry       | ~$15 est.      | 1.5%      | $0.25   |
| Supabase     | ~$15 est.      | 1.3%      | $0.20   |
| Upstash      | ~$10 est.      | 1.5%      | $0.20   |
| Neon         | $10 flat       | 1.5%      | $0.15   |

---

## Next Steps

1. **Railway**: Sign up immediately at railway.com/affiliate-program — no approval needed
2. **Vercel**: Apply at vercel.com/partners
3. **DigitalOcean**: Apply via CJ Affiliate network
4. **Neon**: Apply at neon.com/programs/open-source
5. **Supabase / Clerk / Upstash / Sentry**: Email partnerships teams directly
6. Once affiliate links are received, update `link_url` in `autoSeed()` in `src/server.ts`
