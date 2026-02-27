#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'node:http';
import crypto from 'node:crypto';
import { z } from 'zod';

import { initDatabase, createAdvertiser, createDeveloper, createCampaign, createAd } from './db/index.js';
import { getAdGuidelines } from './tools/consumer/get-guidelines.js';
import { authenticate, extractKeyFromHeader, generateApiKey, type AuthContext, AuthError } from './auth/middleware.js';
import { RateLimiter, RateLimitError } from './auth/rate-limiter.js';

// ─── CLI Args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

const mode = args.includes('--stdio')
  ? 'stdio'
  : args.includes('--http')
    ? 'http'
    : 'stdio';

const portFlag = args.indexOf('--port');
const port = portFlag !== -1 ? parseInt(args[portFlag + 1], 10) : 3000;

const dbPathFlag = args.indexOf('--db');
// Priority: --db CLI flag > DATABASE_PATH env var > default file
const dbPath = dbPathFlag !== -1 ? args[dbPathFlag + 1] : (process.env.DATABASE_PATH ?? 'agentic-ads.db');

const apiKeyFlag = args.indexOf('--api-key');
const cliApiKey = apiKeyFlag !== -1 ? args[apiKeyFlag + 1] : process.env.AGENTIC_ADS_API_KEY;

// ─── Database ────────────────────────────────────────────────────────────────

const db = initDatabase(dbPath);
console.error(`[agentic-ads] Database initialized at: ${dbPath}`);

// ─── Auto-Seed Production DB ─────────────────────────────────────────────────

function autoSeed() {
  const advCount = (db.prepare('SELECT COUNT(*) as c FROM advertisers').get() as { c: number }).c;
  const devCount = (db.prepare('SELECT COUNT(*) as c FROM developers').get() as { c: number }).c;
  if (advCount > 0 || devCount > 0) return; // Already seeded or pre-populated

  console.error('[agentic-ads] Empty database detected — auto-seeding production campaigns...');

  // OnlySwaps — Web3 token swapper
  const onlyswaps = createAdvertiser(db, {
    name: 'OnlySwaps',
    company: 'OnlySwaps',
    email: 'hello@onlyswaps.io',
  });
  const osKey = generateApiKey(db, 'advertiser', onlyswaps.id);
  const osCampaign = createCampaign(db, {
    advertiser_id: onlyswaps.id,
    name: 'OnlySwaps — Swap Smarter',
    objective: 'traffic',
    total_budget: 500,
    daily_budget: 20,
    pricing_model: 'cpc',
    bid_amount: 0.25,
    start_date: '2026-01-01',
    end_date: '2026-12-31',
  });
  createAd(db, {
    campaign_id: osCampaign.id,
    creative_text: 'OnlySwaps — Swap tokens across DEXs at the best rates. Zero slippage, lightning fast, multichain. The smart way to trade crypto.',
    link_url: 'https://github.com/0xKoaj/onlyswaps',
    keywords: ['crypto', 'swap', 'defi', 'web3', 'tokens', 'trading', 'dex', 'ethereum', 'blockchain'],
    categories: ['finance', 'crypto', 'web3'],
    geo: 'ALL',
    language: 'en',
  });
  createAd(db, {
    campaign_id: osCampaign.id,
    creative_text: 'Tired of bad swap rates? OnlySwaps aggregates DEXs to find the best price. Flashloan arbitrage included. Open source.',
    link_url: 'https://github.com/0xKoaj/onlyswaps',
    keywords: ['arbitrage', 'flashloan', 'uniswap', 'sushiswap', 'token swap', 'crypto trading'],
    categories: ['finance', 'crypto', 'defi'],
    geo: 'ALL',
    language: 'en',
  });

  // Agentic Ads — our own product
  const agads = createAdvertiser(db, {
    name: 'Agentic Ads',
    company: 'Agentic Ads',
    email: 'hello@agentic-ads.com',
  });
  const agKey = generateApiKey(db, 'advertiser', agads.id);
  const agCampaign = createCampaign(db, {
    advertiser_id: agads.id,
    name: 'Monetize Your MCP Server',
    objective: 'conversions',
    total_budget: 500,
    daily_budget: 20,
    pricing_model: 'cpc',
    bid_amount: 0.30,
    start_date: '2026-01-01',
    end_date: '2026-12-31',
  });
  createAd(db, {
    campaign_id: agCampaign.id,
    creative_text: 'Monetize your MCP server in 5 minutes. Add contextual ads to your AI agent tools and earn 70% revenue share. Free to integrate.',
    link_url: 'https://github.com/nicofains1/agentic-ads',
    keywords: ['mcp', 'monetization', 'ai agents', 'mcp server', 'revenue', 'advertising', 'model context protocol'],
    categories: ['developer-tools', 'ai', 'monetization'],
    geo: 'ALL',
    language: 'en',
  });
  createAd(db, {
    campaign_id: agCampaign.id,
    creative_text: 'Your MCP server has users but no revenue? Agentic Ads is like AdSense for AI agents. 8 MCP tools, 5-minute setup, 70/30 split.',
    link_url: 'https://github.com/nicofains1/agentic-ads',
    keywords: ['mcp tools', 'ai monetization', 'developer revenue', 'adsense for ai', 'mcp marketplace'],
    categories: ['developer-tools', 'ai', 'advertising'],
    geo: 'ALL',
    language: 'en',
  });

  // Demo developer for consumers to test
  const demo = createDeveloper(db, { name: 'DemoBot', email: 'demo@agentic-ads.com' });
  const devKey = generateApiKey(db, 'developer', demo.id);

  console.error('[agentic-ads] Auto-seed complete:');
  console.error(`  OnlySwaps advertiser key: ${osKey}`);
  console.error(`  Agentic Ads advertiser key: ${agKey}`);
  console.error(`  DemoBot developer key: ${devKey}`);
}

autoSeed();

// ─── Auth Context ─────────────────────────────────────────────────────────────

const sessionAuthMap = new Map<string, AuthContext>();
const STDIO_SESSION_KEY = '__stdio__';

/** Resolve auth for the current tool call. Returns null if no auth (public tools). */
function getAuth(extra: { sessionId?: string }): AuthContext | null {
  const key = extra.sessionId ?? STDIO_SESSION_KEY;
  return sessionAuthMap.get(key) ?? null;
}

/** Require auth of a specific entity type. Throws MCP-friendly error on failure. */
function requireAuth(extra: { sessionId?: string }, requiredType?: 'advertiser' | 'developer'): AuthContext {
  const auth = getAuth(extra);
  if (!auth) {
    throw new Error('Authentication required. Provide an API key via Authorization header (HTTP) or --api-key flag (stdio).');
  }
  if (requiredType && auth.entity_type !== requiredType) {
    throw new Error(`This tool requires ${requiredType} authentication, but you authenticated as ${auth.entity_type}.`);
  }
  return auth;
}

// ─── Rate Limiter ─────────────────────────────────────────────────────────────

const rateLimiter = new RateLimiter();
rateLimiter.startCleanup();

/** Check rate limit for the current tool call. Throws on exceeded. */
function checkRateLimit(extra: { sessionId?: string }, toolName: string): void {
  const auth = getAuth(extra);
  if (!auth) return; // No auth = no rate limiting (public tools)
  rateLimiter.enforce(auth.key_id, toolName);
}

// ─── MCP Server Factory ─────────────────────────────────────────────────────
// Each transport (stdio or HTTP session) needs its own McpServer instance
// because Protocol.connect() only supports a single transport at a time.

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'agentic-ads',
    version: '0.1.0',
  });

  registerTools(server);

  return server;
}

/** Log every MCP tool invocation with timestamp and auth context. */
function logToolCall(toolName: string, sessionId?: string): void {
  const ts = new Date().toISOString();
  const auth = sessionId ? sessionAuthMap.get(sessionId) : sessionAuthMap.get(STDIO_SESSION_KEY);
  const developerInfo = auth ? ` developer_id=${auth.entity_id} (${auth.entity_type})` : ' unauthenticated';
  console.error(`[agentic-ads] tool=${toolName} ts=${ts} session=${sessionId ?? 'stdio'}${developerInfo}`);
}

function registerTools(server: McpServer): void {

// ─── Consumer Tools ──────────────────────────────────────────────────────────

server.tool(
  'get_ad_guidelines',
  'Get formatting guidelines for how to present sponsored ads naturally in agent responses',
  {},
  async (_params, extra) => {
    logToolCall('get_ad_guidelines', extra.sessionId);
    const guidelines = getAdGuidelines();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(guidelines, null, 2),
        },
      ],
    };
  },
);

// ─── Placeholder tools (wired up, implementations pending) ───────────────────

server.tool(
  'search_ads',
  'Search for relevant ads matching a user intent/context. Returns ranked sponsored suggestions.',
  {
    query: z.string().optional().describe('Natural language intent (e.g. "best running shoes")'),
    keywords: z.array(z.string()).optional().describe('Explicit keywords to match against'),
    category: z.string().optional().describe('Product/service category'),
    geo: z.string().optional().describe('Country code (e.g. "US")'),
    language: z.string().default('en').describe('Language code'),
    max_results: z.number().min(1).max(10).default(3).describe('Max ads to return'),
  },
  async (params, extra) => {
    logToolCall('search_ads', extra.sessionId);
    checkRateLimit(extra, 'search_ads');
    const { matchAds, rankAds } = await import('./matching/index.js');
    const { getActiveAds } = await import('./db/index.js');

    const activeAds = getActiveAds(db, {
      geo: params.geo,
      language: params.language,
    });

    if (activeAds.length === 0) {
      return { content: [{ type: 'text', text: JSON.stringify({ ads: [], message: 'No ads available' }) }] };
    }

    // Build AdCandidate array — need campaign bid_amount and advertiser name
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
        language: params.language,
      },
      candidates,
    );

    const ranked = rankAds(matches, params.max_results);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ads: ranked }, null, 2),
        },
      ],
    };
  },
);

server.tool(
  'report_event',
  'Report an ad event (impression, click, or conversion). Call this after showing a sponsored ad to the user.',
  {
    ad_id: z.string().describe('The ad_id from search_ads results'),
    event_type: z.enum(['impression', 'click', 'conversion']).describe('Type of event'),
    context_hash: z.string().optional().describe('Hash of the message containing the ad (for verification)'),
    metadata: z.record(z.unknown()).optional().describe('Additional event metadata'),
  },
  async (params, extra) => {
    logToolCall('report_event', extra.sessionId);
    const auth = requireAuth(extra, 'developer');
    checkRateLimit(extra, 'report_event');
    const { getAdById, insertEvent, updateAdStats, updateCampaignSpent, updateCampaignStatus, getCampaignById } = await import('./db/index.js');

    const ad = getAdById(db, params.ad_id);
    if (!ad) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Ad not found' }) }], isError: true };
    }

    const campaign = getCampaignById(db, ad.campaign_id);
    if (!campaign || campaign.status !== 'active') {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Campaign not active' }) }], isError: true };
    }

    // Calculate cost based on pricing model
    let cost = 0;
    if (campaign.pricing_model === 'cpm' && params.event_type === 'impression') {
      cost = campaign.bid_amount / 1000;
    } else if (campaign.pricing_model === 'cpc' && params.event_type === 'click') {
      cost = campaign.bid_amount;
    } else if (campaign.pricing_model === 'cpa' && params.event_type === 'conversion') {
      cost = campaign.bid_amount;
    }
    // For non-billable events under this pricing model, cost stays 0

    // Check budget
    if (campaign.spent + cost > campaign.total_budget) {
      updateCampaignStatus(db, campaign.id, 'paused');
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Campaign budget exhausted', campaign_paused: true }) }], isError: true };
    }

    // Revenue split: 70% developer, 30% platform
    const developerRevenue = cost * 0.7;
    const platformRevenue = cost * 0.3;

    // Use transaction for atomicity
    const processEvent = db.transaction(() => {
      const event = insertEvent(db, {
        ad_id: params.ad_id,
        developer_id: auth.entity_id,
        event_type: params.event_type,
        amount_charged: cost,
        developer_revenue: developerRevenue,
        platform_revenue: platformRevenue,
        context_hash: params.context_hash,
        metadata: params.metadata,
      });

      updateAdStats(db, params.ad_id, params.event_type, cost);

      if (cost > 0) {
        updateCampaignSpent(db, campaign.id, cost);
      }

      // Auto-pause if budget exhausted after this event
      const updated = getCampaignById(db, campaign.id);
      if (updated && updated.spent >= updated.total_budget) {
        updateCampaignStatus(db, campaign.id, 'paused');
      }

      return event;
    });

    const event = processEvent();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            event_id: event.id,
            event_type: params.event_type,
            amount_charged: cost,
            developer_revenue: developerRevenue,
            remaining_budget: campaign.total_budget - campaign.spent - cost,
          }),
        },
      ],
    };
  },
);

// ─── Advertiser Tools ────────────────────────────────────────────────────────

server.tool(
  'create_campaign',
  'Create a new advertising campaign with budget, pricing model, and objective',
  {
    name: z.string().describe('Campaign name'),
    objective: z.enum(['awareness', 'traffic', 'conversions']).describe('Campaign objective'),
    total_budget: z.number().positive().describe('Total budget in USD'),
    daily_budget: z.number().positive().optional().describe('Daily budget cap in USD'),
    pricing_model: z.enum(['cpm', 'cpc', 'cpa']).describe('Pricing model'),
    bid_amount: z.number().positive().describe('Bid amount per event (CPM: per 1000 impressions, CPC: per click, CPA: per conversion)'),
    start_date: z.string().optional().describe('Campaign start date (ISO format)'),
    end_date: z.string().optional().describe('Campaign end date (ISO format)'),
  },
  async (params, extra) => {
    logToolCall('create_campaign', extra.sessionId);
    const auth = requireAuth(extra, 'advertiser');
    checkRateLimit(extra, 'create_campaign');
    const { createCampaign } = await import('./db/index.js');

    const campaign = createCampaign(db, {
      advertiser_id: auth.entity_id,
      name: params.name,
      objective: params.objective,
      total_budget: params.total_budget,
      daily_budget: params.daily_budget,
      pricing_model: params.pricing_model,
      bid_amount: params.bid_amount,
      start_date: params.start_date,
      end_date: params.end_date,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            campaign_id: campaign.id,
            name: campaign.name,
            status: campaign.status,
            total_budget: campaign.total_budget,
            pricing_model: campaign.pricing_model,
            bid_amount: campaign.bid_amount,
            message: 'Campaign created successfully',
          }, null, 2),
        },
      ],
    };
  },
);

server.tool(
  'create_ad',
  'Create an ad unit within an existing campaign with creative text, link, and targeting',
  {
    campaign_id: z.string().describe('Campaign ID to attach this ad to'),
    creative_text: z.string().max(500).describe('Ad creative text (max 500 chars)'),
    link_url: z.string().url().describe('Destination URL when user clicks the ad'),
    keywords: z.array(z.string()).min(1).describe('Keywords for matching (at least 1)'),
    categories: z.array(z.string()).optional().describe('Product/service categories'),
    geo: z.string().default('ALL').describe('Target country code or "ALL"'),
    language: z.string().default('en').describe('Target language code'),
  },
  async (params, extra) => {
    logToolCall('create_ad', extra.sessionId);
    const auth = requireAuth(extra, 'advertiser');
    checkRateLimit(extra, 'create_ad');
    const { createAd, getCampaignById } = await import('./db/index.js');

    const campaign = getCampaignById(db, params.campaign_id);
    if (!campaign) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Campaign not found' }) }], isError: true };
    }
    if (campaign.advertiser_id !== auth.entity_id) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Campaign does not belong to your account' }) }], isError: true };
    }
    if (campaign.status !== 'active') {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Campaign is not active' }) }], isError: true };
    }

    const ad = createAd(db, {
      campaign_id: params.campaign_id,
      creative_text: params.creative_text,
      link_url: params.link_url,
      keywords: params.keywords,
      categories: params.categories,
      geo: params.geo,
      language: params.language,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ad_id: ad.id,
            campaign_id: ad.campaign_id,
            creative_text: ad.creative_text,
            keywords: ad.keywords,
            status: ad.status,
            message: 'Ad created successfully',
          }, null, 2),
        },
      ],
    };
  },
);

server.tool(
  'get_campaign_analytics',
  'Get performance metrics for a campaign (impressions, clicks, conversions, spend)',
  {
    campaign_id: z.string().describe('Campaign ID to get analytics for'),
  },
  async (params, extra) => {
    logToolCall('get_campaign_analytics', extra.sessionId);
    const auth = requireAuth(extra, 'advertiser');
    checkRateLimit(extra, 'get_campaign_analytics');
    const { getCampaignById, getAdsByCampaign } = await import('./db/index.js');

    const campaign = getCampaignById(db, params.campaign_id);
    if (!campaign) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Campaign not found' }) }], isError: true };
    }
    if (campaign.advertiser_id !== auth.entity_id) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Campaign does not belong to your account' }) }], isError: true };
    }

    const ads = getAdsByCampaign(db, params.campaign_id);

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
      content: [
        {
          type: 'text',
          text: JSON.stringify({
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
              ctr: Math.round(ctr * 10000) / 100, // percentage with 2 decimals
              cvr: Math.round(cvr * 10000) / 100,
            },
            ads: ads.map((ad) => ({
              ad_id: ad.id,
              creative_text: ad.creative_text.slice(0, 50) + (ad.creative_text.length > 50 ? '...' : ''),
              impressions: ad.impressions,
              clicks: ad.clicks,
              conversions: ad.conversions,
              spend: ad.spend,
            })),
          }, null, 2),
        },
      ],
    };
  },
);

server.tool(
  'update_campaign',
  'Update an existing campaign: modify name, objective, budget, bid, or status (pause/resume)',
  {
    campaign_id: z.string().describe('Campaign ID to update'),
    name: z.string().optional().describe('New campaign name'),
    objective: z.enum(['awareness', 'traffic', 'conversions']).optional().describe('New objective'),
    status: z.enum(['active', 'paused']).optional().describe('New status (active to pause, paused to resume)'),
    total_budget: z.number().positive().optional().describe('New total budget in USD'),
    daily_budget: z.number().positive().optional().describe('New daily budget cap in USD'),
    bid_amount: z.number().positive().optional().describe('New bid amount'),
    start_date: z.string().optional().describe('New start date (ISO format)'),
    end_date: z.string().optional().describe('New end date (ISO format)'),
  },
  async (params, extra) => {
    logToolCall('update_campaign', extra.sessionId);
    const auth = requireAuth(extra, 'advertiser');
    checkRateLimit(extra, 'update_campaign');
    const { getCampaignById, updateCampaign } = await import('./db/index.js');

    const campaign = getCampaignById(db, params.campaign_id);
    if (!campaign) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Campaign not found' }) }], isError: true };
    }
    if (campaign.advertiser_id !== auth.entity_id) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Campaign does not belong to your account' }) }], isError: true };
    }
    if (campaign.status === 'completed') {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Campaign is completed and cannot be modified' }) }], isError: true };
    }

    // Validate budget not below spent
    if (params.total_budget !== undefined && params.total_budget < campaign.spent) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: `New total_budget ($${params.total_budget}) cannot be less than spent ($${campaign.spent})` }) }], isError: true };
    }

    // Build update data (exclude campaign_id, exclude pricing_model changes)
    const { campaign_id: _cid, ...updateFields } = params;
    const updated = updateCampaign(db, params.campaign_id, updateFields);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            campaign_id: updated!.id,
            name: updated!.name,
            status: updated!.status,
            objective: updated!.objective,
            total_budget: updated!.total_budget,
            daily_budget: updated!.daily_budget,
            spent: updated!.spent,
            pricing_model: updated!.pricing_model,
            bid_amount: updated!.bid_amount,
            message: 'Campaign updated successfully',
          }, null, 2),
        },
      ],
    };
  },
);

server.tool(
  'list_campaigns',
  'List all campaigns for the authenticated advertiser with summary stats',
  {
    status: z.enum(['draft', 'active', 'paused', 'completed']).optional().describe('Filter by campaign status'),
  },
  async (params, extra) => {
    logToolCall('list_campaigns', extra.sessionId);
    const auth = requireAuth(extra, 'advertiser');
    checkRateLimit(extra, 'list_campaigns');
    const { listCampaigns } = await import('./db/index.js');

    const campaigns = listCampaigns(db, auth.entity_id, {
      status: params.status,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            campaigns: campaigns.map((c) => ({
              campaign_id: c.id,
              name: c.name,
              status: c.status,
              objective: c.objective,
              pricing_model: c.pricing_model,
              bid_amount: c.bid_amount,
              budget: {
                total: c.total_budget,
                daily: c.daily_budget,
                spent: c.spent,
                remaining: c.total_budget - c.spent,
              },
            })),
            total: campaigns.length,
          }, null, 2),
        },
      ],
    };
  },
);

// ─── Developer Tools ──────────────────────────────────────────────────────────

server.tool(
  'get_developer_earnings',
  'Get earnings summary for the authenticated developer: total revenue, event counts, per-campaign breakdown, and period-based earnings (24h, 7d, 30d, all-time).',
  {},
  async (_params, extra) => {
    logToolCall('get_developer_earnings', extra.sessionId);
    const auth = requireAuth(extra, 'developer');
    checkRateLimit(extra, 'get_developer_earnings');

    const developerId = auth.entity_id;

    // All-time totals
    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(developer_revenue), 0)                                          AS total_earnings,
        COALESCE(SUM(CASE WHEN event_type = 'impression' THEN 1 ELSE 0 END), 0)     AS total_impressions,
        COALESCE(SUM(CASE WHEN event_type = 'click'      THEN 1 ELSE 0 END), 0)     AS total_clicks,
        COALESCE(SUM(CASE WHEN event_type = 'conversion' THEN 1 ELSE 0 END), 0)     AS total_conversions
      FROM events
      WHERE developer_id = ?
    `).get(developerId) as {
      total_earnings: number;
      total_impressions: number;
      total_clicks: number;
      total_conversions: number;
    };

    // Per-campaign breakdown (join events → ads → campaigns → advertisers)
    const earningsByCampaign = db.prepare(`
      SELECT
        c.name          AS campaign_name,
        adv.name        AS advertiser_name,
        COALESCE(SUM(CASE WHEN e.event_type = 'impression' THEN 1 ELSE 0 END), 0)  AS impressions,
        COALESCE(SUM(CASE WHEN e.event_type = 'click'      THEN 1 ELSE 0 END), 0)  AS clicks,
        COALESCE(SUM(CASE WHEN e.event_type = 'conversion' THEN 1 ELSE 0 END), 0)  AS conversions,
        COALESCE(SUM(e.developer_revenue), 0)                                       AS revenue
      FROM events e
      JOIN ads       a   ON e.ad_id        = a.id
      JOIN campaigns c   ON a.campaign_id  = c.id
      JOIN advertisers adv ON c.advertiser_id = adv.id
      WHERE e.developer_id = ?
      GROUP BY c.id
      ORDER BY revenue DESC
    `).all(developerId) as Array<{
      campaign_name: string;
      advertiser_name: string;
      impressions: number;
      clicks: number;
      conversions: number;
      revenue: number;
    }>;

    // Period-based earnings helper — use SQLite-compatible datetime format (space separator, no T/Z)
    function sqliteDatetime(d: Date): string {
      return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
    }

    function earningsSince(dt: Date): number {
      const row = db.prepare(`
        SELECT COALESCE(SUM(developer_revenue), 0) AS total
        FROM events
        WHERE developer_id = ?
          AND created_at >= ?
      `).get(developerId, sqliteDatetime(dt)) as { total: number };
      return row.total;
    }

    const now = new Date();
    const periodEarnings = {
      last_24h: earningsSince(new Date(now.getTime() - 24 * 60 * 60 * 1000)),
      last_7d:  earningsSince(new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000)),
      last_30d: earningsSince(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)),
      all_time: totals.total_earnings,
    };

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            total_earnings:       totals.total_earnings,
            total_impressions:    totals.total_impressions,
            total_clicks:         totals.total_clicks,
            total_conversions:    totals.total_conversions,
            earnings_by_campaign: earningsByCampaign,
            period_earnings:      periodEarnings,
          }, null, 2),
        },
      ],
    };
  },
);

} // end registerTools

// ─── Transport & Startup ─────────────────────────────────────────────────────

async function startStdio() {
  console.error('[agentic-ads] Starting in stdio mode...');

  // Authenticate via CLI flag or env var
  if (cliApiKey) {
    try {
      const auth = authenticate(db, cliApiKey);
      sessionAuthMap.set(STDIO_SESSION_KEY, auth);
      console.error(`[agentic-ads] Authenticated as ${auth.entity_type}: ${auth.entity_id}`);
    } catch (err) {
      if (err instanceof AuthError) {
        console.error(`[agentic-ads] Auth failed: ${err.message}`);
        process.exit(1);
      }
      throw err;
    }
  } else {
    console.error('[agentic-ads] No API key provided — running without authentication (public tools only)');
  }

  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[agentic-ads] MCP server running on stdio');
}

async function startHttp() {
  console.error(`[agentic-ads] Starting in HTTP mode on port ${port}...`);

  // Track transports per session for cleanup
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);

    // MCP server card for marketplace discovery (Smithery, etc.)
    if (url.pathname === '/.well-known/mcp/server-card.json') {
      const host = req.headers.host;
      const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : (host?.includes('localhost') ? 'http' : 'https');
      const publicBase = host ? `${proto}://${host}` : `http://localhost:${port}`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        name: 'agentic-ads',
        description: 'Ad network for AI agents — monetize MCP servers with contextual ads. 70% revenue share for developers.',
        version: '0.1.0',
        url: `${publicBase}/mcp`,
        transport: { type: 'streamable-http', url: '/mcp' },
        tools: [
          { name: 'search_ads', description: 'Search for relevant ads by query, keywords, category, or geo' },
          { name: 'report_event', description: 'Report impression, click, or conversion events' },
          { name: 'get_ad_guidelines', description: 'Get ad formatting guidelines for agents' },
          { name: 'create_campaign', description: 'Create an advertising campaign with budget and pricing model' },
          { name: 'create_ad', description: 'Create an ad with creative, keywords, and targeting' },
          { name: 'get_campaign_analytics', description: 'Get campaign performance metrics' },
          { name: 'update_campaign', description: 'Update campaign fields, pause or resume' },
          { name: 'list_campaigns', description: 'List all campaigns with summary stats' },
          { name: 'get_developer_earnings', description: 'Get developer earnings, impressions, clicks, conversions by campaign and period' }
        ]
      }));
      return;
    }

    // Health check
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', server: 'agentic-ads', version: '0.1.0' }));
      return;
    }

    // MCP endpoint
    if (url.pathname === '/mcp') {
      // Authenticate via Authorization header (if present)
      const rawKey = extractKeyFromHeader(req.headers.authorization);
      let auth: AuthContext | null = null;
      if (rawKey) {
        try {
          auth = authenticate(db, rawKey);
        } catch (err) {
          if (err instanceof AuthError) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
            return;
          }
          throw err;
        }
      }

      // Check for existing session
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (sessionId && transports.has(sessionId)) {
        // Update auth for existing session (key might change between requests)
        if (auth) {
          sessionAuthMap.set(sessionId, auth);
        }
        const transport = transports.get(sessionId)!;
        await transport.handleRequest(req, res);
        return;
      }

      // New session — each session gets its own McpServer instance
      // because Protocol.connect() only supports one transport at a time.
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (sid) => {
          // Store transport once the session ID is assigned (after initialize)
          transports.set(sid, transport);
          if (auth) {
            sessionAuthMap.set(sid, auth);
          }
          const authInfo = auth ? ` authenticated as ${auth.entity_type}:${auth.entity_id}` : ' unauthenticated';
          console.error(`[agentic-ads] New MCP session: ${sid}${authInfo} ts=${new Date().toISOString()}`);
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          transports.delete(transport.sessionId);
          sessionAuthMap.delete(transport.sessionId);
        }
      };

      const sessionServer = createMcpServer();
      await sessionServer.connect(transport);
      await transport.handleRequest(req, res);
      return;
    }

    // ─── REST: POST /api/register ─────────────────────────────────────────────
    if (url.pathname === '/api/register' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
      req.on('end', () => {
        let parsed: { name?: unknown; email?: unknown };
        try {
          parsed = JSON.parse(body) as { name?: unknown; email?: unknown };
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON body' }));
          return;
        }

        const name = parsed.name;
        const email = parsed.email;

        // Validate name (required)
        if (!name || typeof name !== 'string' || name.trim() === '') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'name is required' }));
          return;
        }

        // Validate email format (required)
        if (!email || typeof email !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'email is required' }));
          return;
        }
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid email format' }));
          return;
        }

        try {
          const developer = createDeveloper(db, { name: name.trim(), email });
          const apiKey = generateApiKey(db, 'developer', developer.id);
          const host = req.headers.host;
          const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : (host?.includes('localhost') ? 'http' : 'https');
          const publicBase = host ? `${proto}://${host}` : `http://localhost:${port}`;

          console.error(`[agentic-ads] New developer registered: ${name.trim()} <${email}> (id: ${developer.id})`);

          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            developer_id: developer.id,
            api_key: apiKey,
            mcp_url: `${publicBase}/mcp`,
          }));
        } catch (err) {
          console.error('[agentic-ads] Registration error:', err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Registration failed' }));
        }
      });
      return;
    }

    // 404 for anything else
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. Use /mcp for MCP protocol, /health for health check, or POST /api/register to create a developer account.' }));
  });

  httpServer.listen(port, () => {
    console.error(`[agentic-ads] MCP server listening on http://localhost:${port}/mcp`);
    console.error(`[agentic-ads] Health check: http://localhost:${port}/health`);
  });
}

// ─── Main ────────────────────────────────────────────────────────────────────

if (mode === 'stdio') {
  startStdio().catch((err) => {
    console.error('[agentic-ads] Fatal error:', err);
    process.exit(1);
  });
} else {
  startHttp().catch((err) => {
    console.error('[agentic-ads] Fatal error:', err);
    process.exit(1);
  });
}
