#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'node:http';
import crypto from 'node:crypto';
import { z } from 'zod';

import { initDatabase } from './db/index.js';
import { getAdGuidelines } from './tools/consumer/get-guidelines.js';

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
const dbPath = dbPathFlag !== -1 ? args[dbPathFlag + 1] : 'agentic-ads.db';

// ─── Database ────────────────────────────────────────────────────────────────

const db = initDatabase(dbPath);
console.error(`[agentic-ads] Database initialized at: ${dbPath}`);

// ─── MCP Server ──────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'agentic-ads',
  version: '0.1.0',
});

// ─── Consumer Tools ──────────────────────────────────────────────────────────

server.tool(
  'get_ad_guidelines',
  'Get formatting guidelines for how to present sponsored ads naturally in agent responses',
  {},
  async () => {
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
  async (params) => {
    // TODO(#7): Full implementation with matching engine
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
  async (params) => {
    // TODO(#8, #12): Full implementation with budget manager and revenue split
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
        developer_id: 'anonymous', // TODO(#13): Extract from auth context
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
  async (params) => {
    // TODO(#13): Extract advertiser_id from auth context
    // For now, create or find a default advertiser
    const { createCampaign, createAdvertiser } = await import('./db/index.js');

    let advertiser = db.prepare('SELECT * FROM advertisers LIMIT 1').get() as { id: string } | undefined;
    if (!advertiser) {
      const newAdv = createAdvertiser(db, { name: 'Default Advertiser' });
      advertiser = newAdv;
    }

    const campaign = createCampaign(db, {
      advertiser_id: advertiser.id,
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
  async (params) => {
    const { createAd, getCampaignById } = await import('./db/index.js');

    const campaign = getCampaignById(db, params.campaign_id);
    if (!campaign) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Campaign not found' }) }], isError: true };
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
  async (params) => {
    const { getCampaignById, getAdsByCampaign } = await import('./db/index.js');

    const campaign = getCampaignById(db, params.campaign_id);
    if (!campaign) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Campaign not found' }) }], isError: true };
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

// ─── Transport & Startup ─────────────────────────────────────────────────────

async function startStdio() {
  console.error('[agentic-ads] Starting in stdio mode...');
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

    // Health check
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', server: 'agentic-ads', version: '0.1.0' }));
      return;
    }

    // MCP endpoint
    if (url.pathname === '/mcp') {
      // Check for existing session
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (sessionId && transports.has(sessionId)) {
        const transport = transports.get(sessionId)!;
        await transport.handleRequest(req, res);
        return;
      }

      // New session
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          transports.delete(transport.sessionId);
        }
      };

      await server.connect(transport);

      if (transport.sessionId) {
        transports.set(transport.sessionId, transport);
      }

      await transport.handleRequest(req, res);
      return;
    }

    // 404 for anything else
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. Use /mcp for MCP protocol or /health for health check.' }));
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
