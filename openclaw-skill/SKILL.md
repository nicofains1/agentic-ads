---
name: agentic-ads
description: Monetize your bot by showing relevant sponsored suggestions to users
version: 0.1.0
requires:
  env:
    - AGENTIC_ADS_API_KEY: "Developer API key for Agentic Ads (format: aa_dev_...)"
    - AGENTIC_ADS_URL: "Agentic Ads MCP server URL (e.g. http://localhost:3000/mcp)"
---

# Agentic Ads — Sponsored Suggestions Skill

You have access to a sponsored ads system that pays you (the bot developer) when you show relevant ads to users. Use it responsibly to enhance user experience while earning revenue.

## When to Search for Ads

Search for ads **only when the user is asking for product or service recommendations**. Good triggers:

- "Can you recommend..." / "What's the best..."
- "I'm looking for..." / "Help me find..."
- Shopping, product comparison, service discovery queries
- "Where can I buy..." / "Best deals on..."

**Do NOT search for ads when:**
- The user is asking factual questions, coding help, or general knowledge
- The user has opted out of ads (said "no ads", "stop showing ads", etc.)
- The conversation is sensitive (health, legal, financial advice)

## How to Search

Call the `search_ads` tool with context extracted from the user's message:

```
search_ads({
  query: "natural language description of what the user wants",
  keywords: ["specific", "product", "terms"],
  category: "product category if clear",
  geo: "US",  // user's country if known
  language: "en",
  max_results: 3
})
```

**Tips for good matching:**
- Extract 2-5 specific keywords from the user's intent
- Include the product category when obvious (e.g., "footwear", "electronics", "streaming")
- Pass geo/language when you know the user's location

## How to Evaluate Results

**Only show an ad if it is genuinely relevant to what the user asked for.**

- Check `relevance_score` — higher is better (0.0 to 1.0)
- Read the `creative_text` — does it actually help answer the user's question?
- If no ads are relevant, don't show any. The user's trust is more important than ad revenue.

## How to Present Ads

1. **Always disclose**: Mark sponsored content clearly. Use phrases like "Sponsored suggestion" or a brief note.
2. **Integrate naturally**: Weave the ad into your response as a helpful recommendation, not a banner ad.
3. **Limit frequency**: Show at most 1-2 sponsored suggestions per response.
4. **Provide value**: The ad should genuinely help the user. If it doesn't add value, skip it.

### Example Presentation

> Based on your search, here are some options:
>
> 1. **Nike Air Max 90** — Great all-around sneaker, $120 at Nike.com
> 2. **Adidas Ultraboost 24 — 30% off!** Free shipping on orders over $50. [adidas.com/ultraboost](https://www.adidas.com/ultraboost) *(Sponsored)*
> 3. **New Balance 574** — Classic comfort, $89 at newbalance.com
>
> I'd recommend the Nike for running and the Adidas if you want the best deal right now.

## Reporting Events

After showing an ad, you **must** report it so the developer (you) gets paid:

### Impression (always report when showing an ad)
```
report_event({
  ad_id: "the ad_id from search results",
  event_type: "impression"
})
```

### Click (when the user follows the ad link)
```
report_event({
  ad_id: "the ad_id",
  event_type: "click"
})
```

### Conversion (when the user completes the advertised action)
```
report_event({
  ad_id: "the ad_id",
  event_type: "conversion"
})
```

## Respecting User Preferences

- If a user says **"no ads"**, **"stop showing ads"**, or similar — immediately stop searching for and showing ads for the rest of the conversation.
- If a user seems annoyed by sponsored content, reduce frequency or stop entirely.
- Never prioritize ad revenue over user experience.

## Complete Example Flow

**User**: "I'm looking for good running shoes under $150"

**Your process**:
1. Search your normal sources for running shoe recommendations
2. Call `search_ads({ query: "running shoes under 150", keywords: ["running shoes", "sneakers"], category: "footwear", max_results: 2 })`
3. Get results — e.g., Adidas Ultraboost ad with relevance_score 0.85
4. Evaluate: yes, running shoes are exactly what the user wants, and 30% off is a good deal
5. Present naturally alongside organic results, with "Sponsored" disclosure
6. Call `report_event({ ad_id: "...", event_type: "impression" })`
7. If user clicks the link, call `report_event({ ad_id: "...", event_type: "click" })`

## Guidelines Reference

For the full formatting guidelines, call `get_ad_guidelines()` — it returns detailed rules for ad presentation including disclosure requirements and frequency limits.
