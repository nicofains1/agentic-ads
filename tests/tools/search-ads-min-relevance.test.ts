// ──────────────────────────────────────────────────────────────────────────────
// Tests for min_relevance filter in search_ads (#117)
// Verifies that ads below the threshold are excluded, and that { ads: [] }
// is returned when no ads meet the threshold.
// ──────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDatabase,
  createAdvertiser,
  createCampaign,
  createAd,
  getActiveAds,
} from '../../src/db/index.js';
import { matchAds, rankAds } from '../../src/matching/index.js';
import type { AdCandidate } from '../../src/matching/index.js';

type DB = ReturnType<typeof initDatabase>;

// Mirrors the logic in server.ts search_ads tool
function searchAds(
  db: DB,
  params: {
    query?: string;
    keywords?: string[];
    category?: string;
    geo?: string;
    language?: string;
    max_results?: number;
    min_relevance?: number;
  },
) {
  const minRelevance = params.min_relevance ?? 0;

  const activeAds = getActiveAds(db, {
    geo: params.geo,
    language: params.language,
  });

  if (activeAds.length === 0) return { ads: [] };

  const candidates: AdCandidate[] = activeAds.map((ad) => {
    const campaign = db
      .prepare('SELECT * FROM campaigns WHERE id = ?')
      .get(ad.campaign_id) as { bid_amount: number; advertiser_id: string };
    const advertiser = db
      .prepare('SELECT * FROM advertisers WHERE id = ?')
      .get(campaign.advertiser_id) as { name: string };
    return {
      id: ad.id,
      campaign_id: ad.campaign_id,
      creative_text: ad.creative_text,
      link_url: ad.link_url,
      keywords: ad.keywords,
      categories: ad.categories,
      geo: ad.geo,
      language: ad.language,
      quality_score: ad.quality_score,
      bid_amount: campaign.bid_amount,
      advertiser_name: advertiser.name,
    };
  });

  const matches = matchAds(
    {
      query: params.query,
      keywords: params.keywords,
      category: params.category,
      geo: params.geo,
      language: params.language,
    },
    candidates,
  );

  const ranked = rankAds(matches, params.max_results ?? 3).filter(
    (ad) => ad.relevance_score >= minRelevance,
  );

  return { ads: ranked };
}

describe('search_ads min_relevance filter (#117)', () => {
  let db: DB;
  let campaignId: string;

  beforeEach(() => {
    db = initDatabase();

    const adv = createAdvertiser(db, { name: 'TestBrand' });
    const campaign = createCampaign(db, {
      advertiser_id: adv.id,
      name: 'Test Campaign',
      objective: 'traffic',
      total_budget: 100,
      pricing_model: 'cpc',
      bid_amount: 1.0,
    });
    campaignId = campaign.id;

    // Ad with many keywords — will score well for "running shoes"
    createAd(db, {
      campaign_id: campaignId,
      creative_text: 'Best running shoes for athletes',
      link_url: 'https://example.com/shoes',
      keywords: ['running', 'shoes', 'athlete', 'sport', 'fitness'],
      categories: ['sports'],
    });

    // Ad with unrelated keywords — will score low or zero for "running shoes"
    createAd(db, {
      campaign_id: campaignId,
      creative_text: 'Buy crypto tokens now',
      link_url: 'https://example.com/crypto',
      keywords: ['crypto', 'defi', 'blockchain'],
      categories: ['finance'],
    });
  });

  it('default min_relevance=0 returns all ads that match above internal threshold', () => {
    const result = searchAds(db, { query: 'running shoes', min_relevance: 0 });
    // At least the shoes ad should match
    expect(result.ads.length).toBeGreaterThanOrEqual(1);
    expect(result.ads.some((a) => a.creative_text.includes('running shoes'))).toBe(true);
  });

  it('high min_relevance filters out low-scoring ads', () => {
    // The shoes ad should score well for "running shoes"; set threshold above crypto ad score
    const resultLow = searchAds(db, { query: 'running shoes', min_relevance: 0 });
    const resultHigh = searchAds(db, { query: 'running shoes', min_relevance: 0.9 });

    // At high threshold, fewer (or zero) ads pass
    expect(resultHigh.ads.length).toBeLessThanOrEqual(resultLow.ads.length);
  });

  it('returns { ads: [] } when min_relevance exceeds all scores', () => {
    // min_relevance=1.0 is virtually impossible to reach (max is 1.0 but requires perfect match)
    const result = searchAds(db, { query: 'running shoes', min_relevance: 1.0 });
    expect(result).toEqual({ ads: [] });
  });

  it('returns { ads: [] } when query has no keyword matches and min_relevance exceeds geo/language bonus', () => {
    // Geo + language bonuses can add up to 0.15 even with zero keyword matches.
    // Setting min_relevance > 0.15 guarantees empty results for a totally unrelated query.
    const result = searchAds(db, { query: 'zzz unknown topic xyz', min_relevance: 0.5 });
    expect(result).toEqual({ ads: [] });
  });

  it('all returned ads satisfy relevance_score >= min_relevance', () => {
    const minRelevance = 0.2;
    const result = searchAds(db, { query: 'running shoes sport', min_relevance: minRelevance });
    for (const ad of result.ads) {
      expect(ad.relevance_score).toBeGreaterThanOrEqual(minRelevance);
    }
  });

  it('min_relevance=0 and no query returns empty (no query = no matches)', () => {
    const result = searchAds(db, { min_relevance: 0 });
    expect(result).toEqual({ ads: [] });
  });

  it('returns empty when no active ads exist', () => {
    const emptyDb = initDatabase();
    const result = searchAds(emptyDb, { query: 'shoes', min_relevance: 0 });
    expect(result).toEqual({ ads: [] });
  });

  it('ads returned are sorted by relevance descending', () => {
    // Create two ads: one very relevant, one weakly relevant
    createAd(db, {
      campaign_id: campaignId,
      creative_text: 'running shoes marathon training fitness',
      link_url: 'https://example.com/marathon',
      keywords: ['running', 'shoes', 'marathon', 'training', 'fitness'],
      categories: ['sports'],
    });

    const result = searchAds(db, { query: 'running shoes', min_relevance: 0, max_results: 10 });
    const scores = result.ads.map((a) => a.relevance_score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    }
  });
});
