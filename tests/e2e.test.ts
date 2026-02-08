// ──────────────────────────────────────────────────────────────────────────────
// E2E test — full flow from campaign creation to analytics (#16)
// ──────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDatabase,
  createAdvertiser,
  createDeveloper,
  createCampaign,
  createAd,
  getActiveAds,
  getAdById,
  getCampaignById,
  getAdsByCampaign,
  insertEvent,
  updateAdStats,
  updateCampaignSpent,
  updateCampaignStatus,
} from '../src/db/index.js';
import { generateApiKey, authenticate, AuthError } from '../src/auth/middleware.js';
import { matchAds, rankAds } from '../src/matching/index.js';
import { getAdGuidelines } from '../src/tools/consumer/get-guidelines.js';

type DB = ReturnType<typeof initDatabase>;

// Helper: simulates what search_ads tool does
function searchAds(db: DB, params: {
  query?: string;
  keywords?: string[];
  category?: string;
  geo?: string;
  language?: string;
  max_results?: number;
}) {
  const activeAds = getActiveAds(db, {
    geo: params.geo,
    language: params.language ?? 'en',
  });

  if (activeAds.length === 0) return { ads: [] };

  const candidates = activeAds.map((ad) => {
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(ad.campaign_id) as { bid_amount: number; advertiser_id: string };
    const advertiser = db.prepare('SELECT * FROM advertisers WHERE id = ?').get(campaign.advertiser_id) as { name: string };
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
      language: params.language ?? 'en',
    },
    candidates,
  );

  return { ads: rankAds(matches, params.max_results ?? 3) };
}

// Helper: simulates what report_event tool does
function reportEvent(db: DB, params: {
  ad_id: string;
  developer_id: string;
  event_type: 'impression' | 'click' | 'conversion';
  context_hash?: string;
}) {
  const ad = getAdById(db, params.ad_id);
  if (!ad) throw new Error('Ad not found');

  const campaign = getCampaignById(db, ad.campaign_id);
  if (!campaign || campaign.status !== 'active') {
    return { error: 'Campaign not active', campaign_paused: campaign?.status === 'paused' };
  }

  let cost = 0;
  if (campaign.pricing_model === 'cpm' && params.event_type === 'impression') {
    cost = campaign.bid_amount / 1000;
  } else if (campaign.pricing_model === 'cpc' && params.event_type === 'click') {
    cost = campaign.bid_amount;
  } else if (campaign.pricing_model === 'cpa' && params.event_type === 'conversion') {
    cost = campaign.bid_amount;
  }

  if (campaign.spent + cost > campaign.total_budget) {
    updateCampaignStatus(db, campaign.id, 'paused');
    return { error: 'Campaign budget exhausted', campaign_paused: true };
  }

  const developerRevenue = cost * 0.7;
  const platformRevenue = cost * 0.3;

  const processEvent = db.transaction(() => {
    const event = insertEvent(db, {
      ad_id: params.ad_id,
      developer_id: params.developer_id,
      event_type: params.event_type,
      amount_charged: cost,
      developer_revenue: developerRevenue,
      platform_revenue: platformRevenue,
      context_hash: params.context_hash,
    });

    updateAdStats(db, params.ad_id, params.event_type, cost);

    if (cost > 0) {
      updateCampaignSpent(db, campaign.id, cost);
    }

    const updated = getCampaignById(db, campaign.id);
    if (updated && updated.spent >= updated.total_budget) {
      updateCampaignStatus(db, campaign.id, 'paused');
    }

    return event;
  });

  const event = processEvent();

  return {
    event_id: event.id,
    event_type: params.event_type,
    amount_charged: cost,
    developer_revenue: developerRevenue,
    remaining_budget: campaign.total_budget - campaign.spent - cost,
  };
}

// Helper: simulates what get_campaign_analytics tool does
function getCampaignAnalytics(db: DB, campaign_id: string) {
  const campaign = getCampaignById(db, campaign_id);
  if (!campaign) throw new Error('Campaign not found');

  const ads = getAdsByCampaign(db, campaign_id);

  const totals = ads.reduce(
    (acc, ad) => ({
      impressions: acc.impressions + ad.impressions,
      clicks: acc.clicks + ad.clicks,
      conversions: acc.conversions + ad.conversions,
      spend: acc.spend + ad.spend,
    }),
    { impressions: 0, clicks: 0, conversions: 0, spend: 0 },
  );

  const ctr = totals.impressions > 0 ? totals.clicks / totals.impressions : 0;
  const cvr = totals.clicks > 0 ? totals.conversions / totals.clicks : 0;

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      pricing_model: campaign.pricing_model,
    },
    budget: {
      total: campaign.total_budget,
      daily: campaign.daily_budget,
      spent: campaign.spent,
      remaining: campaign.total_budget - campaign.spent,
    },
    totals,
    rates: {
      ctr: Math.round(ctr * 10000) / 100,
      cvr: Math.round(cvr * 10000) / 100,
    },
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('E2E: Full Advertising Flow', () => {
  let db: DB;
  let advertiserId: string;
  let developerId: string;
  let advKey: string;
  let devKey: string;
  let campaignId: string;
  let adId: string;

  beforeEach(() => {
    db = initDatabase(':memory:');

    // 1. Create advertiser + API key
    const adv = createAdvertiser(db, { name: 'Adidas', company: 'Adidas AG' });
    advertiserId = adv.id;
    advKey = generateApiKey(db, 'advertiser', advertiserId);

    // 2. Create developer + API key
    const dev = createDeveloper(db, { name: 'TestBot' });
    developerId = dev.id;
    devKey = generateApiKey(db, 'developer', developerId);

    // 3. Advertiser creates campaign (CPC $0.50, budget $10)
    const campaign = createCampaign(db, {
      advertiser_id: advertiserId,
      name: 'Running Shoes Summer',
      objective: 'traffic',
      total_budget: 10,
      daily_budget: 5,
      pricing_model: 'cpc',
      bid_amount: 0.50,
    });
    campaignId = campaign.id;

    // 4. Advertiser creates ad
    const ad = createAd(db, {
      campaign_id: campaignId,
      creative_text: 'Adidas Ultraboost — 30% off! Best running shoe for comfort.',
      link_url: 'https://www.adidas.com/ultraboost',
      keywords: ['running shoes', 'sneakers', 'athletic shoes'],
      categories: ['footwear', 'sports'],
      geo: 'ALL',
      language: 'en',
    });
    adId = ad.id;
  });

  it('complete flow: search → impression → click → analytics', () => {
    // 5. Consumer searches for ads
    const results = searchAds(db, {
      query: 'best running shoes',
      geo: 'US',
      language: 'en',
    });

    expect(results.ads.length).toBeGreaterThan(0);
    expect(results.ads[0].ad_id).toBe(adId);
    expect(results.ads[0].relevance_score).toBeGreaterThan(0);
    expect(results.ads[0].disclosure).toBe('sponsored');

    // 6. Developer reports impression
    const impression = reportEvent(db, {
      ad_id: adId,
      developer_id: developerId,
      event_type: 'impression',
    });
    expect(impression.event_type).toBe('impression');
    expect(impression.amount_charged).toBe(0); // CPC model: impression is free

    // 7. Developer reports click
    const click = reportEvent(db, {
      ad_id: adId,
      developer_id: developerId,
      event_type: 'click',
    });
    expect(click.event_type).toBe('click');
    expect(click.amount_charged).toBe(0.50);
    expect(click.developer_revenue).toBe(0.35); // 70% of $0.50
    expect(click.remaining_budget).toBe(9.50);

    // 8. Check analytics
    const analytics = getCampaignAnalytics(db, campaignId);
    expect(analytics.totals.impressions).toBe(1);
    expect(analytics.totals.clicks).toBe(1);
    expect(analytics.totals.spend).toBe(0.50);
    expect(analytics.budget.remaining).toBe(9.50);
    expect(analytics.rates.ctr).toBe(100); // 1 click / 1 impression = 100%
  });

  it('budget exhaustion: campaign auto-pauses when budget runs out', () => {
    // Budget is $10, CPC is $0.50 → 20 clicks to exhaust
    for (let i = 0; i < 20; i++) {
      const result = reportEvent(db, {
        ad_id: adId,
        developer_id: developerId,
        event_type: 'click',
      });

      if ('error' in result) {
        // Budget exhausted before we expected
        expect(i).toBeGreaterThanOrEqual(19);
        break;
      }
    }

    // Campaign should now be paused
    const campaign = getCampaignById(db, campaignId)!;
    expect(campaign.status).toBe('paused');
    expect(campaign.spent).toBe(10);

    // Further events should fail
    const result = reportEvent(db, {
      ad_id: adId,
      developer_id: developerId,
      event_type: 'click',
    });
    expect(result).toHaveProperty('error');
  });

  it('no-match: search with unrelated keywords in different language returns empty', () => {
    // Ads are in 'en' — searching in 'zh' means no active ads match
    const results = searchAds(db, {
      query: 'best pizza delivery near me',
      geo: 'US',
      language: 'zh',
    });

    expect(results.ads).toHaveLength(0);
  });

  it('no-match: search with no keywords or category returns empty', () => {
    const results = searchAds(db, {
      // No query, no keywords, no category → matchAds early returns []
      geo: 'US',
      language: 'en',
    });

    expect(results.ads).toHaveLength(0);
  });

  it('auth: API keys authenticate correctly', () => {
    const advAuth = authenticate(db, advKey);
    expect(advAuth.entity_type).toBe('advertiser');
    expect(advAuth.entity_id).toBe(advertiserId);

    const devAuth = authenticate(db, devKey);
    expect(devAuth.entity_type).toBe('developer');
    expect(devAuth.entity_id).toBe(developerId);
  });

  it('auth: invalid key is rejected', () => {
    expect(() => authenticate(db, 'aa_adv_invalid')).toThrow(AuthError);
    expect(() => authenticate(db, '')).toThrow(AuthError);
    expect(() => authenticate(db, 'no_prefix')).toThrow(AuthError);
  });

  it('guidelines: returns valid formatting rules', () => {
    const guidelines = getAdGuidelines();
    expect(guidelines).toHaveProperty('rules');
    expect(guidelines.rules.length).toBeGreaterThan(0);
    expect(guidelines).toHaveProperty('example_format');
  });

  it('revenue split: 70% developer, 30% platform', () => {
    const result = reportEvent(db, {
      ad_id: adId,
      developer_id: developerId,
      event_type: 'click',
    });

    expect(result.amount_charged).toBe(0.50);
    expect(result.developer_revenue).toBe(0.35);
    // Platform gets 0.15 (30%)

    // Verify in DB
    const events = db.prepare('SELECT * FROM events WHERE ad_id = ?').all(adId) as Array<{
      amount_charged: number;
      developer_revenue: number;
      platform_revenue: number;
    }>;
    expect(events[0].developer_revenue).toBe(0.35);
    expect(events[0].platform_revenue).toBe(0.15);
  });

  it('multiple ads: ranking by relevance × bid × quality', () => {
    // Create a second campaign with higher bid
    const campaign2 = createCampaign(db, {
      advertiser_id: advertiserId,
      name: 'Premium Campaign',
      objective: 'traffic',
      total_budget: 100,
      pricing_model: 'cpc',
      bid_amount: 2.00, // 4× higher bid
    });

    createAd(db, {
      campaign_id: campaign2.id,
      creative_text: 'Premium Running Shoes — top quality!',
      link_url: 'https://example.com/premium',
      keywords: ['running shoes', 'premium'],
      categories: ['footwear'],
    });

    const results = searchAds(db, {
      query: 'running shoes',
      geo: 'US',
    });

    // Both ads should appear
    expect(results.ads.length).toBe(2);
    // Higher bid ad should rank first (given similar relevance and quality)
    expect(results.ads[0].creative_text).toContain('Premium');
  });

  it('geo filtering: only matching geo ads returned', () => {
    // Create US-only ad
    const usCampaign = createCampaign(db, {
      advertiser_id: advertiserId,
      name: 'US Only',
      objective: 'traffic',
      total_budget: 50,
      pricing_model: 'cpc',
      bid_amount: 1.00,
    });

    createAd(db, {
      campaign_id: usCampaign.id,
      creative_text: 'US exclusive deal!',
      link_url: 'https://example.com/us',
      keywords: ['running shoes'],
      categories: ['footwear'],
      geo: 'US',
    });

    // Search from UK — US-only ad should not appear, but ALL-geo ad should
    const ukResults = searchAds(db, {
      query: 'running shoes',
      geo: 'UK',
    });

    const ukAdTexts = ukResults.ads.map((a) => a.creative_text);
    expect(ukAdTexts.some((t) => t.includes('US exclusive'))).toBe(false);
    expect(ukAdTexts.some((t) => t.includes('Ultraboost'))).toBe(true);

    // Search from US — both should appear
    const usResults = searchAds(db, {
      query: 'running shoes',
      geo: 'US',
    });
    expect(usResults.ads.length).toBeGreaterThanOrEqual(2);
  });
});
