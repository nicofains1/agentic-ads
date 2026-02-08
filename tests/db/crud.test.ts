import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDatabase,
  createAdvertiser,
  createDeveloper,
  createCampaign,
  createAd,
  getAdById,
  getAdsByCampaign,
  getActiveAds,
  getCampaignById,
  getCampaignsByAdvertiser,
  insertEvent,
  getEventsByAd,
  getDailySpent,
  updateAdStats,
  updateCampaignSpent,
  updateCampaignStatus,
  createApiKey,
  findApiKey,
} from '../../src/db/index.js';

type DB = ReturnType<typeof initDatabase>;

describe('Database CRUD', () => {
  let db: DB;

  beforeEach(() => {
    db = initDatabase(':memory:');
  });

  // ─── Advertisers ─────────────────────────────────────────────────────────────

  describe('createAdvertiser', () => {
    it('creates advertiser with UUID and stores in DB', () => {
      const adv = createAdvertiser(db, { name: 'Adidas', company: 'Adidas AG' });
      expect(adv.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(adv.name).toBe('Adidas');
      expect(adv.company).toBe('Adidas AG');
      expect(adv.created_at).toBeDefined();
    });

    it('creates advertiser with optional fields null', () => {
      const adv = createAdvertiser(db, { name: 'Nike' });
      expect(adv.company).toBeNull();
      expect(adv.email).toBeNull();
    });

    it('creates advertiser with email', () => {
      const adv = createAdvertiser(db, { name: 'Nike', email: 'ads@nike.com' });
      expect(adv.email).toBe('ads@nike.com');
    });
  });

  // ─── Developers ──────────────────────────────────────────────────────────────

  describe('createDeveloper', () => {
    it('creates developer with UUID and default reputation_score', () => {
      const dev = createDeveloper(db, { name: 'TestBot' });
      expect(dev.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(dev.name).toBe('TestBot');
      expect(dev.reputation_score).toBe(1.0);
      expect(dev.created_at).toBeDefined();
    });

    it('creates developer with email', () => {
      const dev = createDeveloper(db, { name: 'Bot', email: 'bot@example.com' });
      expect(dev.email).toBe('bot@example.com');
    });
  });

  // ─── Campaigns ───────────────────────────────────────────────────────────────

  describe('createCampaign', () => {
    let advId: string;

    beforeEach(() => {
      advId = createAdvertiser(db, { name: 'Test' }).id;
    });

    it('creates CPC campaign with defaults', () => {
      const camp = createCampaign(db, {
        advertiser_id: advId,
        name: 'CPC Campaign',
        objective: 'traffic',
        total_budget: 100,
        pricing_model: 'cpc',
        bid_amount: 0.50,
      });
      expect(camp.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(camp.status).toBe('active');
      expect(camp.spent).toBe(0);
      expect(camp.pricing_model).toBe('cpc');
      expect(camp.bid_amount).toBe(0.50);
      expect(camp.daily_budget).toBeNull();
    });

    it('creates CPM campaign', () => {
      const camp = createCampaign(db, {
        advertiser_id: advId,
        name: 'CPM Campaign',
        objective: 'awareness',
        total_budget: 50,
        pricing_model: 'cpm',
        bid_amount: 15,
      });
      expect(camp.pricing_model).toBe('cpm');
      expect(camp.bid_amount).toBe(15);
    });

    it('creates CPA campaign', () => {
      const camp = createCampaign(db, {
        advertiser_id: advId,
        name: 'CPA Campaign',
        objective: 'conversions',
        total_budget: 100,
        pricing_model: 'cpa',
        bid_amount: 5.00,
      });
      expect(camp.pricing_model).toBe('cpa');
    });

    it('creates campaign with daily_budget', () => {
      const camp = createCampaign(db, {
        advertiser_id: advId,
        name: 'Daily Budget',
        objective: 'traffic',
        total_budget: 100,
        daily_budget: 10,
        pricing_model: 'cpc',
        bid_amount: 0.50,
      });
      expect(camp.daily_budget).toBe(10);
    });

    it('creates campaign with start_date and end_date', () => {
      const camp = createCampaign(db, {
        advertiser_id: advId,
        name: 'Dated Campaign',
        objective: 'traffic',
        total_budget: 100,
        pricing_model: 'cpc',
        bid_amount: 0.50,
        start_date: '2025-01-01',
        end_date: '2025-12-31',
      });
      expect(camp.start_date).toBe('2025-01-01');
      expect(camp.end_date).toBe('2025-12-31');
    });
  });

  describe('getCampaignById', () => {
    it('returns campaign by id', () => {
      const advId = createAdvertiser(db, { name: 'Test' }).id;
      const camp = createCampaign(db, {
        advertiser_id: advId,
        name: 'Find Me',
        objective: 'traffic',
        total_budget: 50,
        pricing_model: 'cpc',
        bid_amount: 1,
      });
      const found = getCampaignById(db, camp.id);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Find Me');
    });

    it('returns null for nonexistent id', () => {
      expect(getCampaignById(db, 'nonexistent')).toBeNull();
    });
  });

  describe('getCampaignsByAdvertiser', () => {
    it('returns all campaigns for an advertiser', () => {
      const advId = createAdvertiser(db, { name: 'Test' }).id;
      createCampaign(db, { advertiser_id: advId, name: 'A', objective: 'traffic', total_budget: 10, pricing_model: 'cpc', bid_amount: 1 });
      createCampaign(db, { advertiser_id: advId, name: 'B', objective: 'traffic', total_budget: 20, pricing_model: 'cpc', bid_amount: 1 });
      const camps = getCampaignsByAdvertiser(db, advId);
      expect(camps).toHaveLength(2);
    });

    it('returns empty array for advertiser with no campaigns', () => {
      const advId = createAdvertiser(db, { name: 'Empty' }).id;
      expect(getCampaignsByAdvertiser(db, advId)).toEqual([]);
    });
  });

  describe('updateCampaignSpent', () => {
    it('increments spent amount', () => {
      const advId = createAdvertiser(db, { name: 'Test' }).id;
      const camp = createCampaign(db, { advertiser_id: advId, name: 'Spend', objective: 'traffic', total_budget: 100, pricing_model: 'cpc', bid_amount: 1 });
      updateCampaignSpent(db, camp.id, 5);
      updateCampaignSpent(db, camp.id, 3);
      const updated = getCampaignById(db, camp.id)!;
      expect(updated.spent).toBe(8);
    });
  });

  describe('updateCampaignStatus', () => {
    it('changes campaign status', () => {
      const advId = createAdvertiser(db, { name: 'Test' }).id;
      const camp = createCampaign(db, { advertiser_id: advId, name: 'Status', objective: 'traffic', total_budget: 100, pricing_model: 'cpc', bid_amount: 1 });
      expect(camp.status).toBe('active');
      updateCampaignStatus(db, camp.id, 'paused');
      const updated = getCampaignById(db, camp.id)!;
      expect(updated.status).toBe('paused');
    });
  });

  // ─── Ads ─────────────────────────────────────────────────────────────────────

  describe('createAd', () => {
    let campId: string;

    beforeEach(() => {
      const advId = createAdvertiser(db, { name: 'Test' }).id;
      campId = createCampaign(db, { advertiser_id: advId, name: 'Camp', objective: 'traffic', total_budget: 100, pricing_model: 'cpc', bid_amount: 1 }).id;
    });

    it('creates ad with full targeting', () => {
      const ad = createAd(db, {
        campaign_id: campId,
        creative_text: 'Buy our shoes!',
        link_url: 'https://example.com/shoes',
        keywords: ['shoes', 'sneakers'],
        categories: ['footwear'],
        geo: 'US',
        language: 'en',
      });
      expect(ad.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(ad.creative_text).toBe('Buy our shoes!');
      expect(ad.keywords).toEqual(['shoes', 'sneakers']);
      expect(ad.categories).toEqual(['footwear']);
      expect(ad.geo).toBe('US');
      expect(ad.language).toBe('en');
      expect(ad.quality_score).toBe(1.0);
      expect(ad.impressions).toBe(0);
      expect(ad.clicks).toBe(0);
      expect(ad.conversions).toBe(0);
      expect(ad.spend).toBe(0);
      expect(ad.status).toBe('active');
    });

    it('creates ad with defaults (geo=ALL, language=en, categories=[])', () => {
      const ad = createAd(db, {
        campaign_id: campId,
        creative_text: 'Minimal ad',
        link_url: 'https://example.com',
        keywords: ['test'],
      });
      expect(ad.geo).toBe('ALL');
      expect(ad.language).toBe('en');
      expect(ad.categories).toEqual([]);
    });
  });

  describe('getAdById', () => {
    it('returns ad by id with parsed JSON fields', () => {
      const advId = createAdvertiser(db, { name: 'Test' }).id;
      const campId = createCampaign(db, { advertiser_id: advId, name: 'C', objective: 'traffic', total_budget: 100, pricing_model: 'cpc', bid_amount: 1 }).id;
      const ad = createAd(db, { campaign_id: campId, creative_text: 'Text', link_url: 'http://x.com', keywords: ['a', 'b'] });
      const found = getAdById(db, ad.id);
      expect(found).not.toBeNull();
      expect(found!.keywords).toEqual(['a', 'b']);
    });

    it('returns null for nonexistent id', () => {
      expect(getAdById(db, 'nonexistent')).toBeNull();
    });
  });

  describe('getAdsByCampaign', () => {
    it('returns all ads for a campaign', () => {
      const advId = createAdvertiser(db, { name: 'Test' }).id;
      const campId = createCampaign(db, { advertiser_id: advId, name: 'C', objective: 'traffic', total_budget: 100, pricing_model: 'cpc', bid_amount: 1 }).id;
      createAd(db, { campaign_id: campId, creative_text: 'A1', link_url: 'http://x.com', keywords: ['a'] });
      createAd(db, { campaign_id: campId, creative_text: 'A2', link_url: 'http://y.com', keywords: ['b'] });
      const ads = getAdsByCampaign(db, campId);
      expect(ads).toHaveLength(2);
    });
  });

  describe('getActiveAds', () => {
    let advId: string;

    beforeEach(() => {
      advId = createAdvertiser(db, { name: 'Test' }).id;
    });

    it('returns ads from active campaigns with budget', () => {
      const campId = createCampaign(db, { advertiser_id: advId, name: 'Active', objective: 'traffic', total_budget: 100, pricing_model: 'cpc', bid_amount: 1 }).id;
      createAd(db, { campaign_id: campId, creative_text: 'Active Ad', link_url: 'http://x.com', keywords: ['k'] });
      const ads = getActiveAds(db);
      expect(ads).toHaveLength(1);
    });

    it('excludes ads from paused campaigns', () => {
      const campId = createCampaign(db, { advertiser_id: advId, name: 'Paused', objective: 'traffic', total_budget: 100, pricing_model: 'cpc', bid_amount: 1 }).id;
      createAd(db, { campaign_id: campId, creative_text: 'Paused Ad', link_url: 'http://x.com', keywords: ['k'] });
      updateCampaignStatus(db, campId, 'paused');
      const ads = getActiveAds(db);
      expect(ads).toHaveLength(0);
    });

    it('excludes ads from budget-exhausted campaigns', () => {
      const campId = createCampaign(db, { advertiser_id: advId, name: 'Exhausted', objective: 'traffic', total_budget: 10, pricing_model: 'cpc', bid_amount: 1 }).id;
      createAd(db, { campaign_id: campId, creative_text: 'Exhausted Ad', link_url: 'http://x.com', keywords: ['k'] });
      updateCampaignSpent(db, campId, 10); // spent == total
      const ads = getActiveAds(db);
      expect(ads).toHaveLength(0);
    });

    it('filters by geo (ALL always included)', () => {
      const campId = createCampaign(db, { advertiser_id: advId, name: 'Geo', objective: 'traffic', total_budget: 100, pricing_model: 'cpc', bid_amount: 1 }).id;
      createAd(db, { campaign_id: campId, creative_text: 'US only', link_url: 'http://x.com', keywords: ['k'], geo: 'US' });
      createAd(db, { campaign_id: campId, creative_text: 'All geo', link_url: 'http://y.com', keywords: ['k'], geo: 'ALL' });

      const usAds = getActiveAds(db, { geo: 'US' });
      expect(usAds).toHaveLength(2);

      const ukAds = getActiveAds(db, { geo: 'UK' });
      expect(ukAds).toHaveLength(1);
      expect(ukAds[0].creative_text).toBe('All geo');
    });

    it('filters by language', () => {
      const campId = createCampaign(db, { advertiser_id: advId, name: 'Lang', objective: 'traffic', total_budget: 100, pricing_model: 'cpc', bid_amount: 1 }).id;
      createAd(db, { campaign_id: campId, creative_text: 'English', link_url: 'http://x.com', keywords: ['k'], language: 'en' });
      createAd(db, { campaign_id: campId, creative_text: 'Spanish', link_url: 'http://y.com', keywords: ['k'], language: 'es' });

      const enAds = getActiveAds(db, { language: 'en' });
      expect(enAds).toHaveLength(1);
      expect(enAds[0].creative_text).toBe('English');

      const esAds = getActiveAds(db, { language: 'es' });
      expect(esAds).toHaveLength(1);
      expect(esAds[0].creative_text).toBe('Spanish');
    });
  });

  describe('updateAdStats', () => {
    it('increments impression count and spend', () => {
      const advId = createAdvertiser(db, { name: 'Test' }).id;
      const campId = createCampaign(db, { advertiser_id: advId, name: 'C', objective: 'traffic', total_budget: 100, pricing_model: 'cpc', bid_amount: 1 }).id;
      const ad = createAd(db, { campaign_id: campId, creative_text: 'Text', link_url: 'http://x.com', keywords: ['k'] });

      updateAdStats(db, ad.id, 'impression', 0);
      updateAdStats(db, ad.id, 'impression', 0);
      const updated = getAdById(db, ad.id)!;
      expect(updated.impressions).toBe(2);
      expect(updated.clicks).toBe(0);
      expect(updated.spend).toBe(0);
    });

    it('increments click count and spend', () => {
      const advId = createAdvertiser(db, { name: 'Test' }).id;
      const campId = createCampaign(db, { advertiser_id: advId, name: 'C', objective: 'traffic', total_budget: 100, pricing_model: 'cpc', bid_amount: 0.5 }).id;
      const ad = createAd(db, { campaign_id: campId, creative_text: 'Text', link_url: 'http://x.com', keywords: ['k'] });

      updateAdStats(db, ad.id, 'click', 0.5);
      const updated = getAdById(db, ad.id)!;
      expect(updated.clicks).toBe(1);
      expect(updated.spend).toBe(0.5);
    });

    it('increments conversion count and spend', () => {
      const advId = createAdvertiser(db, { name: 'Test' }).id;
      const campId = createCampaign(db, { advertiser_id: advId, name: 'C', objective: 'conversions', total_budget: 100, pricing_model: 'cpa', bid_amount: 5 }).id;
      const ad = createAd(db, { campaign_id: campId, creative_text: 'Text', link_url: 'http://x.com', keywords: ['k'] });

      updateAdStats(db, ad.id, 'conversion', 5);
      const updated = getAdById(db, ad.id)!;
      expect(updated.conversions).toBe(1);
      expect(updated.spend).toBe(5);
    });

    it('accumulates stats across multiple events', () => {
      const advId = createAdvertiser(db, { name: 'Test' }).id;
      const campId = createCampaign(db, { advertiser_id: advId, name: 'C', objective: 'traffic', total_budget: 100, pricing_model: 'cpc', bid_amount: 0.5 }).id;
      const ad = createAd(db, { campaign_id: campId, creative_text: 'Text', link_url: 'http://x.com', keywords: ['k'] });

      updateAdStats(db, ad.id, 'impression', 0);
      updateAdStats(db, ad.id, 'impression', 0);
      updateAdStats(db, ad.id, 'click', 0.5);
      updateAdStats(db, ad.id, 'click', 0.5);
      updateAdStats(db, ad.id, 'conversion', 0);

      const updated = getAdById(db, ad.id)!;
      expect(updated.impressions).toBe(2);
      expect(updated.clicks).toBe(2);
      expect(updated.conversions).toBe(1);
      expect(updated.spend).toBe(1.0);
    });
  });

  // ─── Events ──────────────────────────────────────────────────────────────────

  describe('insertEvent', () => {
    let adId: string;
    let devId: string;

    beforeEach(() => {
      const advId = createAdvertiser(db, { name: 'Adv' }).id;
      devId = createDeveloper(db, { name: 'Dev' }).id;
      const campId = createCampaign(db, { advertiser_id: advId, name: 'C', objective: 'traffic', total_budget: 100, pricing_model: 'cpc', bid_amount: 0.5 }).id;
      adId = createAd(db, { campaign_id: campId, creative_text: 'Text', link_url: 'http://x.com', keywords: ['k'] }).id;
    });

    it('inserts event with all fields', () => {
      const event = insertEvent(db, {
        ad_id: adId,
        developer_id: devId,
        event_type: 'click',
        amount_charged: 0.50,
        developer_revenue: 0.35,
        platform_revenue: 0.15,
        context_hash: 'abc123',
      });
      expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(event.event_type).toBe('click');
      expect(event.amount_charged).toBe(0.50);
      expect(event.developer_revenue).toBe(0.35);
      expect(event.platform_revenue).toBe(0.15);
      expect(event.context_hash).toBe('abc123');
      expect(event.metadata).toEqual({});
    });

    it('inserts event with metadata', () => {
      const event = insertEvent(db, {
        ad_id: adId,
        developer_id: devId,
        event_type: 'impression',
        amount_charged: 0,
        developer_revenue: 0,
        platform_revenue: 0,
        metadata: { source: 'test' },
      });
      expect(event.metadata).toEqual({ source: 'test' });
    });
  });

  describe('getEventsByAd', () => {
    it('returns all events for an ad', () => {
      const advId = createAdvertiser(db, { name: 'Adv' }).id;
      const devId = createDeveloper(db, { name: 'Dev' }).id;
      const campId = createCampaign(db, { advertiser_id: advId, name: 'C', objective: 'traffic', total_budget: 100, pricing_model: 'cpc', bid_amount: 1 }).id;
      const adId = createAd(db, { campaign_id: campId, creative_text: 'Text', link_url: 'http://x.com', keywords: ['k'] }).id;

      insertEvent(db, { ad_id: adId, developer_id: devId, event_type: 'impression', amount_charged: 0, developer_revenue: 0, platform_revenue: 0 });
      insertEvent(db, { ad_id: adId, developer_id: devId, event_type: 'click', amount_charged: 1, developer_revenue: 0.7, platform_revenue: 0.3 });

      const events = getEventsByAd(db, adId);
      expect(events).toHaveLength(2);
    });
  });

  // ─── API Keys ────────────────────────────────────────────────────────────────

  describe('createApiKey / findApiKey', () => {
    it('creates and finds API key by hash', () => {
      const key = createApiKey(db, { key_hash: 'hash123', entity_type: 'advertiser', entity_id: 'adv-1' });
      expect(key.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(key.entity_type).toBe('advertiser');

      const found = findApiKey(db, 'hash123');
      expect(found).not.toBeNull();
      expect(found!.entity_id).toBe('adv-1');
    });

    it('returns null for nonexistent hash', () => {
      expect(findApiKey(db, 'nonexistent')).toBeNull();
    });

    it('key_hash is unique', () => {
      createApiKey(db, { key_hash: 'dup', entity_type: 'advertiser', entity_id: 'a' });
      expect(() =>
        createApiKey(db, { key_hash: 'dup', entity_type: 'developer', entity_id: 'b' }),
      ).toThrow();
    });
  });
});
