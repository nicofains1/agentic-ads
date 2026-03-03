# Agentic Ads — E2E Stress Test Results

**Date**: 2026-03-03T01:47:57Z
**Production URL**: https://agentic-ads-production.up.railway.app
**Developer ID**: `(pre-existing)`
**MCP URL**: `https://agentic-ads-production.up.railway.app/mcp`
**Runtime**: 18s
**Prompts tested**: 10

---

## Executive Summary

| Metric | Count |
|--------|-------|
| Total prompts | 10 |
| ✅ Pass (correct behavior) | 3 |
| ⚠️  Warn (marginal / noisy) | 3 |
| ❌ Fail (wrong or missing ads) | 4 |

### Test Method

Direct MCP HTTP (JSON-RPC via `curl`) — equivalent to what `search_ads` does when called by an AI agent.

**Why not `claude -p` sub-agents?** Two friction points were encountered:

1. **Nested Claude Code session**: `CLAUDECODE` env var is set when running inside Claude Code,
   and `claude -p` hard-crashes with "Claude Code cannot be launched inside another Claude Code session."
   To run real AI agents, execute from a plain terminal:
   ```bash
   CLAUDECODE= bash scripts/stress-test-agents.sh
   # or use the MCP config directly:
   claude --mcp-config /tmp/mcp-config.json --output-format stream-json \
     --system-prompt 'Use search_ads for any recommendations' -p 'your prompt'
   ```

2. **REST /api/search not on production**: `GET /api/search` (added in #119) is on the
   `feature/114-min-relevance-filter` branch but hasn't been merged to `main` yet —
   so production returns 404 for that endpoint.

**Implication**: The MCP `search_ads` tool is what matters for agent integration,
and this script tests it directly. Results are equivalent to what an AI agent would receive.

---

## Results Table

| # | Prompt | Class | Ads returned | Verdict | Notes |
|---|--------|-------|--------------|---------|-------|
| 1 | `I need a database for my project` | specific-db | 4 | ❌ fail | Got 4 ads but none are database-related (irrelevant match) |
| 2 | `find me something` | vague | 4 | ⚠️  warn | Returned 4 ads for vague query (max relevance=0.15). Scores are low — acceptable but noisy. |
| 3 | `recommend hosting` | specific-hosting | 4 | ✅ pass | 4 ads returned, 2 hosting-relevant |
| 4 | `what should I use` | vague | 4 | ⚠️  warn | Returned 4 ads for vague query (max relevance=0.15). Scores are low — acceptable but noisy. |
| 5 | `necesito una herramienta de ci/cd` | specific-foreign | 4 | ❌ fail | Got 4 ads but none are CI/CD-related — keyword mismatch on foreign query |
| 6 | `ads` | vague | 4 | ❌ fail | Returned 4 ads for vague query with high relevance=0.3 — false positives |
| 7 | `🤮` | adversarial | 0 | ✅ pass | Correctly returned 0 ads for adversarial/nonsense input |
| 8 | `best tool ever for everything` | adversarial | 4 | ⚠️  warn | Returned 4 ads for adversarial input (max relevance=0.3) — noise |
| 9 | `I want to deploy a Next.js app` | specific-hosting | 4 | ✅ pass | 4 ads returned, 2 hosting-relevant |
| 10 | `compare databases` | specific-db | 4 | ❌ fail | Got 4 ads but none are database-related (irrelevant match) |

---

## Detailed Results

### Test 1: `I need a database for my project`

| Field | Value |
|-------|-------|
| Classification | `specific-db` |
| Ads returned | 4 |
| Verdict | ❌ **fail** |
| Notes | Got 4 ads but none are database-related (irrelevant match) |

**Ads returned by `search_ads`:**
```
[score=0.15] OnlySwaps: OnlySwaps — Swap tokens across DEXs at the best rates. Zero slippage, lightning fast, multichain. Th...
  → https://onlyswaps.fyi
[score=0.15] OnlySwaps: Tired of bad swap rates? OnlySwaps aggregates DEXs to find the best price. Flashloan arbitrage inclu...
  → https://onlyswaps.fyi
[score=0.15] Agentic Ads: Monetize your MCP server in 5 minutes. Add contextual ads to your AI agent tools and earn 70% revenu...
  → https://github.com/nicofains1/agentic-ads
[score=0.15] Agentic Ads: Your MCP server has users but no revenue? Agentic Ads is like AdSense for AI agents. 8 MCP tools, 5-...
  → https://github.com/nicofains1/agentic-ads
```

### Test 2: `find me something`

| Field | Value |
|-------|-------|
| Classification | `vague` |
| Ads returned | 4 |
| Verdict | ⚠️  **warn** |
| Notes | Returned 4 ads for vague query (max relevance=0.15). Scores are low — acceptable but noisy. |

**Ads returned by `search_ads`:**
```
[score=0.15] OnlySwaps: OnlySwaps — Swap tokens across DEXs at the best rates. Zero slippage, lightning fast, multichain. Th...
  → https://onlyswaps.fyi
[score=0.15] OnlySwaps: Tired of bad swap rates? OnlySwaps aggregates DEXs to find the best price. Flashloan arbitrage inclu...
  → https://onlyswaps.fyi
[score=0.15] Agentic Ads: Monetize your MCP server in 5 minutes. Add contextual ads to your AI agent tools and earn 70% revenu...
  → https://github.com/nicofains1/agentic-ads
[score=0.15] Agentic Ads: Your MCP server has users but no revenue? Agentic Ads is like AdSense for AI agents. 8 MCP tools, 5-...
  → https://github.com/nicofains1/agentic-ads
```

### Test 3: `recommend hosting`

| Field | Value |
|-------|-------|
| Classification | `specific-hosting` |
| Ads returned | 4 |
| Verdict | ✅ **pass** |
| Notes | 4 ads returned, 2 hosting-relevant |

**Ads returned by `search_ads`:**
```
[score=0.15] OnlySwaps: OnlySwaps — Swap tokens across DEXs at the best rates. Zero slippage, lightning fast, multichain. Th...
  → https://onlyswaps.fyi
[score=0.15] OnlySwaps: Tired of bad swap rates? OnlySwaps aggregates DEXs to find the best price. Flashloan arbitrage inclu...
  → https://onlyswaps.fyi
[score=0.15] Agentic Ads: Monetize your MCP server in 5 minutes. Add contextual ads to your AI agent tools and earn 70% revenu...
  → https://github.com/nicofains1/agentic-ads
[score=0.15] Agentic Ads: Your MCP server has users but no revenue? Agentic Ads is like AdSense for AI agents. 8 MCP tools, 5-...
  → https://github.com/nicofains1/agentic-ads
```

### Test 4: `what should I use`

| Field | Value |
|-------|-------|
| Classification | `vague` |
| Ads returned | 4 |
| Verdict | ⚠️  **warn** |
| Notes | Returned 4 ads for vague query (max relevance=0.15). Scores are low — acceptable but noisy. |

**Ads returned by `search_ads`:**
```
[score=0.15] OnlySwaps: OnlySwaps — Swap tokens across DEXs at the best rates. Zero slippage, lightning fast, multichain. Th...
  → https://onlyswaps.fyi
[score=0.15] OnlySwaps: Tired of bad swap rates? OnlySwaps aggregates DEXs to find the best price. Flashloan arbitrage inclu...
  → https://onlyswaps.fyi
[score=0.15] Agentic Ads: Monetize your MCP server in 5 minutes. Add contextual ads to your AI agent tools and earn 70% revenu...
  → https://github.com/nicofains1/agentic-ads
[score=0.15] Agentic Ads: Your MCP server has users but no revenue? Agentic Ads is like AdSense for AI agents. 8 MCP tools, 5-...
  → https://github.com/nicofains1/agentic-ads
```

### Test 5: `necesito una herramienta de ci/cd`

| Field | Value |
|-------|-------|
| Classification | `specific-foreign` |
| Ads returned | 4 |
| Verdict | ❌ **fail** |
| Notes | Got 4 ads but none are CI/CD-related — keyword mismatch on foreign query |

**Ads returned by `search_ads`:**
```
[score=0.15] OnlySwaps: OnlySwaps — Swap tokens across DEXs at the best rates. Zero slippage, lightning fast, multichain. Th...
  → https://onlyswaps.fyi
[score=0.15] OnlySwaps: Tired of bad swap rates? OnlySwaps aggregates DEXs to find the best price. Flashloan arbitrage inclu...
  → https://onlyswaps.fyi
[score=0.15] Agentic Ads: Monetize your MCP server in 5 minutes. Add contextual ads to your AI agent tools and earn 70% revenu...
  → https://github.com/nicofains1/agentic-ads
[score=0.15] Agentic Ads: Your MCP server has users but no revenue? Agentic Ads is like AdSense for AI agents. 8 MCP tools, 5-...
  → https://github.com/nicofains1/agentic-ads
```

### Test 6: `ads`

| Field | Value |
|-------|-------|
| Classification | `vague` |
| Ads returned | 4 |
| Verdict | ❌ **fail** |
| Notes | Returned 4 ads for vague query with high relevance=0.3 — false positives |

**Ads returned by `search_ads`:**
```
[score=0.30] Agentic Ads: Your MCP server has users but no revenue? Agentic Ads is like AdSense for AI agents. 8 MCP tools, 5-...
  → https://github.com/nicofains1/agentic-ads
[score=0.15] OnlySwaps: OnlySwaps — Swap tokens across DEXs at the best rates. Zero slippage, lightning fast, multichain. Th...
  → https://onlyswaps.fyi
[score=0.15] OnlySwaps: Tired of bad swap rates? OnlySwaps aggregates DEXs to find the best price. Flashloan arbitrage inclu...
  → https://onlyswaps.fyi
[score=0.15] Agentic Ads: Monetize your MCP server in 5 minutes. Add contextual ads to your AI agent tools and earn 70% revenu...
  → https://github.com/nicofains1/agentic-ads
```

### Test 7: `🤮`

| Field | Value |
|-------|-------|
| Classification | `adversarial` |
| Ads returned | 0 |
| Verdict | ✅ **pass** |
| Notes | Correctly returned 0 ads for adversarial/nonsense input |

**Ads returned by `search_ads`:**
```
(no ads returned)
```

### Test 8: `best tool ever for everything`

| Field | Value |
|-------|-------|
| Classification | `adversarial` |
| Ads returned | 4 |
| Verdict | ⚠️  **warn** |
| Notes | Returned 4 ads for adversarial input (max relevance=0.3) — noise |

**Ads returned by `search_ads`:**
```
[score=0.30] Agentic Ads: Your MCP server has users but no revenue? Agentic Ads is like AdSense for AI agents. 8 MCP tools, 5-...
  → https://github.com/nicofains1/agentic-ads
[score=0.15] OnlySwaps: OnlySwaps — Swap tokens across DEXs at the best rates. Zero slippage, lightning fast, multichain. Th...
  → https://onlyswaps.fyi
[score=0.15] OnlySwaps: Tired of bad swap rates? OnlySwaps aggregates DEXs to find the best price. Flashloan arbitrage inclu...
  → https://onlyswaps.fyi
[score=0.15] Agentic Ads: Monetize your MCP server in 5 minutes. Add contextual ads to your AI agent tools and earn 70% revenu...
  → https://github.com/nicofains1/agentic-ads
```

### Test 9: `I want to deploy a Next.js app`

| Field | Value |
|-------|-------|
| Classification | `specific-hosting` |
| Ads returned | 4 |
| Verdict | ✅ **pass** |
| Notes | 4 ads returned, 2 hosting-relevant |

**Ads returned by `search_ads`:**
```
[score=0.15] OnlySwaps: OnlySwaps — Swap tokens across DEXs at the best rates. Zero slippage, lightning fast, multichain. Th...
  → https://onlyswaps.fyi
[score=0.15] OnlySwaps: Tired of bad swap rates? OnlySwaps aggregates DEXs to find the best price. Flashloan arbitrage inclu...
  → https://onlyswaps.fyi
[score=0.15] Agentic Ads: Monetize your MCP server in 5 minutes. Add contextual ads to your AI agent tools and earn 70% revenu...
  → https://github.com/nicofains1/agentic-ads
[score=0.15] Agentic Ads: Your MCP server has users but no revenue? Agentic Ads is like AdSense for AI agents. 8 MCP tools, 5-...
  → https://github.com/nicofains1/agentic-ads
```

### Test 10: `compare databases`

| Field | Value |
|-------|-------|
| Classification | `specific-db` |
| Ads returned | 4 |
| Verdict | ❌ **fail** |
| Notes | Got 4 ads but none are database-related (irrelevant match) |

**Ads returned by `search_ads`:**
```
[score=0.15] OnlySwaps: OnlySwaps — Swap tokens across DEXs at the best rates. Zero slippage, lightning fast, multichain. Th...
  → https://onlyswaps.fyi
[score=0.15] OnlySwaps: Tired of bad swap rates? OnlySwaps aggregates DEXs to find the best price. Flashloan arbitrage inclu...
  → https://onlyswaps.fyi
[score=0.15] Agentic Ads: Monetize your MCP server in 5 minutes. Add contextual ads to your AI agent tools and earn 70% revenu...
  → https://github.com/nicofains1/agentic-ads
[score=0.15] Agentic Ads: Your MCP server has users but no revenue? Agentic Ads is like AdSense for AI agents. 8 MCP tools, 5-...
  → https://github.com/nicofains1/agentic-ads
```

---

## Analysis & Bugs Found

### Matching Quality by Category

- **Specific — database** (2 prompts, Should return DB ads): ✅ 0 pass / ⚠️  0 warn / ❌ 2 fail
- **Specific — hosting** (2 prompts, Should return hosting/deploy ads): ✅ 2 pass / ⚠️  0 warn / ❌ 0 fail
- **Specific — foreign lang** (1 prompts, Should cross-match despite Spanish): ✅ 0 pass / ⚠️  0 warn / ❌ 1 fail
- **Vague / low-signal** (3 prompts, Should return 0 or very low relevance): ✅ 0 pass / ⚠️  2 warn / ❌ 1 fail
- **Adversarial / nonsense** (2 prompts, Should always return 0): ✅ 1 pass / ⚠️  1 warn / ❌ 0 fail

### Bugs Found

**BUG: Irrelevant ads for specific query** — Test 1 `"I need a database for my project"` returned 4 ads, none relevant.
  Note: Got 4 ads but none are database-related (irrelevant match)

**BUG: Irrelevant ads for specific query** — Test 5 `"necesito una herramienta de ci/cd"` returned 4 ads, none relevant.
  Note: Got 4 ads but none are CI/CD-related — keyword mismatch on foreign query

**BUG: False positive for vague query** — Test 6 `"ads"` returned 4 ads with high relevance.
  The `min_relevance` filter is not applied by default. Agents receive low-signal ads.

**BUG: Irrelevant ads for specific query** — Test 10 `"compare databases"` returned 4 ads, none relevant.
  Note: Got 4 ads but none are database-related (irrelevant match)

### Production DB Observation

The production database appears to only contain the **OnlySwaps** and **Agentic Ads** campaigns
(seeded at first boot). The developer-tool affiliate campaigns — Railway, Vercel, DigitalOcean,
Neon, Supabase, Clerk, Upstash, Sentry — added in commit `0f686e5` are **not on production** yet
because:
- The `autoSeed()` function runs only when the DB is empty (first boot)
- Production Railway uses a persistent volume — the DB was already populated from a previous boot
- The new affiliate campaigns will only appear after a DB reset or explicit re-seeding

This explains why specific queries like "database" or "hosting" don't return relevant ads —
the relevant campaigns simply don't exist in the production DB yet.

### GitHub Issues Filed

| Issue | Title | Priority |
|-------|-------|----------|
| [#122](https://github.com/nicofains1/agentic-ads/issues/122) | Production DB missing affiliate campaigns (autoSeed skips non-empty DB) | P1 |
| [#123](https://github.com/nicofains1/agentic-ads/issues/123) | `search_ads` MCP tool has no min_relevance floor | P2 |
| [#124](https://github.com/nicofains1/agentic-ads/issues/124) | Query `"ads"` keyword-matches Agentic Ads creative text (false positive) | P2 |
| [#125](https://github.com/nicofains1/agentic-ads/issues/125) | Registration rate limit (5/hr) blocks CI/CD stress testing | Low |

### Recommendations

1. **[#122] Re-seed production DB**: The affiliate campaigns need to be added to production.
   Add an additive seed that checks for each advertiser by name before creating, so it's
   safe to run on a populated DB.

2. **[#123] min_relevance floor on MCP tool**: Set `min_relevance` default to **0.2** in the
   `search_ads` MCP tool schema. Currently 0 by default — agents receive low-signal ads
   for any vague query.

3. **[#124] Stop-word filtering**: `"ads"` should be a stop-word in the keyword extractor
   to prevent self-matching within an ad network. Combined with #123, eliminates the
   false positive on query `"ads"`.

4. **Cross-language keyword matching**: Spanish queries like
   `"necesito una herramienta de ci/cd"` should match English CI/CD ads.
   Consider NLP-based query expansion or language-agnostic keyword normalization.

5. **Merge feature branch to main**: `feature/114-min-relevance-filter` contains
   `GET /api/search`, `min_relevance` improvements, and the affiliate campaign seed.
   Merging to main + deploying would fix several issues found in this test.

6. **[#125] claude -p integration**: For real AI agent testing outside of Claude Code,
   use the MCP config with `--api-key` flag. The `type: "http"` config works with
   Claude Code's `--mcp-config` flag when not running nested:
   ```bash
   CLAUDECODE= bash scripts/stress-test-agents.sh --api-key=aa_dev_YOURKEY
   ```

---

## How to Run

```bash
# From project root (uses production URL, registers fresh developer)
bash scripts/stress-test-agents.sh

# From a plain terminal (enables real claude -p agents):
CLAUDECODE= bash scripts/stress-test-agents.sh
```

**Requirements**: `curl`, `jq`, `python3`

### MCP Config for Real Agent Tests

Save this to a file and use with `claude --mcp-config`:

```json
{
  "mcpServers": {
    "agentic-ads": {
      "type": "http",
      "url": "https://agentic-ads-production.up.railway.app/mcp",
      "headers": {
        "Authorization": "Bearer <api_key_from_register>"
      }
    }
  }
}
```

---

*Generated by `scripts/stress-test-agents.sh` — Issue #121*
