import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase } from '../../src/db/index.js';

type DB = ReturnType<typeof initDatabase>;

describe('Database Schema', () => {
  let db: DB;

  beforeEach(() => {
    db = initDatabase(':memory:');
  });

  describe('Settings', () => {
    it('sets WAL journal mode (verified on file-based DB)', () => {
      const tmpPath = '/tmp/test-wal-' + Date.now() + '.db';
      const fileDb = initDatabase(tmpPath);
      const row = fileDb.pragma('journal_mode') as Array<{ journal_mode: string }>;
      expect(row[0].journal_mode).toBe('wal');
      fileDb.close();
    });

    it('has foreign keys enabled', () => {
      const row = db.pragma('foreign_keys') as Array<{ foreign_keys: number }>;
      expect(row[0].foreign_keys).toBe(1);
    });
  });

  describe('Tables exist', () => {
    const tables = ['advertisers', 'developers', 'campaigns', 'ads', 'events', 'api_keys'];

    for (const table of tables) {
      it(`table "${table}" exists`, () => {
        const row = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
          .get(table) as { name: string } | undefined;
        expect(row).toBeDefined();
        expect(row!.name).toBe(table);
      });
    }
  });

  describe('Table columns', () => {
    it('advertisers: id, name, company, email, created_at', () => {
      const cols = db.pragma('table_info(advertisers)') as Array<{ name: string }>;
      const names = cols.map((c) => c.name);
      expect(names).toEqual(expect.arrayContaining(['id', 'name', 'company', 'email', 'created_at']));
    });

    it('developers: id, name, email, reputation_score, created_at', () => {
      const cols = db.pragma('table_info(developers)') as Array<{ name: string }>;
      const names = cols.map((c) => c.name);
      expect(names).toEqual(expect.arrayContaining(['id', 'name', 'email', 'reputation_score', 'created_at']));
    });

    it('campaigns: all required columns', () => {
      const cols = db.pragma('table_info(campaigns)') as Array<{ name: string }>;
      const names = cols.map((c) => c.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'id', 'advertiser_id', 'name', 'objective', 'status',
          'total_budget', 'daily_budget', 'spent', 'pricing_model',
          'bid_amount', 'start_date', 'end_date', 'created_at',
        ]),
      );
    });

    it('ads: all required columns', () => {
      const cols = db.pragma('table_info(ads)') as Array<{ name: string }>;
      const names = cols.map((c) => c.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'id', 'campaign_id', 'creative_text', 'link_url', 'keywords',
          'categories', 'geo', 'language', 'status', 'quality_score',
          'impressions', 'clicks', 'conversions', 'spend', 'created_at',
        ]),
      );
    });

    it('events: all required columns', () => {
      const cols = db.pragma('table_info(events)') as Array<{ name: string }>;
      const names = cols.map((c) => c.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'id', 'ad_id', 'developer_id', 'event_type',
          'amount_charged', 'developer_revenue', 'platform_revenue',
          'context_hash', 'metadata', 'created_at',
        ]),
      );
    });

    it('api_keys: id, key_hash, entity_type, entity_id, created_at', () => {
      const cols = db.pragma('table_info(api_keys)') as Array<{ name: string }>;
      const names = cols.map((c) => c.name);
      expect(names).toEqual(expect.arrayContaining(['id', 'key_hash', 'entity_type', 'entity_id', 'created_at']));
    });
  });

  describe('Constraints', () => {
    it('campaign.status must be draft|active|paused|completed', () => {
      const advId = 'test-adv';
      db.prepare('INSERT INTO advertisers (id, name) VALUES (?, ?)').run(advId, 'Test');

      // Valid statuses work
      for (const status of ['draft', 'active', 'paused', 'completed']) {
        const id = `camp-${status}`;
        expect(() =>
          db.prepare(
            `INSERT INTO campaigns (id, advertiser_id, name, objective, status, total_budget, pricing_model, bid_amount)
             VALUES (?, ?, ?, 'traffic', ?, 100, 'cpc', 1.0)`,
          ).run(id, advId, `Test ${status}`, status),
        ).not.toThrow();
      }

      // Invalid status throws
      expect(() =>
        db.prepare(
          `INSERT INTO campaigns (id, advertiser_id, name, objective, status, total_budget, pricing_model, bid_amount)
           VALUES ('bad', ?, 'Bad', 'traffic', 'invalid', 100, 'cpc', 1.0)`,
        ).run(advId),
      ).toThrow();
    });

    it('ad.status must be pending|active|paused', () => {
      const advId = 'adv-1';
      const campId = 'camp-1';
      db.prepare('INSERT INTO advertisers (id, name) VALUES (?, ?)').run(advId, 'Test');
      db.prepare(
        `INSERT INTO campaigns (id, advertiser_id, name, objective, total_budget, pricing_model, bid_amount)
         VALUES (?, ?, 'Test', 'traffic', 100, 'cpc', 1.0)`,
      ).run(campId, advId);

      for (const status of ['pending', 'active', 'paused']) {
        expect(() =>
          db.prepare(
            `INSERT INTO ads (id, campaign_id, creative_text, link_url, keywords, status)
             VALUES (?, ?, 'text', 'http://x.com', '["k"]', ?)`,
          ).run(`ad-${status}`, campId, status),
        ).not.toThrow();
      }

      expect(() =>
        db.prepare(
          `INSERT INTO ads (id, campaign_id, creative_text, link_url, keywords, status)
           VALUES ('bad-ad', ?, 'text', 'http://x.com', '["k"]', 'invalid')`,
        ).run(campId),
      ).toThrow();
    });

    it('event.event_type must be impression|click|conversion', () => {
      const advId = 'adv-2';
      const campId = 'camp-2';
      const adId = 'ad-2';
      const devId = 'dev-2';
      db.prepare('INSERT INTO advertisers (id, name) VALUES (?, ?)').run(advId, 'Test');
      db.prepare('INSERT INTO developers (id, name) VALUES (?, ?)').run(devId, 'Dev');
      db.prepare(
        `INSERT INTO campaigns (id, advertiser_id, name, objective, total_budget, pricing_model, bid_amount)
         VALUES (?, ?, 'Test', 'traffic', 100, 'cpc', 1.0)`,
      ).run(campId, advId);
      db.prepare(
        `INSERT INTO ads (id, campaign_id, creative_text, link_url, keywords)
         VALUES (?, ?, 'text', 'http://x.com', '["k"]')`,
      ).run(adId, campId);

      for (const eventType of ['impression', 'click', 'conversion']) {
        expect(() =>
          db.prepare(
            `INSERT INTO events (id, ad_id, developer_id, event_type)
             VALUES (?, ?, ?, ?)`,
          ).run(`evt-${eventType}`, adId, devId, eventType),
        ).not.toThrow();
      }

      expect(() =>
        db.prepare(
          `INSERT INTO events (id, ad_id, developer_id, event_type)
           VALUES ('bad-evt', ?, ?, 'purchase')`,
        ).run(adId, devId),
      ).toThrow();
    });

    it('campaign.pricing_model must be cpm|cpc|cpa|hybrid', () => {
      const advId = 'adv-pm';
      db.prepare('INSERT INTO advertisers (id, name) VALUES (?, ?)').run(advId, 'Test');

      for (const model of ['cpm', 'cpc', 'cpa', 'hybrid']) {
        expect(() =>
          db.prepare(
            `INSERT INTO campaigns (id, advertiser_id, name, objective, total_budget, pricing_model, bid_amount)
             VALUES (?, ?, 'Test', 'traffic', 100, ?, 1.0)`,
          ).run(`camp-${model}`, advId, model),
        ).not.toThrow();
      }

      expect(() =>
        db.prepare(
          `INSERT INTO campaigns (id, advertiser_id, name, objective, total_budget, pricing_model, bid_amount)
           VALUES ('bad-pm', ?, 'Bad', 'traffic', 100, 'flat_rate', 1.0)`,
        ).run(advId),
      ).toThrow();
    });

    it('api_key.entity_type must be advertiser|developer', () => {
      for (const type of ['advertiser', 'developer']) {
        expect(() =>
          db.prepare(
            `INSERT INTO api_keys (id, key_hash, entity_type, entity_id) VALUES (?, ?, ?, 'some-id')`,
          ).run(`key-${type}`, `hash-${type}`, type),
        ).not.toThrow();
      }

      expect(() =>
        db.prepare(
          `INSERT INTO api_keys (id, key_hash, entity_type, entity_id) VALUES ('bad-key', 'hash-bad', 'admin', 'some-id')`,
        ).run(),
      ).toThrow();
    });

    it('foreign keys enforced: campaign needs valid advertiser_id', () => {
      expect(() =>
        db.prepare(
          `INSERT INTO campaigns (id, advertiser_id, name, objective, total_budget, pricing_model, bid_amount)
           VALUES ('orphan', 'nonexistent', 'Test', 'traffic', 100, 'cpc', 1.0)`,
        ).run(),
      ).toThrow();
    });

    it('foreign keys enforced: ad needs valid campaign_id', () => {
      expect(() =>
        db.prepare(
          `INSERT INTO ads (id, campaign_id, creative_text, link_url, keywords)
           VALUES ('orphan-ad', 'nonexistent', 'text', 'http://x.com', '["k"]')`,
        ).run(),
      ).toThrow();
    });
  });

  describe('Indices', () => {
    it('has index on ads(campaign_id)', () => {
      const idx = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_ads_campaign_id'")
        .get();
      expect(idx).toBeDefined();
    });

    it('has index on ads(status)', () => {
      const idx = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_ads_status'")
        .get();
      expect(idx).toBeDefined();
    });

    it('has index on campaigns(advertiser_id)', () => {
      const idx = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_campaigns_advertiser'")
        .get();
      expect(idx).toBeDefined();
    });

    it('has index on campaigns(status)', () => {
      const idx = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_campaigns_status'")
        .get();
      expect(idx).toBeDefined();
    });

    it('has index on events(ad_id)', () => {
      const idx = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_events_ad_id'")
        .get();
      expect(idx).toBeDefined();
    });

    it('has index on events(developer_id)', () => {
      const idx = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_events_developer_id'")
        .get();
      expect(idx).toBeDefined();
    });

    it('has index on events(created_at)', () => {
      const idx = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_events_created_at'")
        .get();
      expect(idx).toBeDefined();
    });

    it('has index on api_keys(key_hash)', () => {
      const idx = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_api_keys_key_hash'")
        .get();
      expect(idx).toBeDefined();
    });
  });
});
