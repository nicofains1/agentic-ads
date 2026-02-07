# Traditional Digital Advertising: End-to-End Flow

Reference document for understanding how digital ads work today, to inform the design of Agentic Ads.

---

## 1. The Players

| Role | What they do | Examples |
|------|-------------|----------|
| **Advertiser** | Pays to show ads | Adidas, Nike, Coca-Cola |
| **Publisher** | Owns the surface where ads appear | Websites, apps, YouTube channels |
| **Ad Platform** | Intermediary that runs the auction | Google Ads, Meta Ads |
| **Ad Exchange** | Neutral marketplace for RTB | Google AdX, OpenX, Xandr |
| **DSP** | Advertiser's buying console | The Trade Desk, DV360, Amazon DSP |
| **SSP** | Publisher's selling console | PubMatic, Magnite, Index Exchange |
| **Verification Vendor** | Validates ads were seen, brand-safe | DoubleVerify, IAS |

**In Agentic Ads:** The "publisher" is the bot/agent developer. The "ad platform" is our MCP server. There is no DSP/SSP initially.

---

## 2. Campaign Structure (Google Ads Model)

```
Account
└── Campaign (budget, bidding strategy, geo, schedule)
    └── Ad Group (keywords/targeting + ads)
        └── Ad (the creative: text, image, video)
```

- **Campaign** = strategic level (what, how much, where)
- **Ad Group** = tactical level (who, which keywords)
- **Ad** = creative level (what the user sees)

---

## 3. Pricing Models

### CPC (Cost Per Click)
- Advertiser pays when user clicks
- Google Search avg: $2.69-$5.26
- Facebook avg: $1.11
- Range: $0.14 (marketplaces) to $8.58 (legal)

### CPM (Cost Per Mille / 1000 Impressions)
- Advertiser pays per 1,000 views
- Google Display avg: ~$17.80
- Facebook avg: ~$19.81
- CTV/Video: $25-$65+

### CPA (Cost Per Action/Acquisition)
- Advertiser pays when user completes an action (purchase, signup)
- Google Search avg: $48.96
- Facebook Lead avg: $27.66
- Range: $15 (e-commerce) to $116+ (B2B)

### CPV (Cost Per View)
- Video-specific: pay when user watches 15-30 seconds
- YouTube: $0.01-$0.30
- Meta ThruPlay: $0.01-$0.10

### Key Ratios
- **CTR** (Click-Through Rate): Google Search 6.66%, Display 0.46%, Facebook ~1.5-2.5%
- **CVR** (Conversion Rate): Google Search 4.4%, Facebook 8.95%
- **ROAS** (Return on Ad Spend): Facebook avg 2.79x, Google 2x-8x

---

## 4. The Auction (How Ads Are Ranked)

Every impression triggers a real-time auction (~100-300ms):

### Google's Formula
```
Ad Rank = Bid × Quality Score + Extensions Impact + Context Signals
```

**Quality Score** (1-10):
- Expected CTR (will they click?)
- Ad Relevance (does it match intent?)
- Landing Page Experience (is the destination good?)

**Key insight:** A high Quality Score lowers CPC. A relevant ad wins over a high-bidding irrelevant one.

### Meta's Formula
```
Total Value = Bid × Estimated Action Rate × Ad Quality Score
```

Same principle: relevance and predicted user response matter as much as budget.

### Auction Types
- **Second-price** (legacy): Winner pays $0.01 above second-highest bid
- **First-price** (current standard): Winner pays what they bid. DSPs use "bid shading" to avoid overpaying

---

## 5. Targeting

### Keywords (Search)
- Exact match: [running shoes] → only "running shoes"
- Phrase match: "running shoes" → "best running shoes for men"
- Broad match: running shoes → "athletic footwear", "jogging sneakers"

### Audience Targeting
- **Affinity**: Lifestyle/interest-based (sports fans, foodies)
- **In-Market**: Actively researching/shopping (looking for shoes now)
- **Custom Segments**: Based on URLs, apps, search history
- **Remarketing**: People who already visited your site
- **Lookalike/Similar**: Find new people who resemble your customers
- **Demographics**: Age, gender, income, location, parental status

### 2025-2026 Trend
Platforms are moving toward **AI-driven broad targeting** (Meta's Advantage+, Google's Performance Max). The algorithm decides who to show ads to, using conversion signals rather than manual targeting.

---

## 6. Budget Management

- **Daily Budget**: Google can spend up to 2x daily budget on good days, but guarantees ≤30.4x monthly
- **Campaign Budget**: Fixed sum for a set duration, paced automatically
- **Spend Pacing**: Platform optimizes toward high-ROI times/days
- **Budget Controls**: Frequency caps, dayparting, geo-limits

---

## 7. Conversion Tracking & Attribution

### How Conversions Are Verified
1. **Pixel/Tag**: JavaScript snippet on advertiser's site fires when user completes action
2. **Server-Side API** (CAPI): Server-to-server, bypasses ad blockers. Meta CAPI + Pixel together is best practice
3. **Enhanced Conversions**: Hashed first-party data (email, phone) improves match rates by 10-30%
4. **Offline Conversions**: Upload CRM data to match offline sales to ad clicks

### Attribution Models
- **Last Click**: All credit to the final touchpoint (declining)
- **Data-Driven (DDA)**: ML distributes credit across all touchpoints (Google's default since Sept 2025)
- **Multi-Touch**: Linear, time-decay, U-shaped, W-shaped
- **Incrementality Testing**: Holdout experiments to measure true lift

### Attribution Windows
- Facebook default: 7-day click / 1-day view
- Google: varies by campaign type

---

## 8. Publisher Revenue Share

### Google AdSense Model
1. Buy-side platform takes ~15% of advertiser spend
2. AdSense keeps 20%, pays publisher **80%** of remaining
3. **Net result: publisher gets ~68% of original ad spend**

AdSense now pays publishers on CPM basis (per impression, not per click).

---

## 9. Fraud & Verification

### Scale of the Problem
- **Global IVT rate**: 20.64% of all impressions (105.7B analyzed)
- **Google Ads invalid clicks**: ~11.5% average
- **Paid search fraud**: 14-22% by industry
- **Global ad fraud cost**: $88B (2023) → projected $172B by 2028
- **Click spamming**: 76.6% of invalid traffic

### Viewability Standards (MRC/IAB)
- Display: 50% of pixels visible for ≥1 second
- Video: 50% of pixels visible for ≥2 seconds
- Large display (>242,500px): 30% visible for 1 second

### Anti-Fraud Layers
1. Real-time automated filters (IP, timestamp, behavior)
2. ML classifiers (neural networks, logistic regression)
3. Post-click analysis (retroactive credits)
4. Manual review (Ad Traffic Quality team)
5. Third-party tools (ClickCease, TrafficGuard, etc.)

---

## 10. Real-Time Bidding (RTB) Flow

```
User opens page
    ↓
Publisher's SSP creates bid request
(page context, ad size, device, user signals)
    ↓
Ad Exchange sends to multiple DSPs
    ↓
Each DSP evaluates:
- Targeting rules
- First-party data
- Conversion probability model
- Budget/pacing constraints
- Frequency caps
    ↓
DSPs return bids + creative
    ↓
Exchange runs first-price auction
    ↓
Winning creative served (< 300ms total)
    ↓
Impression tracked by SSP, DSP, verification vendors
```

### Deal Types
- **Open Auction**: Any buyer can bid
- **Private Marketplace (PMP)**: Invitation-only with floor prices
- **Programmatic Guaranteed**: Fixed price + volume, executed programmatically
- **Preferred Deal**: Fixed price to a specific buyer first

---

## 11. Mapping to Agentic Ads

| Traditional Concept | Agentic Ads Equivalent |
|---------------------|----------------------|
| Publisher website | Bot/Agent conversation |
| Ad impression | Ad shown in agent response |
| Click | User follows ad link |
| Conversion | User purchases / completes action |
| Quality Score | Ad relevance to user intent |
| Auction | MCP matching algorithm |
| Pixel/Tag tracking | Agent-reported events |
| SSP | Our MCP server (sell-side) |
| DSP | Advertiser dashboard/API |
| Ad Exchange | Our MCP server (marketplace) |
| AdSense rev share (68%) | Bot developer's commission |
| Fraud detection | Agent attestation system (TBD) |
| Viewability | Proof of impression (TBD) |
