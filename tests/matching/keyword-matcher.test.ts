import { describe, it, expect } from 'vitest';
import { extractKeywords, matchAds, type AdCandidate } from '../../src/matching/index.js';

// ─── Helper: build AdCandidate with sensible defaults ─────────────────────────

function makeAd(overrides: Partial<AdCandidate> = {}): AdCandidate {
  return {
    id: 'ad-1',
    campaign_id: 'camp-1',
    creative_text: 'Test Ad',
    link_url: 'https://example.com',
    keywords: ['running shoes', 'sneakers'],
    categories: ['footwear'],
    geo: 'ALL',
    language: 'en',
    quality_score: 1.0,
    bid_amount: 1.0,
    advertiser_name: 'TestBrand',
    ...overrides,
  };
}

// ─── extractKeywords ──────────────────────────────────────────────────────────

describe('extractKeywords', () => {
  it('lowercases input', () => {
    const kw = extractKeywords('Running SHOES');
    expect(kw).toEqual(['running', 'shoes']);
  });

  it('removes punctuation', () => {
    const kw = extractKeywords("what's the best shoe?");
    // "what" and "the" and "best" are stopwords
    expect(kw).toEqual(['shoe']);
  });

  it('splits by whitespace', () => {
    const kw = extractKeywords('red  blue   green');
    expect(kw).toEqual(['red', 'blue', 'green']);
  });

  it('filters English stopwords', () => {
    const kw = extractKeywords('I want to buy the best running shoes');
    // "i", "want", "to", "buy", "the", "best" are stopwords
    expect(kw).toEqual(['running', 'shoes']);
  });

  it('filters Spanish stopwords', () => {
    const kw = extractKeywords('quiero comprar unas zapatillas para correr');
    // "quiero", "comprar", "unas" (not in stopwords but "un/una" are), "para" are stopwords
    expect(kw).toContain('zapatillas');
    expect(kw).toContain('correr');
    expect(kw).not.toContain('quiero');
    expect(kw).not.toContain('comprar');
    expect(kw).not.toContain('para');
  });

  it('filters words with length <= 1', () => {
    const kw = extractKeywords('a b c running');
    expect(kw).toEqual(['running']);
  });

  it('returns empty for all-stopwords input', () => {
    const kw = extractKeywords('I want to get the best');
    expect(kw).toEqual([]);
  });
});

// ─── matchAds ─────────────────────────────────────────────────────────────────

describe('matchAds', () => {
  describe('Exact keyword match', () => {
    it('scores +0.30 for exact keyword match', () => {
      const ad = makeAd({ keywords: ['running shoes'] });
      const results = matchAds({ keywords: ['running shoes'] }, [ad]);
      expect(results).toHaveLength(1);
      expect(results[0].match_details.exact_keyword_matches).toContain('running shoes');
      // +0.30 (exact) + 0.10 (geo ALL) + 0.05 (lang en) = 0.45
      expect(results[0].relevance_score).toBeCloseTo(0.45, 1);
    });

    it('scores +0.30 per each exact match', () => {
      const ad = makeAd({ keywords: ['running shoes', 'sneakers', 'athletic shoes'] });
      const results = matchAds({ keywords: ['running shoes', 'sneakers'] }, [ad]);
      expect(results[0].match_details.exact_keyword_matches).toHaveLength(2);
      // 2 × 0.30 + 0.10 + 0.05 = 0.75
      expect(results[0].relevance_score).toBeCloseTo(0.75, 1);
    });
  });

  describe('Partial keyword match', () => {
    it('scores +0.15 for partial match (query word contained in ad keyword)', () => {
      const ad = makeAd({ keywords: ['running shoes'] });
      // "shoe" is contained in "running shoes" (partial)
      const results = matchAds({ keywords: ['shoe'] }, [ad]);
      expect(results).toHaveLength(1);
      expect(results[0].match_details.partial_keyword_matches).toContain('running shoes');
      // +0.15 (partial) + 0.10 + 0.05 = 0.30
      expect(results[0].relevance_score).toBeCloseTo(0.30, 1);
    });

    it('scores +0.15 for partial match (ad keyword contained in query word)', () => {
      const ad = makeAd({ keywords: ['shoe'] });
      const results = matchAds({ keywords: ['running shoes'] }, [ad]);
      expect(results).toHaveLength(1);
      expect(results[0].match_details.partial_keyword_matches).toContain('shoe');
    });
  });

  describe('Category match', () => {
    it('scores +0.20 for category match', () => {
      const ad = makeAd({ keywords: ['test'], categories: ['footwear'] });
      const results = matchAds({ category: 'footwear', keywords: ['something-else'] }, [ad]);
      // No keyword match, only category (+0.20) + geo (+0.10) + lang (+0.05) = 0.35
      expect(results).toHaveLength(1);
      expect(results[0].match_details.category_match).toBe(true);
      expect(results[0].relevance_score).toBeCloseTo(0.35, 1);
    });

    it('only category without keywords still works', () => {
      const ad = makeAd({ categories: ['footwear'] });
      const results = matchAds({ category: 'footwear' }, [ad]);
      expect(results).toHaveLength(1);
      expect(results[0].match_details.category_match).toBe(true);
    });
  });

  describe('Geo match', () => {
    it('scores +0.10 for geo match (exact)', () => {
      const ad = makeAd({ geo: 'US' });
      const results = matchAds({ keywords: ['sneakers'], geo: 'US' }, [ad]);
      expect(results[0].match_details.geo_match).toBe(true);
    });

    it('scores +0.10 for geo match (ALL always matches)', () => {
      const ad = makeAd({ geo: 'ALL' });
      const results = matchAds({ keywords: ['sneakers'], geo: 'UK' }, [ad]);
      expect(results[0].match_details.geo_match).toBe(true);
    });

    it('geo_match is true when no geo specified in query', () => {
      const ad = makeAd({ geo: 'US' });
      const results = matchAds({ keywords: ['sneakers'] }, [ad]);
      expect(results[0].match_details.geo_match).toBe(true);
    });

    it('geo_match is false when geo differs', () => {
      const ad = makeAd({ geo: 'US' });
      const results = matchAds({ keywords: ['sneakers'], geo: 'UK' }, [ad]);
      // Score: 0.30 (exact) + 0 (no geo) + 0.05 (lang) = 0.35
      expect(results[0].match_details.geo_match).toBe(false);
    });
  });

  describe('Language match', () => {
    it('scores +0.05 for language match', () => {
      const ad = makeAd({ language: 'en' });
      const results = matchAds({ keywords: ['sneakers'], language: 'en' }, [ad]);
      expect(results[0].match_details.language_match).toBe(true);
    });

    it('language_match is false when language differs', () => {
      const ad = makeAd({ language: 'en' });
      const results = matchAds({ keywords: ['sneakers'], language: 'zh' }, [ad]);
      expect(results[0].match_details.language_match).toBe(false);
    });

    it('language_match is true when no language specified', () => {
      const ad = makeAd({ language: 'en' });
      const results = matchAds({ keywords: ['sneakers'] }, [ad]);
      expect(results[0].match_details.language_match).toBe(true);
    });
  });

  describe('Score normalization', () => {
    it('caps score at 1.0', () => {
      const ad = makeAd({
        keywords: ['a', 'b', 'c', 'd', 'e'],
        categories: ['cat'],
      });
      // 5 exact matches × 0.30 = 1.50, + 0.20 + 0.10 + 0.05 = 1.85 → capped at 1.0
      const results = matchAds({ keywords: ['a', 'b', 'c', 'd', 'e'], category: 'cat' }, [ad]);
      expect(results[0].relevance_score).toBeLessThanOrEqual(1.0);
    });
  });

  describe('Threshold', () => {
    it('filters out results with score <= 0.05', () => {
      const ad = makeAd({ keywords: ['something-unique'], geo: 'JP', language: 'ja' });
      // query has no matching keywords, no category, geo/lang mismatch
      const results = matchAds({ keywords: ['completely-different'], geo: 'US', language: 'en' }, [ad]);
      expect(results).toHaveLength(0);
    });
  });

  describe('No input', () => {
    it('returns empty when no keywords and no category', () => {
      const ad = makeAd();
      const results = matchAds({}, [ad]);
      expect(results).toEqual([]);
    });

    it('returns empty when no keywords and no category even with geo/language', () => {
      const ad = makeAd();
      const results = matchAds({ geo: 'US', language: 'en' }, [ad]);
      expect(results).toEqual([]);
    });
  });

  describe('Query text extraction', () => {
    it('extracts keywords from query text', () => {
      const ad = makeAd({ keywords: ['running shoes'] });
      const results = matchAds({ query: 'best running shoes for marathon' }, [ad]);
      expect(results).toHaveLength(1);
      // "running" and "shoes" are extracted, both partial match "running shoes"
      expect(results[0].relevance_score).toBeGreaterThan(0.1);
    });

    it('combines query keywords with explicit keywords', () => {
      const ad = makeAd({ keywords: ['running shoes', 'sneakers'] });
      const results = matchAds({
        query: 'comfortable shoes',
        keywords: ['sneakers'],
      }, [ad]);
      expect(results).toHaveLength(1);
      // "sneakers" is exact match, "shoes" from query is partial match with "running shoes"
      expect(results[0].match_details.exact_keyword_matches).toContain('sneakers');
    });

    it('deduplicates query keywords', () => {
      const ad = makeAd({ keywords: ['shoes'] });
      const results = matchAds({
        query: 'shoes shoes shoes',
        keywords: ['shoes'],
      }, [ad]);
      expect(results[0].match_details.exact_keyword_matches).toHaveLength(1);
    });
  });

  describe('Stopwords in query', () => {
    it('all-stopwords query returns empty', () => {
      const ad = makeAd();
      const results = matchAds({ query: 'I want to buy the best' }, [ad]);
      expect(results).toEqual([]);
    });
  });
});
