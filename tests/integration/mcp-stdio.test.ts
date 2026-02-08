// ──────────────────────────────────────────────────────────────────────────────
// MCP Integration Tests via StdioClientTransport (#34)
// Tests the full MCP protocol: tool listing, auth enforcement, all 6 tools
// This is the most realistic test — spawns the actual server as a child process
// ──────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';
import { mkdtempSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initDatabase, createAdvertiser, createDeveloper } from '../../src/db/index.js';
import { generateApiKey } from '../../src/auth/middleware.js';

const SERVER_PATH = resolve('dist/server.js');

// ─── Helper: create MCP client connected to server via stdio ──────────────────

async function createMcpClient(dbPath: string, apiKey: string): Promise<Client> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH, '--stdio', '--db', dbPath, '--api-key', apiKey],
  });
  const client = new Client({ name: 'integration-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

function parseToolResult(result: Awaited<ReturnType<Client['callTool']>>): { data: Record<string, unknown>; isError?: boolean } {
  const content = result.content as Array<{ type: string; text: string }>;
  return {
    data: JSON.parse(content[0]?.text ?? '{}'),
    isError: result.isError as boolean | undefined,
  };
}

// ─── Setup ──────────────────────────────────────────────────────────────────────

describe('MCP Integration: stdio transport', () => {
  let dbPath: string;
  let advKey: string;
  let devKey: string;
  let advertiserId: string;
  let developerId: string;

  beforeAll(() => {
    // Create temp DB and seed it
    const tmpDir = mkdtempSync(join(tmpdir(), 'agentic-ads-test-'));
    dbPath = join(tmpDir, 'test.db');

    const db = initDatabase(dbPath);
    const adv = createAdvertiser(db, { name: 'TestBrand', company: 'TestBrand Inc.' });
    advertiserId = adv.id;
    advKey = generateApiKey(db, 'advertiser', advertiserId);

    const dev = createDeveloper(db, { name: 'TestBot' });
    developerId = dev.id;
    devKey = generateApiKey(db, 'developer', developerId);

    db.close();
  });

  afterAll(() => {
    // Clean up temp DB files
    for (const suffix of ['', '-shm', '-wal']) {
      const f = dbPath + suffix;
      if (existsSync(f)) try { unlinkSync(f); } catch {}
    }
  });

  // ─── Tool Listing ──────────────────────────────────────────────────────────

  describe('Tool listing', () => {
    it('lists all 6 tools', async () => {
      const client = await createMcpClient(dbPath, advKey);
      try {
        const tools = await client.listTools();
        const names = tools.tools.map((t) => t.name).sort();
        expect(names).toEqual([
          'create_ad',
          'create_campaign',
          'get_ad_guidelines',
          'get_campaign_analytics',
          'report_event',
          'search_ads',
        ]);
      } finally {
        await client.close();
      }
    });
  });

  // ─── Advertiser Flow ───────────────────────────────────────────────────────

  describe('Advertiser flow via MCP', () => {
    let client: Client;
    let campaignId: string;
    let adId: string;

    beforeAll(async () => {
      client = await createMcpClient(dbPath, advKey);
    });

    afterAll(async () => {
      await client.close();
    });

    it('creates a CPC campaign', async () => {
      const result = await client.callTool({
        name: 'create_campaign',
        arguments: {
          name: 'Integration Test Campaign',
          objective: 'traffic',
          total_budget: 50,
          daily_budget: 10,
          pricing_model: 'cpc',
          bid_amount: 0.50,
        },
      });
      const { data, isError } = parseToolResult(result);
      expect(isError).toBeFalsy();
      expect(data.campaign_id).toBeDefined();
      expect(data.status).toBe('active');
      expect(data.pricing_model).toBe('cpc');
      campaignId = data.campaign_id as string;
    });

    it('creates an ad in the campaign', async () => {
      const result = await client.callTool({
        name: 'create_ad',
        arguments: {
          campaign_id: campaignId,
          creative_text: 'Amazing running shoes — 30% off!',
          link_url: 'https://example.com/shoes',
          keywords: ['running shoes', 'sneakers', 'athletic'],
          categories: ['footwear', 'sports'],
          geo: 'ALL',
          language: 'en',
        },
      });
      const { data, isError } = parseToolResult(result);
      expect(isError).toBeFalsy();
      expect(data.ad_id).toBeDefined();
      expect(data.status).toBe('active');
      expect(data.keywords).toEqual(['running shoes', 'sneakers', 'athletic']);
      adId = data.ad_id as string;
    });

    it('gets campaign analytics (no activity yet)', async () => {
      const result = await client.callTool({
        name: 'get_campaign_analytics',
        arguments: { campaign_id: campaignId },
      });
      const { data, isError } = parseToolResult(result);
      expect(isError).toBeFalsy();
      expect((data.totals as Record<string, number>).impressions).toBe(0);
      expect((data.totals as Record<string, number>).clicks).toBe(0);
      expect((data.budget as Record<string, number>).spent).toBe(0);
      expect((data.budget as Record<string, number>).remaining).toBe(50);
    });

    // ─── create_ad error paths ───────────────────────────────────────────────

    it('create_ad: campaign not found', async () => {
      const result = await client.callTool({
        name: 'create_ad',
        arguments: {
          campaign_id: 'nonexistent-campaign-id',
          creative_text: 'Test',
          link_url: 'https://example.com',
          keywords: ['test'],
        },
      });
      const { data, isError } = parseToolResult(result);
      expect(isError).toBe(true);
      expect(data.error).toBe('Campaign not found');
    });

    it('create_ad: campaign belongs to another advertiser', async () => {
      // Create another advertiser's campaign directly in DB
      const db = initDatabase(dbPath);
      const otherAdv = createAdvertiser(db, { name: 'OtherBrand' });
      const { createCampaign } = await import('../../src/db/index.js');
      const otherCampaign = createCampaign(db, {
        advertiser_id: otherAdv.id,
        name: 'Other Campaign',
        objective: 'traffic',
        total_budget: 100,
        pricing_model: 'cpc',
        bid_amount: 1,
      });
      db.close();

      const result = await client.callTool({
        name: 'create_ad',
        arguments: {
          campaign_id: otherCampaign.id,
          creative_text: 'Test',
          link_url: 'https://example.com',
          keywords: ['test'],
        },
      });
      const { data, isError } = parseToolResult(result);
      expect(isError).toBe(true);
      expect(data.error).toBe('Campaign does not belong to your account');
    });

    it('create_ad: campaign is not active (paused)', async () => {
      const db = initDatabase(dbPath);
      const { createCampaign, updateCampaignStatus } = await import('../../src/db/index.js');
      const pausedCampaign = createCampaign(db, {
        advertiser_id: advertiserId,
        name: 'Paused Campaign',
        objective: 'traffic',
        total_budget: 100,
        pricing_model: 'cpc',
        bid_amount: 1,
      });
      updateCampaignStatus(db, pausedCampaign.id, 'paused');
      db.close();

      const result = await client.callTool({
        name: 'create_ad',
        arguments: {
          campaign_id: pausedCampaign.id,
          creative_text: 'Test',
          link_url: 'https://example.com',
          keywords: ['test'],
        },
      });
      const { data, isError } = parseToolResult(result);
      expect(isError).toBe(true);
      expect(data.error).toBe('Campaign is not active');
    });

    // ─── create_ad Zod validation errors ────────────────────────────────────

    it('create_ad: creative_text > 500 chars → validation error', async () => {
      const result = await client.callTool({
        name: 'create_ad',
        arguments: {
          campaign_id: campaignId,
          creative_text: 'x'.repeat(501),
          link_url: 'https://example.com',
          keywords: ['test'],
        },
      });
      // Zod validation errors are returned as isError by the MCP SDK
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      expect(result.isError === true || text.toLowerCase().includes('error')).toBe(true);
    });

    it('create_ad: empty keywords array → validation error', async () => {
      const result = await client.callTool({
        name: 'create_ad',
        arguments: {
          campaign_id: campaignId,
          creative_text: 'Valid text',
          link_url: 'https://example.com',
          keywords: [],
        },
      });
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      expect(result.isError === true || text.toLowerCase().includes('error')).toBe(true);
    });

    it('create_ad: invalid link_url → validation error', async () => {
      const result = await client.callTool({
        name: 'create_ad',
        arguments: {
          campaign_id: campaignId,
          creative_text: 'Valid text',
          link_url: 'not-a-url',
          keywords: ['test'],
        },
      });
      const content = result.content as Array<{ type: string; text: string }>;
      const text = content[0]?.text ?? '';
      expect(result.isError === true || text.toLowerCase().includes('error')).toBe(true);
    });

    // ─── get_campaign_analytics error paths ──────────────────────────────────

    it('analytics: campaign not found', async () => {
      const result = await client.callTool({
        name: 'get_campaign_analytics',
        arguments: { campaign_id: 'nonexistent' },
      });
      const { data, isError } = parseToolResult(result);
      expect(isError).toBe(true);
      expect(data.error).toBe('Campaign not found');
    });

    it('analytics: campaign belongs to another advertiser', async () => {
      const db = initDatabase(dbPath);
      const otherAdv = createAdvertiser(db, { name: 'AnotherBrand' });
      const { createCampaign } = await import('../../src/db/index.js');
      const otherCampaign = createCampaign(db, {
        advertiser_id: otherAdv.id,
        name: 'Another Campaign',
        objective: 'traffic',
        total_budget: 50,
        pricing_model: 'cpc',
        bid_amount: 1,
      });
      db.close();

      const result = await client.callTool({
        name: 'get_campaign_analytics',
        arguments: { campaign_id: otherCampaign.id },
      });
      const { data, isError } = parseToolResult(result);
      expect(isError).toBe(true);
      expect(data.error).toBe('Campaign does not belong to your account');
    });
  });

  // ─── Consumer Flow ─────────────────────────────────────────────────────────

  describe('Consumer flow via MCP', () => {
    let client: Client;

    beforeAll(async () => {
      client = await createMcpClient(dbPath, devKey);
    });

    afterAll(async () => {
      await client.close();
    });

    it('get_ad_guidelines: returns rules and format', async () => {
      const result = await client.callTool({ name: 'get_ad_guidelines', arguments: {} });
      const { data } = parseToolResult(result);
      expect(data.rules).toBeDefined();
      expect((data.rules as unknown[]).length).toBe(7);
      expect(data.example_format).toBeDefined();
      expect(data.reporting_instructions).toBeDefined();
    });

    it('search_ads: finds relevant ads', async () => {
      const result = await client.callTool({
        name: 'search_ads',
        arguments: {
          query: 'best running shoes for marathon',
          keywords: ['running shoes', 'sneakers'],
          category: 'footwear',
          geo: 'US',
          language: 'en',
          max_results: 3,
        },
      });
      const { data } = parseToolResult(result);
      const ads = data.ads as Array<Record<string, unknown>>;
      expect(ads.length).toBeGreaterThan(0);
      expect(ads[0].relevance_score).toBeGreaterThan(0);
      expect(ads[0].disclosure).toBe('sponsored');
      expect(ads[0].ad_id).toBeDefined();
      expect(ads[0].creative_text).toBeDefined();
      expect(ads[0].link_url).toBeDefined();
      expect(ads[0].advertiser_name).toBeDefined();
    });

    it('search_ads: no results for unrelated language', async () => {
      const result = await client.callTool({
        name: 'search_ads',
        arguments: {
          query: 'running shoes',
          language: 'zh',
          max_results: 3,
        },
      });
      const { data } = parseToolResult(result);
      const ads = data.ads as unknown[];
      expect(ads.length).toBe(0);
    });

    it('search_ads: no ads when no query/keywords/category', async () => {
      const result = await client.callTool({
        name: 'search_ads',
        arguments: { geo: 'US', language: 'en', max_results: 3 },
      });
      const { data } = parseToolResult(result);
      const ads = data.ads as unknown[];
      expect(ads.length).toBe(0);
    });

    it('report_event: impression on CPC is free', async () => {
      // Get an ad_id from search
      const searchResult = await client.callTool({
        name: 'search_ads',
        arguments: { query: 'running shoes', language: 'en', max_results: 1 },
      });
      const { data: searchData } = parseToolResult(searchResult);
      const ads = searchData.ads as Array<Record<string, unknown>>;
      expect(ads.length).toBeGreaterThan(0);
      const adId = ads[0].ad_id as string;

      const result = await client.callTool({
        name: 'report_event',
        arguments: { ad_id: adId, event_type: 'impression' },
      });
      const { data, isError } = parseToolResult(result);
      expect(isError).toBeFalsy();
      expect(data.event_type).toBe('impression');
      expect(data.amount_charged).toBe(0);
    });

    it('report_event: click on CPC charges bid_amount', async () => {
      const searchResult = await client.callTool({
        name: 'search_ads',
        arguments: { query: 'running shoes', language: 'en', max_results: 1 },
      });
      const { data: searchData } = parseToolResult(searchResult);
      const adId = (searchData.ads as Array<Record<string, unknown>>)[0].ad_id as string;

      const result = await client.callTool({
        name: 'report_event',
        arguments: { ad_id: adId, event_type: 'click' },
      });
      const { data, isError } = parseToolResult(result);
      expect(isError).toBeFalsy();
      expect(data.event_type).toBe('click');
      expect(data.amount_charged).toBe(0.50);
      expect(data.developer_revenue).toBe(0.35);
    });

    it('report_event: ad not found', async () => {
      const result = await client.callTool({
        name: 'report_event',
        arguments: { ad_id: 'nonexistent-ad', event_type: 'impression' },
      });
      const { data, isError } = parseToolResult(result);
      expect(isError).toBe(true);
      expect(data.error).toBe('Ad not found');
    });
  });

  // ─── Auth Enforcement via MCP ──────────────────────────────────────────────

  describe('Auth enforcement via MCP protocol', () => {
    it('developer cannot call create_campaign', async () => {
      const client = await createMcpClient(dbPath, devKey);
      try {
        const result = await client.callTool({
          name: 'create_campaign',
          arguments: {
            name: 'Unauthorized',
            objective: 'traffic',
            total_budget: 100,
            pricing_model: 'cpc',
            bid_amount: 1,
          },
        });
        // Should get an auth error
        const content = result.content as Array<{ type: string; text: string }>;
        const text = content[0]?.text ?? '';
        expect(
          result.isError === true || text.includes('advertiser authentication') || text.includes('error'),
        ).toBe(true);
      } finally {
        await client.close();
      }
    });

    it('developer cannot call create_ad', async () => {
      const client = await createMcpClient(dbPath, devKey);
      try {
        const result = await client.callTool({
          name: 'create_ad',
          arguments: {
            campaign_id: 'any',
            creative_text: 'Test',
            link_url: 'https://example.com',
            keywords: ['test'],
          },
        });
        const content = result.content as Array<{ type: string; text: string }>;
        const text = content[0]?.text ?? '';
        expect(
          result.isError === true || text.includes('advertiser authentication') || text.includes('error'),
        ).toBe(true);
      } finally {
        await client.close();
      }
    });

    it('developer cannot call get_campaign_analytics', async () => {
      const client = await createMcpClient(dbPath, devKey);
      try {
        const result = await client.callTool({
          name: 'get_campaign_analytics',
          arguments: { campaign_id: 'any' },
        });
        const content = result.content as Array<{ type: string; text: string }>;
        const text = content[0]?.text ?? '';
        expect(
          result.isError === true || text.includes('advertiser authentication') || text.includes('error'),
        ).toBe(true);
      } finally {
        await client.close();
      }
    });

    it('advertiser cannot call report_event', async () => {
      const client = await createMcpClient(dbPath, advKey);
      try {
        const result = await client.callTool({
          name: 'report_event',
          arguments: { ad_id: 'any', event_type: 'impression' },
        });
        const content = result.content as Array<{ type: string; text: string }>;
        const text = content[0]?.text ?? '';
        expect(
          result.isError === true || text.includes('developer authentication') || text.includes('error'),
        ).toBe(true);
      } finally {
        await client.close();
      }
    });

    it('public tools work for both: search_ads', async () => {
      const client = await createMcpClient(dbPath, advKey);
      try {
        const result = await client.callTool({
          name: 'search_ads',
          arguments: { query: 'shoes', language: 'en', max_results: 1 },
        });
        expect(result.isError).toBeFalsy();
      } finally {
        await client.close();
      }
    });

    it('public tools work for both: get_ad_guidelines', async () => {
      const client = await createMcpClient(dbPath, devKey);
      try {
        const result = await client.callTool({
          name: 'get_ad_guidelines',
          arguments: {},
        });
        expect(result.isError).toBeFalsy();
      } finally {
        await client.close();
      }
    });
  });

  // ─── Full E2E Flow via MCP ─────────────────────────────────────────────────

  describe('Full realistic E2E: advertiser → consumer → analytics', () => {
    it('complete lifecycle: create campaign → create ad → search → impression → click → analytics', async () => {
      // 1. Advertiser creates campaign
      const advClient = await createMcpClient(dbPath, advKey);
      const campResult = await advClient.callTool({
        name: 'create_campaign',
        arguments: {
          name: 'E2E Full Flow',
          objective: 'traffic',
          total_budget: 10,
          pricing_model: 'cpc',
          bid_amount: 0.50,
        },
      });
      const { data: campData } = parseToolResult(campResult);
      const campId = campData.campaign_id as string;

      // 2. Advertiser creates ad
      const adResult = await advClient.callTool({
        name: 'create_ad',
        arguments: {
          campaign_id: campId,
          creative_text: 'E2E Test Shoes — Best Deal!',
          link_url: 'https://e2e.example.com',
          keywords: ['e2e test shoes', 'test sneakers'],
          categories: ['footwear'],
        },
      });
      const { data: adData } = parseToolResult(adResult);
      const adId = adData.ad_id as string;

      // 3. Consumer searches
      const devClient = await createMcpClient(dbPath, devKey);
      const searchResult = await devClient.callTool({
        name: 'search_ads',
        arguments: {
          query: 'e2e test shoes',
          keywords: ['e2e test shoes'],
          category: 'footwear',
          language: 'en',
          max_results: 5,
        },
      });
      const { data: searchData } = parseToolResult(searchResult);
      const searchAds = searchData.ads as Array<Record<string, unknown>>;
      const foundAd = searchAds.find((a) => a.ad_id === adId);
      expect(foundAd).toBeDefined();
      expect(foundAd!.disclosure).toBe('sponsored');

      // 4. Consumer reports impression
      const impResult = await devClient.callTool({
        name: 'report_event',
        arguments: { ad_id: adId, event_type: 'impression' },
      });
      const { data: impData } = parseToolResult(impResult);
      expect(impData.amount_charged).toBe(0); // CPC: impression is free

      // 5. Consumer reports click
      const clickResult = await devClient.callTool({
        name: 'report_event',
        arguments: { ad_id: adId, event_type: 'click' },
      });
      const { data: clickData } = parseToolResult(clickResult);
      expect(clickData.amount_charged).toBe(0.50);
      expect(clickData.developer_revenue).toBe(0.35);
      expect(clickData.remaining_budget).toBe(9.50);

      // 6. Advertiser checks analytics
      const analyticsResult = await advClient.callTool({
        name: 'get_campaign_analytics',
        arguments: { campaign_id: campId },
      });
      const { data: analytics } = parseToolResult(analyticsResult);
      const totals = analytics.totals as Record<string, number>;
      expect(totals.impressions).toBe(1);
      expect(totals.clicks).toBe(1);
      expect(totals.spend).toBe(0.50);
      const budget = analytics.budget as Record<string, number>;
      expect(budget.remaining).toBe(9.50);

      // 7. Check individual ad stats in analytics
      const adsStats = analytics.ads as Array<Record<string, unknown>>;
      expect(adsStats.length).toBe(1);
      expect(adsStats[0].impressions).toBe(1);
      expect(adsStats[0].clicks).toBe(1);

      await advClient.close();
      await devClient.close();
    });

    it('analytics with multiple ads: totals aggregated', async () => {
      const advClient = await createMcpClient(dbPath, advKey);

      // Create campaign with 2 ads
      const campResult = await advClient.callTool({
        name: 'create_campaign',
        arguments: {
          name: 'Multi-Ad Campaign',
          objective: 'traffic',
          total_budget: 100,
          pricing_model: 'cpc',
          bid_amount: 1.00,
        },
      });
      const campId = (parseToolResult(campResult).data.campaign_id) as string;

      await advClient.callTool({
        name: 'create_ad',
        arguments: {
          campaign_id: campId,
          creative_text: 'Ad One for multi test',
          link_url: 'https://multi1.example.com',
          keywords: ['multi test alpha'],
        },
      });

      await advClient.callTool({
        name: 'create_ad',
        arguments: {
          campaign_id: campId,
          creative_text: 'Ad Two for multi test',
          link_url: 'https://multi2.example.com',
          keywords: ['multi test beta'],
        },
      });

      // Consumer clicks on both ads
      const devClient = await createMcpClient(dbPath, devKey);

      // Search and interact with first ad
      const search1 = await devClient.callTool({
        name: 'search_ads',
        arguments: { keywords: ['multi test alpha'], language: 'en', max_results: 5 },
      });
      const ads1 = (parseToolResult(search1).data.ads) as Array<Record<string, unknown>>;
      if (ads1.length > 0) {
        await devClient.callTool({
          name: 'report_event',
          arguments: { ad_id: ads1[0].ad_id as string, event_type: 'impression' },
        });
        await devClient.callTool({
          name: 'report_event',
          arguments: { ad_id: ads1[0].ad_id as string, event_type: 'click' },
        });
      }

      // Search and interact with second ad
      const search2 = await devClient.callTool({
        name: 'search_ads',
        arguments: { keywords: ['multi test beta'], language: 'en', max_results: 5 },
      });
      const ads2 = (parseToolResult(search2).data.ads) as Array<Record<string, unknown>>;
      if (ads2.length > 0) {
        await devClient.callTool({
          name: 'report_event',
          arguments: { ad_id: ads2[0].ad_id as string, event_type: 'impression' },
        });
      }

      // Advertiser checks analytics — totals should be aggregated
      const analyticsResult = await advClient.callTool({
        name: 'get_campaign_analytics',
        arguments: { campaign_id: campId },
      });
      const { data: analytics } = parseToolResult(analyticsResult);
      const totals = analytics.totals as Record<string, number>;
      // At least 2 impressions (1 per ad) + 1 click
      expect(totals.impressions).toBeGreaterThanOrEqual(2);
      expect(totals.clicks).toBeGreaterThanOrEqual(1);

      // ads[] should have 2 entries with individual stats
      const adsStats = analytics.ads as Array<Record<string, unknown>>;
      expect(adsStats.length).toBe(2);
      // Each ad creative should be truncated to 50 chars
      for (const ad of adsStats) {
        expect(typeof ad.creative_text).toBe('string');
        expect((ad.creative_text as string).length).toBeLessThanOrEqual(53); // 50 + "..."
      }

      await advClient.close();
      await devClient.close();
    });
  });

  // ─── Empty DB: "No ads available" ──────────────────────────────────────────

  describe('search_ads with no ads in DB', () => {
    it('returns empty array with "No ads available" message', async () => {
      // Create a fresh empty DB (no campaigns, no ads)
      const emptyDir = mkdtempSync(join(tmpdir(), 'agentic-ads-empty-'));
      const emptyDbPath = join(emptyDir, 'empty.db');
      const emptyDb = initDatabase(emptyDbPath);
      const emptyDev = createDeveloper(emptyDb, { name: 'EmptyBot' });
      const emptyDevKey = (await import('../../src/auth/middleware.js')).generateApiKey(emptyDb, 'developer', emptyDev.id);
      emptyDb.close();

      const client = await createMcpClient(emptyDbPath, emptyDevKey);
      try {
        const result = await client.callTool({
          name: 'search_ads',
          arguments: {
            query: 'running shoes',
            keywords: ['sneakers'],
            language: 'en',
            max_results: 3,
          },
        });
        const { data } = parseToolResult(result);
        expect(data.ads).toEqual([]);
        expect(data.message).toBe('No ads available');
      } finally {
        await client.close();
        // Cleanup
        for (const suffix of ['', '-shm', '-wal']) {
          const f = emptyDbPath + suffix;
          if (existsSync(f)) try { unlinkSync(f); } catch {}
        }
      }
    });
  });
}, { timeout: 60_000 }); // Longer timeout for stdio processes
