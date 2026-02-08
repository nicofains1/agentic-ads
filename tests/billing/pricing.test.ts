// ──────────────────────────────────────────────────────────────────────────────
// Billing & Revenue tests — pricing models, revenue split, budget lifecycle
// Tests the billing logic from the report_event flow (simulated at DB level)
// ──────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDatabase,
  createAdvertiser,
  createDeveloper,
  createCampaign,
  createAd,
  getCampaignById,
  getAdById,
  insertEvent,
  updateAdStats,
  updateCampaignSpent,
  updateCampaignStatus,
} from '../../src/db/index.js';

type DB = ReturnType<typeof initDatabase>;

// Simulates report_event billing logic
function processEvent(db: DB, params: {
  ad_id: string;
  developer_id: string;
  event_type: 'impression' | 'click' | 'conversion';
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

  const processTransaction = db.transaction(() => {
    const event = insertEvent(db, {
      ad_id: params.ad_id,
      developer_id: params.developer_id,
      event_type: params.event_type,
      amount_charged: cost,
      developer_revenue: developerRevenue,
      platform_revenue: platformRevenue,
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

  const event = processTransaction();

  return {
    event_id: event.id,
    event_type: params.event_type,
    amount_charged: cost,
    developer_revenue: developerRevenue,
    platform_revenue: platformRevenue,
    remaining_budget: campaign.total_budget - campaign.spent - cost,
  };
}

describe('Billing & Revenue', () => {
  let db: DB;
  let developerId: string;

  beforeEach(() => {
    db = initDatabase(':memory:');
    developerId = createDeveloper(db, { name: 'TestBot' }).id;
  });

  function setupCampaign(pricing_model: 'cpc' | 'cpm' | 'cpa', bid_amount: number, total_budget: number) {
    const advId = createAdvertiser(db, { name: 'TestBrand' }).id;
    const campId = createCampaign(db, {
      advertiser_id: advId,
      name: `${pricing_model.toUpperCase()} Campaign`,
      objective: pricing_model === 'cpa' ? 'conversions' : 'traffic',
      total_budget,
      pricing_model,
      bid_amount,
    }).id;
    const adId = createAd(db, {
      campaign_id: campId,
      creative_text: 'Test Ad',
      link_url: 'https://example.com',
      keywords: ['test'],
    }).id;
    return { campId, adId };
  }

  // ─── CPC Pricing ───────────────────────────────────────────────────────────

  describe('CPC (Cost Per Click)', () => {
    it('charges on click', () => {
      const { adId } = setupCampaign('cpc', 0.50, 100);
      const result = processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'click' });
      expect(result.amount_charged).toBe(0.50);
    });

    it('impression is free for CPC', () => {
      const { adId } = setupCampaign('cpc', 0.50, 100);
      const result = processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'impression' });
      expect(result.amount_charged).toBe(0);
      expect(result.developer_revenue).toBe(0);
    });

    it('conversion is free for CPC', () => {
      const { adId } = setupCampaign('cpc', 0.50, 100);
      const result = processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'conversion' });
      expect(result.amount_charged).toBe(0);
    });

    it('amount = bid_amount on click', () => {
      const { adId } = setupCampaign('cpc', 1.25, 100);
      const result = processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'click' });
      expect(result.amount_charged).toBe(1.25);
    });
  });

  // ─── CPM Pricing ───────────────────────────────────────────────────────────

  describe('CPM (Cost Per Mille)', () => {
    it('charges on impression at bid/1000', () => {
      const { adId } = setupCampaign('cpm', 15, 100);
      const result = processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'impression' });
      expect(result.amount_charged).toBe(0.015);
    });

    it('click is free for CPM', () => {
      const { adId } = setupCampaign('cpm', 15, 100);
      const result = processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'click' });
      expect(result.amount_charged).toBe(0);
    });

    it('conversion is free for CPM', () => {
      const { adId } = setupCampaign('cpm', 15, 100);
      const result = processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'conversion' });
      expect(result.amount_charged).toBe(0);
    });
  });

  // ─── CPA Pricing ───────────────────────────────────────────────────────────

  describe('CPA (Cost Per Action)', () => {
    it('charges on conversion', () => {
      const { adId } = setupCampaign('cpa', 5.00, 100);
      const result = processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'conversion' });
      expect(result.amount_charged).toBe(5.00);
    });

    it('impression is free for CPA', () => {
      const { adId } = setupCampaign('cpa', 5.00, 100);
      const result = processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'impression' });
      expect(result.amount_charged).toBe(0);
    });

    it('click is free for CPA (no conversion)', () => {
      const { adId } = setupCampaign('cpa', 5.00, 100);
      const result = processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'click' });
      expect(result.amount_charged).toBe(0);
    });

    it('amount = bid_amount on conversion', () => {
      const { adId } = setupCampaign('cpa', 5.00, 100);
      const result = processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'conversion' });
      expect(result.amount_charged).toBe(5.00);
    });
  });

  // ─── Revenue Split ─────────────────────────────────────────────────────────

  describe('Revenue Split: 70% developer / 30% platform', () => {
    it('CPC click $0.50 → dev $0.35, platform $0.15', () => {
      const { adId } = setupCampaign('cpc', 0.50, 100);
      const result = processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'click' });
      expect(result.developer_revenue).toBe(0.35);
      expect(result.platform_revenue).toBe(0.15);
    });

    it('CPM impression (bid=$15) → dev $0.0105, platform $0.0045', () => {
      const { adId } = setupCampaign('cpm', 15, 100);
      const result = processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'impression' });
      expect(result.developer_revenue).toBeCloseTo(0.0105, 4);
      expect(result.platform_revenue).toBeCloseTo(0.0045, 4);
    });

    it('CPA conversion (bid=$5) → dev $3.50, platform $1.50', () => {
      const { adId } = setupCampaign('cpa', 5.00, 100);
      const result = processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'conversion' });
      expect(result.developer_revenue).toBe(3.50);
      expect(result.platform_revenue).toBe(1.50);
    });

    it('non-billable events → $0 / $0 / $0', () => {
      const { adId } = setupCampaign('cpc', 0.50, 100);
      const result = processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'impression' });
      expect(result.amount_charged).toBe(0);
      expect(result.developer_revenue).toBe(0);
      expect(result.platform_revenue).toBe(0);
    });

    it('dev_revenue + platform_revenue = amount_charged', () => {
      const { adId } = setupCampaign('cpc', 0.50, 100);
      const result = processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'click' });
      expect(result.developer_revenue! + result.platform_revenue!).toBeCloseTo(result.amount_charged!, 10);
    });

    it('revenue split stored correctly in DB', () => {
      const { adId } = setupCampaign('cpc', 0.50, 100);
      processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'click' });
      const events = db.prepare('SELECT * FROM events WHERE ad_id = ?').all(adId) as Array<{
        amount_charged: number;
        developer_revenue: number;
        platform_revenue: number;
      }>;
      expect(events[0].developer_revenue).toBe(0.35);
      expect(events[0].platform_revenue).toBe(0.15);
    });
  });

  // ─── Budget Lifecycle ──────────────────────────────────────────────────────

  describe('Budget Lifecycle', () => {
    it('CPC budget exhaustion: $10 budget, $0.50 bid → 20 clicks → paused', () => {
      const { adId, campId } = setupCampaign('cpc', 0.50, 10);
      for (let i = 0; i < 20; i++) {
        const result = processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'click' });
        if ('error' in result) {
          expect(i).toBeGreaterThanOrEqual(19);
          break;
        }
      }
      const campaign = getCampaignById(db, campId)!;
      expect(campaign.status).toBe('paused');
      expect(campaign.spent).toBe(10);
    });

    it('CPC click 21 → error "Campaign budget exhausted"', () => {
      const { adId } = setupCampaign('cpc', 0.50, 10);
      for (let i = 0; i < 20; i++) {
        processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'click' });
      }
      const result = processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'click' });
      expect(result).toHaveProperty('error');
    });

    it('CPC impressions are free (do not exhaust budget)', () => {
      const { adId, campId } = setupCampaign('cpc', 0.50, 10);
      // 100 impressions on CPC = $0
      for (let i = 0; i < 100; i++) {
        processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'impression' });
      }
      const campaign = getCampaignById(db, campId)!;
      expect(campaign.status).toBe('active');
      expect(campaign.spent).toBe(0);
    });

    it('CPM budget exhaustion: $50 budget, $15 bid → ~3333 impressions', () => {
      const { adId, campId } = setupCampaign('cpm', 15, 0.15); // small budget for speed
      const costPerImpression = 15 / 1000; // $0.015
      const maxImpressions = Math.floor(0.15 / costPerImpression); // 10

      for (let i = 0; i < maxImpressions; i++) {
        processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'impression' });
      }
      const campaign = getCampaignById(db, campId)!;
      expect(campaign.status).toBe('paused');
    });

    it('CPM clicks are free', () => {
      const { adId, campId } = setupCampaign('cpm', 15, 100);
      for (let i = 0; i < 10; i++) {
        processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'click' });
      }
      const campaign = getCampaignById(db, campId)!;
      expect(campaign.spent).toBe(0);
    });

    it('CPA budget exhaustion: $100 budget, $5 bid → 20 conversions', () => {
      const { adId, campId } = setupCampaign('cpa', 5.00, 25); // small budget
      for (let i = 0; i < 5; i++) {
        processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'conversion' });
      }
      const campaign = getCampaignById(db, campId)!;
      expect(campaign.status).toBe('paused');
      expect(campaign.spent).toBe(25);
    });

    it('CPA impressions and clicks are free', () => {
      const { adId, campId } = setupCampaign('cpa', 5.00, 100);
      for (let i = 0; i < 10; i++) {
        processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'impression' });
        processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'click' });
      }
      const campaign = getCampaignById(db, campId)!;
      expect(campaign.spent).toBe(0);
      expect(campaign.status).toBe('active');
    });

    it('remaining_budget calculated correctly', () => {
      const { adId } = setupCampaign('cpc', 0.50, 10);
      const r1 = processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'click' });
      expect(r1.remaining_budget).toBe(9.50);

      const r2 = processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'click' });
      expect(r2.remaining_budget).toBe(9.00);
    });
  });

  // ─── Atomicity ─────────────────────────────────────────────────────────────

  describe('Atomicity (transaction)', () => {
    it('event + stats + spend updated atomically', () => {
      const { adId, campId } = setupCampaign('cpc', 0.50, 100);
      processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'click' });

      const ad = getAdById(db, adId)!;
      expect(ad.clicks).toBe(1);
      expect(ad.spend).toBe(0.50);

      const campaign = getCampaignById(db, campId)!;
      expect(campaign.spent).toBe(0.50);

      const events = db.prepare('SELECT COUNT(*) as cnt FROM events WHERE ad_id = ?').get(adId) as { cnt: number };
      expect(events.cnt).toBe(1);
    });

    it('multiple events accumulate correctly', () => {
      const { adId, campId } = setupCampaign('cpc', 0.50, 100);
      processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'impression' });
      processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'impression' });
      processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'click' });
      processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'click' });
      processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'conversion' });

      const ad = getAdById(db, adId)!;
      expect(ad.impressions).toBe(2);
      expect(ad.clicks).toBe(2);
      expect(ad.conversions).toBe(1);
      expect(ad.spend).toBe(1.00); // 2 clicks × $0.50

      const campaign = getCampaignById(db, campId)!;
      expect(campaign.spent).toBe(1.00);
    });

    it('transaction rollback: failed insert rolls back all changes', () => {
      const { adId, campId } = setupCampaign('cpc', 0.50, 100);

      // Simulate a transaction that partially succeeds then throws
      const brokenTransaction = db.transaction(() => {
        insertEvent(db, {
          ad_id: adId,
          developer_id: developerId,
          event_type: 'click',
          amount_charged: 0.50,
          developer_revenue: 0.35,
          platform_revenue: 0.15,
        });
        updateAdStats(db, adId, 'click', 0.50);
        updateCampaignSpent(db, campId, 0.50);
        // Simulate failure after all writes
        throw new Error('simulated crash');
      });

      expect(() => brokenTransaction()).toThrow('simulated crash');

      // Everything should be rolled back
      const ad = getAdById(db, adId)!;
      expect(ad.clicks).toBe(0);
      expect(ad.spend).toBe(0);

      const campaign = getCampaignById(db, campId)!;
      expect(campaign.spent).toBe(0);

      const events = db.prepare('SELECT COUNT(*) as cnt FROM events WHERE ad_id = ?').get(adId) as { cnt: number };
      expect(events.cnt).toBe(0);
    });
  });

  // ─── Error Paths ───────────────────────────────────────────────────────────

  describe('Error Paths', () => {
    it('ad not found throws', () => {
      expect(() =>
        processEvent(db, { ad_id: 'nonexistent', developer_id: developerId, event_type: 'click' }),
      ).toThrow('Ad not found');
    });

    it('paused campaign returns error', () => {
      const { adId, campId } = setupCampaign('cpc', 0.50, 100);
      updateCampaignStatus(db, campId, 'paused');
      const result = processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'click' });
      expect(result).toHaveProperty('error', 'Campaign not active');
      expect(result.campaign_paused).toBe(true);
    });

    it('budget exhausted returns error', () => {
      const { adId, campId } = setupCampaign('cpc', 10, 5);
      // spent=0, cost=10 > budget=5 → exhausted
      const result = processEvent(db, { ad_id: adId, developer_id: developerId, event_type: 'click' });
      expect(result).toHaveProperty('error', 'Campaign budget exhausted');
    });
  });
});
