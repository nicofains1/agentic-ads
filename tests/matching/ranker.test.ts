import { describe, it, expect } from 'vitest';
import { rankAds, type RankedAd } from '../../src/matching/ranker.js';
import type { MatchResult, AdCandidate } from '../../src/matching/keyword-matcher.js';

function makeMatch(overrides: {
  relevance_score: number;
  bid_amount?: number;
  quality_score?: number;
  id?: string;
  advertiser_name?: string;
}): MatchResult {
  const ad: AdCandidate = {
    id: overrides.id ?? 'ad-1',
    campaign_id: 'camp-1',
    creative_text: 'Test Ad',
    link_url: 'https://example.com',
    keywords: ['test'],
    categories: [],
    geo: 'ALL',
    language: 'en',
    quality_score: overrides.quality_score ?? 1.0,
    bid_amount: overrides.bid_amount ?? 1.0,
    advertiser_name: overrides.advertiser_name ?? 'Brand',
  };
  return {
    ad,
    relevance_score: overrides.relevance_score,
    match_details: {
      exact_keyword_matches: [],
      partial_keyword_matches: [],
      category_match: false,
      geo_match: true,
      language_match: true,
    },
  };
}

describe('rankAds', () => {
  it('returns empty array for empty input', () => {
    expect(rankAds([])).toEqual([]);
  });

  it('filters out matches below MIN_RELEVANCE_THRESHOLD (0.1)', () => {
    const matches = [
      makeMatch({ relevance_score: 0.05, id: 'low' }),
      makeMatch({ relevance_score: 0.5, id: 'high' }),
    ];
    const ranked = rankAds(matches);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].ad_id).toBe('high');
  });

  it('keeps matches at exactly the threshold (0.1)', () => {
    const matches = [makeMatch({ relevance_score: 0.1, id: 'threshold' })];
    const ranked = rankAds(matches);
    expect(ranked).toHaveLength(1);
  });

  it('all results have disclosure: "sponsored"', () => {
    const matches = [makeMatch({ relevance_score: 0.5 })];
    const ranked = rankAds(matches);
    expect(ranked[0].disclosure).toBe('sponsored');
  });

  it('includes correct fields in output', () => {
    const matches = [makeMatch({ relevance_score: 0.5, id: 'ad-x', advertiser_name: 'Adidas' })];
    const ranked = rankAds(matches);
    expect(ranked[0]).toEqual({
      ad_id: 'ad-x',
      advertiser_name: 'Adidas',
      creative_text: 'Test Ad',
      link_url: 'https://example.com',
      relevance_score: 0.5,
      disclosure: 'sponsored',
    });
  });

  describe('Formula: relevance² × bidFactor × quality_score', () => {
    it('relevance squared penalizes low relevance', () => {
      // relevance 0.9 → 0.81, relevance 0.5 → 0.25
      const high = makeMatch({ relevance_score: 0.9, id: 'high-rel' });
      const low = makeMatch({ relevance_score: 0.5, id: 'low-rel' });
      const ranked = rankAds([low, high]);
      expect(ranked[0].ad_id).toBe('high-rel');
    });

    it('relevance 0.9 → score factor 0.81', () => {
      // 0.9² = 0.81, bidFactor=1.0 (single ad), quality=1.0
      const matches = [makeMatch({ relevance_score: 0.9 })];
      const ranked = rankAds(matches);
      // The score is internal but we can verify ordering and inclusion
      expect(ranked).toHaveLength(1);
      expect(ranked[0].relevance_score).toBe(0.9);
    });

    it('relevance 0.15 → score factor 0.0225', () => {
      const matches = [makeMatch({ relevance_score: 0.15 })];
      const ranked = rankAds(matches);
      expect(ranked).toHaveLength(1);
    });
  });

  describe('Bid factor', () => {
    it('bidFactor ranges from 0.7 (min bid) to 1.0 (max bid)', () => {
      // Two ads with same relevance but different bids
      const highBid = makeMatch({ relevance_score: 0.5, bid_amount: 2.0, id: 'high-bid' });
      const lowBid = makeMatch({ relevance_score: 0.5, bid_amount: 0.5, id: 'low-bid' });
      const ranked = rankAds([lowBid, highBid]);
      // Same relevance → bid tiebreaker: high bid wins
      expect(ranked[0].ad_id).toBe('high-bid');
      expect(ranked[1].ad_id).toBe('low-bid');
    });

    it('bid contributes only 30% to final score', () => {
      // High relevance low bid should beat low relevance high bid
      const relevantCheap = makeMatch({ relevance_score: 0.8, bid_amount: 0.5, id: 'relevant' });
      const irrelevantExpensive = makeMatch({ relevance_score: 0.2, bid_amount: 10.0, id: 'expensive' });
      const ranked = rankAds([irrelevantExpensive, relevantCheap]);
      // 0.8² × (0.7 + 0.3 × 0.05) × 1.0 = 0.64 × 0.715 = 0.4576
      // 0.2² × (0.7 + 0.3 × 1.0) × 1.0 = 0.04 × 1.0 = 0.04
      expect(ranked[0].ad_id).toBe('relevant');
    });

    it('when all bids equal, bidFactor = 1.0 for all', () => {
      const a = makeMatch({ relevance_score: 0.7, bid_amount: 1.0, id: 'a' });
      const b = makeMatch({ relevance_score: 0.5, bid_amount: 1.0, id: 'b' });
      const ranked = rankAds([b, a]);
      // Only relevance decides
      expect(ranked[0].ad_id).toBe('a');
    });
  });

  describe('Quality score', () => {
    it('lower quality score penalizes ranking', () => {
      const highQ = makeMatch({ relevance_score: 0.5, quality_score: 1.0, id: 'high-q' });
      const lowQ = makeMatch({ relevance_score: 0.5, quality_score: 0.5, id: 'low-q' });
      const ranked = rankAds([lowQ, highQ]);
      expect(ranked[0].ad_id).toBe('high-q');
    });
  });

  describe('maxResults', () => {
    it('defaults to 3 results', () => {
      const matches = Array.from({ length: 5 }, (_, i) =>
        makeMatch({ relevance_score: 0.5 + i * 0.05, id: `ad-${i}` }),
      );
      const ranked = rankAds(matches);
      expect(ranked).toHaveLength(3);
    });

    it('respects custom maxResults=1', () => {
      const matches = [
        makeMatch({ relevance_score: 0.5, id: 'a' }),
        makeMatch({ relevance_score: 0.8, id: 'b' }),
      ];
      const ranked = rankAds(matches, 1);
      expect(ranked).toHaveLength(1);
      expect(ranked[0].ad_id).toBe('b');
    });

    it('returns fewer if less ads available than maxResults', () => {
      const matches = [makeMatch({ relevance_score: 0.5, id: 'only' })];
      const ranked = rankAds(matches, 10);
      expect(ranked).toHaveLength(1);
    });
  });

  describe('Sorting', () => {
    it('sorted by score descending', () => {
      const matches = [
        makeMatch({ relevance_score: 0.3, id: 'low' }),
        makeMatch({ relevance_score: 0.9, id: 'high' }),
        makeMatch({ relevance_score: 0.6, id: 'mid' }),
      ];
      const ranked = rankAds(matches);
      expect(ranked.map((r) => r.ad_id)).toEqual(['high', 'mid', 'low']);
    });
  });
});
