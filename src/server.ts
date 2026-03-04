#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from 'node:http';
import crypto from 'node:crypto';
import { z } from 'zod';

import { initDatabase, createAdvertiser, createDeveloper, createCampaign, createAd, updateDeveloperWallet, getDeveloperById, findDeveloperByWallet, createWithdrawal, completeWithdrawal, failWithdrawal, getTotalWithdrawn, getRecentWithdrawal, getDeveloperEarningsTotal, getActiveAds } from './db/index.js';
import { getAdGuidelines } from './tools/consumer/get-guidelines.js';
import { authenticate, extractKeyFromHeader, generateApiKey, type AuthContext, AuthError } from './auth/middleware.js';
import { RateLimiter, RateLimitError } from './auth/rate-limiter.js';
import { verifyConversion } from './verification/on-chain.js';
import { generateReferralCode, buildReferralLink } from './verification/referral.js';
import { verifyWalletSignature, buildRegisterMessage } from './verification/wallet.js';
import { validateCreativeText } from './security/creative-sanitization.js';
import { sendUsdc, isPaymentEnabled, getPlatformBalance } from './payments/withdraw.js';

// ─── CLI Args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

// Handle --help before anything else (no DB init, no side effects)
if (args.includes('--help') || args.includes('-h')) {
  console.log(`agentic-ads — MCP server for advertising in AI agent conversations

Usage:
  agentic-ads [options]

Options:
  --stdio           Run as MCP stdio server (default)
  --http            Run as HTTP server
  --port <number>   HTTP port (default: 3000, or PORT env var)
  --db <path>       SQLite database path (default: agentic-ads.db, or DATABASE_PATH env var)
  --api-key <key>   Authenticate with API key (or AGENTIC_ADS_API_KEY env var)
  -h, --help        Show this help message

Environment Variables:
  PORT                    HTTP server port
  DATABASE_PATH           Path to SQLite database file
  AGENTIC_ADS_API_KEY     API key for authentication

Examples:
  npx agentic-ads                    # Start MCP stdio server (for Claude, Cursor, etc.)
  npx agentic-ads --http             # Start HTTP server on port 3000
  npx agentic-ads --http --port 8080 # Start HTTP server on port 8080
`);
  process.exit(0);
}

const mode = args.includes('--stdio')
  ? 'stdio'
  : args.includes('--http')
    ? 'http'
    : 'stdio';

// Port: prefer --port CLI flag, then PORT env var, then default 3000
const portFlag = args.indexOf('--port');
const rawPort = portFlag !== -1 ? args[portFlag + 1] : process.env.PORT;
const port = (rawPort ? parseInt(rawPort, 10) : NaN) || 3000;

const dbPathFlag = args.indexOf('--db');
// Priority: --db CLI flag > DATABASE_PATH env var > default file
const dbPath = dbPathFlag !== -1 ? args[dbPathFlag + 1] : (process.env.DATABASE_PATH ?? 'agentic-ads.db');

const apiKeyFlag = args.indexOf('--api-key');
const cliApiKey = apiKeyFlag !== -1 ? args[apiKeyFlag + 1] : process.env.AGENTIC_ADS_API_KEY;

// ─── Security Constants ──────────────────────────────────────────────────────
const MAX_BODY_SIZE = 10 * 1024; // 10KB max for POST bodies

// ─── Database ────────────────────────────────────────────────────────────────

const db = initDatabase(dbPath);
console.error(`[agentic-ads] Database initialized at: ${dbPath}`);

// ─── Auto-Seed Production DB ─────────────────────────────────────────────────

function autoSeed() {
  // Per-advertiser idempotency: create each advertiser+campaigns only if missing.
  // Returns existing ID (no-op) or creates and returns new ID.
  function ensureAdvertiser(name: string, company?: string, email?: string): { id: string; created: boolean } {
    const existing = db.prepare('SELECT id FROM advertisers WHERE name = ?').get(name) as { id: string } | undefined;
    if (existing) return { id: existing.id, created: false };
    const a = createAdvertiser(db, { name, company, email });
    return { id: a.id, created: true };
  }
  function ensureDeveloper(devName: string, devEmail?: string): { id: string; created: boolean } {
    const existing = db.prepare('SELECT id FROM developers WHERE name = ?').get(devName) as { id: string } | undefined;
    if (existing) return { id: existing.id, created: false };
    const d = createDeveloper(db, { name: devName, email: devEmail });
    return { id: d.id, created: true };
  }

  console.error('[agentic-ads] Running auto-seed (idempotent — skips existing advertisers)...');

  // OnlySwaps — Web3 token swapper
  const { id: onlyswapsId, created: onlyswapsNew } = ensureAdvertiser('OnlySwaps', 'OnlySwaps', 'hello@onlyswaps.io');
  if (onlyswapsNew) {
  const osKey = generateApiKey(db, 'advertiser', onlyswapsId);
  const osCampaign = createCampaign(db, {
    advertiser_id: onlyswapsId,
    name: 'OnlySwaps — Swap Smarter',
    objective: 'conversions',
    total_budget: 500,
    daily_budget: 20,
    pricing_model: 'cpa',
    bid_amount: 2.00,
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    verification_type: 'on_chain',
    contract_address: '0x1234567890abcdef1234567890abcdef12345678', // FeeCollector placeholder
    chain_ids: [137, 1, 42161, 8453, 10],
  });
  createAd(db, {
    campaign_id: osCampaign.id,
    creative_text: 'OnlySwaps — Swap tokens across DEXs at the best rates. Zero slippage, lightning fast, multichain. The smart way to trade crypto.',
    link_url: 'https://onlyswaps.fyi',
    keywords: ['crypto', 'swap', 'defi', 'web3', 'tokens', 'trading', 'dex', 'ethereum', 'blockchain'],
    categories: ['finance', 'crypto', 'web3'],
    geo: 'ALL',
    language: 'en',
  });
  createAd(db, {
    campaign_id: osCampaign.id,
    creative_text: 'Tired of bad swap rates? OnlySwaps aggregates DEXs to find the best price. Flashloan arbitrage included. Open source.',
    link_url: 'https://onlyswaps.fyi',
    keywords: ['arbitrage', 'flashloan', 'uniswap', 'sushiswap', 'token swap', 'crypto trading'],
    categories: ['finance', 'crypto', 'defi'],
    geo: 'ALL',
    language: 'en',
  });
  } // end if (onlyswapsNew)

  // Agentic Ads — our own product
  const { id: agadsId, created: agadsNew } = ensureAdvertiser('Agentic Ads', 'Agentic Ads', 'hello@agentic-ads.com');
  if (agadsNew) {
    const agKey = generateApiKey(db, 'advertiser', agadsId);
    const agCampaign = createCampaign(db, {
      advertiser_id: agadsId,
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
    console.error(`  Agentic Ads advertiser key: ${agKey}`);
  }

  // ── Developer Tool Affiliate Campaigns ──────────────────────────────────────
  // NOTE: link_url uses affiliate URLs where available, direct product URLs otherwise.
  // See docs/affiliate-programs.md for signup info and CPC rationale.
  // RAILWAY_REFERRAL_CODE env var: set to your Railway referral code to earn 15%/12mo.
  // Get it at: https://railway.com/affiliate-program (instant, no approval needed)

  // Railway — Backend deployment (15% commission, no approval needed)
  // Affiliate link format: https://railway.com?referralCode=YOUR_CODE
  const railwayReferralCode = process.env.RAILWAY_REFERRAL_CODE ?? '';
  const railwayUrl = railwayReferralCode
    ? `https://railway.com?referralCode=${railwayReferralCode}`
    : 'https://railway.com';
  if (railwayReferralCode) {
    console.error(`[agentic-ads] Railway affiliate link active: ${railwayUrl}`);
  } else {
    console.error('[agentic-ads] RAILWAY_REFERRAL_CODE not set — using direct URL. Set env var to activate affiliate link ($36/yr per signup). See: https://railway.com/affiliate-program');
  }

  const { id: railwayId, created: railwayNew } = ensureAdvertiser('Railway', 'Railway Corp.', 'affiliates@railway.com');
  if (railwayNew) {
    const railwayCampaign = createCampaign(db, {
      advertiser_id: railwayId,
      name: 'Railway — Infrastructure for Builders',
      objective: 'conversions',
      total_budget: 300,
      daily_budget: 15,
      pricing_model: 'cpc',
      bid_amount: 0.40,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    });
    createAd(db, {
      campaign_id: railwayCampaign.id,
      creative_text: 'Deploy backends, databases, and workers on Railway. Git push to deploy. Postgres, Redis, and MySQL included. $5/month hobby plan.',
      link_url: railwayUrl,
      keywords: ['backend hosting', 'deploy nodejs', 'railway app', 'docker deploy', 'postgres hosting', 'redis hosting'],
      categories: ['hosting', 'deployment', 'backend'],
      geo: 'ALL',
      language: 'en',
    });
    createAd(db, {
      campaign_id: railwayCampaign.id,
      creative_text: 'Stop wrestling with AWS. Railway gives you Heroku simplicity with modern infra. Deploy any Docker container, scale on demand, sleep to zero.',
      link_url: railwayUrl,
      keywords: ['heroku alternative', 'railway platform', 'deploy docker', 'container hosting', 'serverless backend'],
      categories: ['hosting', 'deployment'],
      geo: 'ALL',
      language: 'en',
    });
  }

  // Vercel — Frontend deployment ($10/signup + 5% recurring)
  const { id: vercelId, created: vercelNew } = ensureAdvertiser('Vercel', 'Vercel Inc.', 'affiliates@vercel.com');
  if (vercelNew) {
    const vercelCampaign = createCampaign(db, {
      advertiser_id: vercelId,
      name: 'Vercel — Deploy Faster',
      objective: 'conversions',
      total_budget: 200,
      daily_budget: 10,
      pricing_model: 'cpc',
      bid_amount: 0.25,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    });
    createAd(db, {
      campaign_id: vercelCampaign.id,
      creative_text: 'Deploy your frontend in seconds with Vercel. Zero-config CI/CD, global edge network, and automatic preview deployments. Free tier available.',
      link_url: 'https://vercel.com/signup',
      keywords: ['deploy', 'hosting', 'frontend', 'nextjs', 'react', 'serverless', 'jamstack', 'ci/cd'],
      categories: ['hosting', 'deployment', 'frontend'],
      geo: 'ALL',
      language: 'en',
    });
    createAd(db, {
      campaign_id: vercelCampaign.id,
      creative_text: 'Next.js, SvelteKit, Nuxt, Remix — Vercel deploys any framework instantly. Preview URLs on every push. Scales to millions automatically.',
      link_url: 'https://vercel.com/signup',
      keywords: ['nextjs hosting', 'vercel deploy', 'preview deployments', 'edge functions', 'sveltekit hosting'],
      categories: ['hosting', 'deployment'],
      geo: 'ALL',
      language: 'en',
    });
  }

  // DigitalOcean — Cloud infrastructure (10% recurring for 12 months via CJ Affiliate)
  const { id: doId, created: doNew } = ensureAdvertiser('DigitalOcean', 'DigitalOcean LLC', 'affiliates@digitalocean.com');
  if (doNew) {
    const doCampaign = createCampaign(db, {
      advertiser_id: doId,
      name: 'DigitalOcean — Simple Cloud Infrastructure',
      objective: 'conversions',
      total_budget: 300,
      daily_budget: 15,
      pricing_model: 'cpc',
      bid_amount: 0.30,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    });
    createAd(db, {
      campaign_id: doCampaign.id,
      creative_text: 'Deploy apps, databases, and Kubernetes on DigitalOcean. Developer-friendly cloud starting at $4/month. $200 free credit for new users.',
      link_url: 'https://m.do.co/c/af5c18972daf',
      keywords: ['vps', 'cloud hosting', 'digitalocean', 'droplet', 'kubernetes', 'managed postgres', 'cloud server'],
      categories: ['hosting', 'cloud', 'infrastructure'],
      geo: 'ALL',
      language: 'en',
    });
    createAd(db, {
      campaign_id: doCampaign.id,
      creative_text: 'DigitalOcean App Platform: deploy from GitHub, auto-scales, managed SSL. Skip the AWS complexity. Simple pricing, great documentation.',
      link_url: 'https://m.do.co/c/af5c18972daf',
      keywords: ['app platform', 'heroku alternative', 'github deploy', 'managed hosting', 'paas'],
      categories: ['hosting', 'deployment', 'paas'],
      geo: 'ALL',
      language: 'en',
    });
  }

  // Neon — Serverless Postgres ($10 per referred user via open-source program)
  const { id: neonId, created: neonNew } = ensureAdvertiser('Neon', 'Neon Inc.', 'affiliates@neon.tech');
  if (neonNew) {
    const neonCampaign = createCampaign(db, {
      advertiser_id: neonId,
      name: 'Neon — Serverless Postgres',
      objective: 'conversions',
      total_budget: 200,
      daily_budget: 10,
      pricing_model: 'cpc',
      bid_amount: 0.15,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    });
    createAd(db, {
      campaign_id: neonCampaign.id,
      creative_text: 'Serverless Postgres that scales to zero. Neon gives you database branching for every Git branch, autoscaling, and a generous free tier.',
      link_url: 'https://neon.tech',
      keywords: ['postgres', 'serverless database', 'postgresql', 'database branching', 'neon', 'free postgres'],
      categories: ['database', 'postgres', 'serverless'],
      geo: 'ALL',
      language: 'en',
    });
    createAd(db, {
      campaign_id: neonCampaign.id,
      creative_text: "Instant Postgres for AI apps. Neon's pgvector support makes it the go-to database for embeddings and RAG. Scale to zero between requests.",
      link_url: 'https://neon.tech',
      keywords: ['pgvector', 'ai database', 'vector database', 'embeddings', 'rag database', 'postgres ai'],
      categories: ['database', 'ai', 'postgres'],
      geo: 'ALL',
      language: 'en',
    });
  }

  // Supabase — Backend as a Service (partner program, direct outreach pending)
  const { id: supabaseId, created: supabaseNew } = ensureAdvertiser('Supabase', 'Supabase Inc.', 'partners@supabase.io');
  if (supabaseNew) {
    const supabaseCampaign = createCampaign(db, {
      advertiser_id: supabaseId,
      name: 'Supabase — The Open Source Firebase',
      objective: 'conversions',
      total_budget: 200,
      daily_budget: 10,
      pricing_model: 'cpc',
      bid_amount: 0.20,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    });
    createAd(db, {
      campaign_id: supabaseCampaign.id,
      creative_text: 'Supabase gives you Postgres + Auth + Storage + Realtime in one platform. Open source, self-hostable, developer-friendly. Free tier always available.',
      link_url: 'https://supabase.com',
      keywords: ['supabase', 'firebase alternative', 'postgres', 'backend', 'auth', 'realtime database', 'open source backend'],
      categories: ['database', 'backend', 'auth'],
      geo: 'ALL',
      language: 'en',
    });
    createAd(db, {
      campaign_id: supabaseCampaign.id,
      creative_text: 'Build your full-stack app on Supabase. Row-level security, instant REST & GraphQL APIs, edge functions, and storage — all on Postgres.',
      link_url: 'https://supabase.com',
      keywords: ['supabase auth', 'postgres rls', 'edge functions', 'supabase storage', 'row level security'],
      categories: ['database', 'auth', 'backend'],
      geo: 'ALL',
      language: 'en',
    });
  }

  // ── Crypto Exchange Affiliate Campaigns ────────────────────────────────────
  // CPA model: exchanges pay high commissions per verified signup (KYC + first trade).
  // Set env vars to activate real affiliate links:
  //   BINANCE_REFERRAL_CODE, COINBASE_REF_CODE, KRAKEN_REFERRAL_ID, BYBIT_REF_CODE

  // Binance — World's largest crypto exchange (41–50% revenue share on trading fees, lifetime)
  // Apply: https://www.binance.com/en/activity/affiliate (requires 5K+ followers)
  const binanceUrl = process.env.BINANCE_REFERRAL_CODE
    ? `https://www.binance.com/en/register?ref=${process.env.BINANCE_REFERRAL_CODE}`
    : 'https://www.binance.com/en/register?ref=PENDING';
  const { id: binanceId, created: binanceNew } = ensureAdvertiser('Binance', 'Binance Holdings Ltd.', 'affiliates@binance.com');
  if (binanceNew) {
    const binanceCampaign = createCampaign(db, {
      advertiser_id: binanceId,
      name: 'Binance — World\'s #1 Crypto Exchange',
      objective: 'conversions',
      total_budget: 500,
      daily_budget: 25,
      pricing_model: 'cpa',
      bid_amount: 2.00,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    });
    createAd(db, {
      campaign_id: binanceCampaign.id,
      creative_text: 'Trade 350+ cryptocurrencies on Binance, the world\'s largest exchange. Low fees, deep liquidity, spot & futures trading. Sign up and get up to $600 in rewards.',
      link_url: binanceUrl,
      keywords: ['crypto exchange', 'buy bitcoin', 'binance', 'cryptocurrency trading', 'bitcoin exchange', 'crypto market'],
      categories: ['finance', 'crypto', 'exchange'],
      geo: 'ALL',
      language: 'en',
    });
    createAd(db, {
      campaign_id: binanceCampaign.id,
      creative_text: 'Binance offers spot, futures, staking, and DeFi in one platform. 0.1% maker/taker fees, 600+ pairs, 24/7 support. Start trading crypto today.',
      link_url: binanceUrl,
      keywords: ['swap tokens', 'defi trading', 'crypto futures', 'staking', 'binance futures', 'altcoin trading'],
      categories: ['finance', 'crypto', 'exchange'],
      geo: 'ALL',
      language: 'en',
    });
  }

  // Coinbase — Most trusted US crypto exchange (50% of trading fees, first 3 months only)
  // Apply: https://www.coinbase.com/affiliates via Impact Radius (requires ~45K monthly visitors)
  const coinbaseUrl = process.env.COINBASE_REF_CODE
    ? `https://coinbase.com/join/${process.env.COINBASE_REF_CODE}`
    : 'https://coinbase.com/join/PENDING';
  const { id: coinbaseId, created: coinbaseNew } = ensureAdvertiser('Coinbase', 'Coinbase Global Inc.', 'affiliates@coinbase.com');
  if (coinbaseNew) {
    const coinbaseCampaign = createCampaign(db, {
      advertiser_id: coinbaseId,
      name: 'Coinbase — Buy Crypto Safely',
      objective: 'conversions',
      total_budget: 500,
      daily_budget: 25,
      pricing_model: 'cpa',
      bid_amount: 2.00,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    });
    createAd(db, {
      campaign_id: coinbaseCampaign.id,
      creative_text: 'Buy Bitcoin, Ethereum, and 200+ cryptos on Coinbase — the most trusted US exchange. FDIC-insured USD, regulated, beginner-friendly. Get $10 in BTC on first trade.',
      link_url: coinbaseUrl,
      keywords: ['buy bitcoin', 'crypto exchange', 'coinbase', 'buy ethereum', 'cryptocurrency', 'buy crypto'],
      categories: ['finance', 'crypto', 'exchange'],
      geo: 'ALL',
      language: 'en',
    });
    createAd(db, {
      campaign_id: coinbaseCampaign.id,
      creative_text: 'Coinbase Advanced Trade gives pro traders low fees, advanced charts, and deep liquidity. Access DeFi via Coinbase Wallet. Regulated and secure.',
      link_url: coinbaseUrl,
      keywords: ['crypto trading', 'defi trading', 'coinbase advanced', 'swap tokens', 'bitcoin trading', 'cryptocurrency exchange'],
      categories: ['finance', 'crypto', 'exchange'],
      geo: 'ALL',
      language: 'en',
    });
  }

  // Kraken — Professional crypto exchange (20% of trading fees, lifetime, capped $1K/client)
  // Apply: https://app.impact.com/campaign-promo-signup/Kraken.brand (via Impact, 180-day cookie)
  const krakenUrl = process.env.KRAKEN_REFERRAL_ID
    ? `https://www.kraken.com/sign-up?referral=${process.env.KRAKEN_REFERRAL_ID}`
    : 'https://www.kraken.com/sign-up?referral=PENDING';
  const { id: krakenId, created: krakenNew } = ensureAdvertiser('Kraken', 'Payward Inc.', 'affiliates@kraken.com');
  if (krakenNew) {
    const krakenCampaign = createCampaign(db, {
      advertiser_id: krakenId,
      name: 'Kraken — Pro Crypto Trading',
      objective: 'conversions',
      total_budget: 500,
      daily_budget: 25,
      pricing_model: 'cpa',
      bid_amount: 2.00,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    });
    createAd(db, {
      campaign_id: krakenCampaign.id,
      creative_text: 'Kraken: the professional\'s crypto exchange. 200+ assets, spot & margin trading, staking, and institutional-grade security since 2011. Trusted by millions.',
      link_url: krakenUrl,
      keywords: ['crypto exchange', 'kraken', 'buy bitcoin', 'margin trading', 'crypto staking', 'professional trading'],
      categories: ['finance', 'crypto', 'exchange'],
      geo: 'ALL',
      language: 'en',
    });
    createAd(db, {
      campaign_id: krakenCampaign.id,
      creative_text: 'Trade crypto with confidence on Kraken. Low fees starting at 0.16%, NFT marketplace, Kraken Pro for advanced charts. Built for serious traders.',
      link_url: krakenUrl,
      keywords: ['defi trading', 'swap tokens', 'cryptocurrency', 'kraken pro', 'crypto portfolio', 'altcoin exchange'],
      categories: ['finance', 'crypto', 'exchange'],
      geo: 'ALL',
      language: 'en',
    });
  }

  // Bybit — Fast-growing derivatives exchange (30–50% of trading fees, lifetime, no cap) ← BEST
  // Apply: https://partner.bybit.com (easiest approval, ~24h, no follower minimum)
  const bybitUrl = process.env.BYBIT_REF_CODE
    ? `https://www.bybit.com/invite?ref=${process.env.BYBIT_REF_CODE}`
    : 'https://www.bybit.com/invite?ref=PENDING';
  const { id: bybitId, created: bybitNew } = ensureAdvertiser('Bybit', 'Bybit Fintech Ltd.', 'affiliates@bybit.com');
  if (bybitNew) {
    const bybitCampaign = createCampaign(db, {
      advertiser_id: bybitId,
      name: 'Bybit — Trade Crypto Derivatives',
      objective: 'conversions',
      total_budget: 500,
      daily_budget: 25,
      pricing_model: 'cpa',
      bid_amount: 2.00,
      start_date: '2026-01-01',
      end_date: '2026-12-31',
    });
    createAd(db, {
      campaign_id: bybitCampaign.id,
      creative_text: 'Bybit: trade Bitcoin and 300+ crypto derivatives with up to 100x leverage. Ultra-fast matching engine, 24/7 live support, and $30,000 welcome bonus.',
      link_url: bybitUrl,
      keywords: ['crypto exchange', 'crypto futures', 'bybit', 'bitcoin derivatives', 'defi trading', 'leverage trading'],
      categories: ['finance', 'crypto', 'exchange'],
      geo: 'ALL',
      language: 'en',
    });
    createAd(db, {
      campaign_id: bybitCampaign.id,
      creative_text: 'Bybit offers spot, futures, options, and copy trading in one app. Zero-fee spot trading, industry-low liquidation fee, and deep liquidity. Sign up free.',
      link_url: bybitUrl,
      keywords: ['swap tokens', 'copy trading', 'cryptocurrency', 'bybit spot', 'crypto options', 'buy bitcoin'],
      categories: ['finance', 'crypto', 'exchange'],
      geo: 'ALL',
      language: 'en',
    });
  }

  // Demo developer for consumers to test (with wallet for on-chain verification)
  const { id: demoId, created: demoNew } = ensureDeveloper('DemoBot', 'demo@agentic-ads.com');
  if (demoNew) {
    const devKey = generateApiKey(db, 'developer', demoId);
    const demoWallet = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'; // Hardhat #0
    const demoReferral = generateReferralCode(demoWallet);
    updateDeveloperWallet(db, demoId, demoWallet, demoReferral);
    console.error(`  DemoBot developer key: ${devKey}`);
    console.error(`  DemoBot wallet: ${demoWallet} (referral: ${demoReferral})`);
  }

  const newCount = [onlyswapsNew, agadsNew, railwayNew, vercelNew, doNew, neonNew, supabaseNew, binanceNew, coinbaseNew, krakenNew, bybitNew, demoNew].filter(Boolean).length;
  if (newCount > 0) {
    console.error(`[agentic-ads] Auto-seed complete: ${newCount} new advertisers/developers added.`);
    console.error(`  See docs/affiliate-programs.md to swap in real affiliate links`);
  } else {
    console.error('[agentic-ads] Auto-seed: all advertisers already present, nothing to do.');
  }
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
    version: '0.2.0',
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
    min_relevance: z.number().min(0).max(1).default(0).describe('Minimum relevance score (0-1). Ads below this threshold are excluded. Default 0 (return all).'),
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

    const ranked = rankAds(matches, params.max_results).filter(
      (ad) => ad.relevance_score >= params.min_relevance,
    );

    // Enrich on-chain campaign ads with referral links when developer has a wallet
    const auth = getAuth(extra);
    let developer: { wallet_address: string | null; referral_code: string | null } | null = null;
    if (auth?.entity_type === 'developer') {
      developer = getDeveloperById(db, auth.entity_id);
    }

    const { getAdById: lookupAd, getCampaignById: lookupCampaign } = await import('./db/index.js');

    const enrichedAds = ranked.map((ad) => {
      const adRecord = lookupAd(db, ad.ad_id);
      if (!adRecord) return ad;
      const camp = lookupCampaign(db, adRecord.campaign_id);
      if (camp?.verification_type === 'on_chain' && developer?.wallet_address && developer?.referral_code) {
        return {
          ...ad,
          verification_type: 'on_chain' as const,
          referral_link: buildReferralLink(ad.link_url, developer.referral_code, developer.wallet_address),
          referral_code: developer.referral_code,
          conversion_instructions: 'User must transact via referral link. Report conversion with tx_hash and chain_id.',
        };
      }
      return ad;
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ ads: enrichedAds }, null, 2),
        },
      ],
    };
  },
);

server.tool(
  'report_event',
  'Report an ad event (impression, click, or conversion). For on-chain verified campaigns, conversions require tx_hash and chain_id.',
  {
    ad_id: z.string().describe('The ad_id from search_ads results'),
    event_type: z.enum(['impression', 'click', 'conversion']).describe('Type of event'),
    context_hash: z.string().optional().describe('Hash of the message containing the ad (for verification)'),
    metadata: z.record(z.unknown()).optional().describe('Additional event metadata'),
    tx_hash: z.string().optional().describe('Transaction hash for on-chain verified conversions'),
    chain_id: z.number().optional().describe('Chain ID for on-chain verified conversions (e.g. 8453 for Base)'),
  },
  async (params, extra) => {
    logToolCall('report_event', extra.sessionId);
    const auth = requireAuth(extra, 'developer');
    checkRateLimit(extra, 'report_event');
    const { getAdById, insertEvent, updateAdStats, updateCampaignSpent, updateCampaignStatus, getCampaignById, findEventByTxHash, updateEventVerification } = await import('./db/index.js');

    const ad = getAdById(db, params.ad_id);
    if (!ad) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Ad not found' }) }], isError: true };
    }

    const campaign = getCampaignById(db, ad.campaign_id);
    if (!campaign || campaign.status !== 'active') {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Campaign not active' }) }], isError: true };
    }

    // ─── On-chain verification for conversions ─────────────────────────────
    const isOnChainConversion = campaign.verification_type === 'on_chain' && params.event_type === 'conversion';

    if (isOnChainConversion) {
      // Require tx_hash and chain_id for on-chain conversions
      if (!params.tx_hash || !params.chain_id) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'On-chain verified conversions require tx_hash and chain_id' }) }], isError: true };
      }

      // Check tx_hash uniqueness (prevent double-reporting)
      const existingEvent = findEventByTxHash(db, params.tx_hash);
      if (existingEvent) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Transaction already reported', existing_event_id: existingEvent.id, verification_status: existingEvent.verification_status }) }], isError: true };
      }

      // Require developer to have a registered wallet
      const developer = getDeveloperById(db, auth.entity_id);
      if (!developer?.wallet_address) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Wallet not registered. Use register_wallet tool first.' }) }], isError: true };
      }

      // Verify on-chain (5s timeout)
      const verification = await verifyConversion(
        params.tx_hash,
        params.chain_id,
        developer.wallet_address,
        campaign.contract_address ?? undefined,
        db,
        5000,
      );

      if (verification.status === 'rejected') {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'On-chain verification failed', reason: verification.reason }) }], isError: true };
      }

      // Anti-fraud: dedup by swapper address per campaign (1 conversion per swapper per 24h)
      const swapperAddress = verification.details?.swapper_address;
      if (swapperAddress) {
        const swapperDupe = db.prepare(`
          SELECT e.id FROM events e
          JOIN ads a ON e.ad_id = a.id
          WHERE a.campaign_id = ?
            AND e.verification_details LIKE ?
            AND e.event_type = 'conversion'
            AND e.created_at >= datetime('now', '-24 hours')
          LIMIT 1
        `).get(campaign.id, `%"swapper_address":"${swapperAddress}"%`) as { id: string } | undefined;
        if (swapperDupe) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'Duplicate conversion: this wallet already converted for this campaign in the last 24 hours', existing_event_id: swapperDupe.id }) }], isError: true };
        }
      }

      // Verified or pending — proceed to insert event
      const cost = verification.status === 'verified' ? campaign.bid_amount : 0; // Pending = no payout yet
      const developerRevenue = cost * 0.7;
      const platformRevenue = cost * 0.3;

      if (cost > 0 && campaign.spent + cost > campaign.total_budget) {
        updateCampaignStatus(db, campaign.id, 'paused');
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Campaign budget exhausted', campaign_paused: true }) }], isError: true };
      }

      // Insert event — catch UNIQUE constraint violation (TOCTOU race on tx_hash)
      let event;
      try {
        const processEvent = db.transaction(() => {
          const ev = insertEvent(db, {
            ad_id: params.ad_id,
            developer_id: auth.entity_id,
            event_type: 'conversion',
            amount_charged: cost,
            developer_revenue: developerRevenue,
            platform_revenue: platformRevenue,
            context_hash: params.context_hash,
            metadata: params.metadata,
            tx_hash: params.tx_hash,
            chain_id: params.chain_id,
            verification_status: verification.status,
            verification_details: verification.details,
          });

          updateAdStats(db, params.ad_id, 'conversion', cost);
          if (cost > 0) {
            updateCampaignSpent(db, campaign.id, cost);
            const updated = getCampaignById(db, campaign.id);
            if (updated && updated.spent >= updated.total_budget) {
              updateCampaignStatus(db, campaign.id, 'paused');
            }
          }

          return ev;
        });

        event = processEvent();
      } catch (err) {
        // Handle concurrent tx_hash submission (TOCTOU race)
        if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'Transaction already reported (concurrent submission)' }) }], isError: true };
        }
        throw err;
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            event_id: event.id,
            event_type: 'conversion',
            verification_status: verification.status,
            amount_charged: cost,
            developer_revenue: developerRevenue,
            remaining_budget: campaign.total_budget - campaign.spent - cost,
            ...(verification.status === 'pending' ? { message: 'Transaction pending verification. Check status with get_verification_status.' } : {}),
            ...(verification.details ? { verification_details: verification.details } : {}),
          }),
        }],
      };
    }

    // ─── Standard (trust-based) event flow ─────────────────────────────────

    // Event deduplication: reject duplicate (developer_id, ad_id, event_type) within window
    const dedupWindows: Record<string, number> = { impression: 60, click: 300, conversion: 3600 };
    const dedupSeconds = dedupWindows[params.event_type] ?? 60;
    const recentDupe = db.prepare(`
      SELECT id FROM events
      WHERE developer_id = ? AND ad_id = ? AND event_type = ?
        AND created_at >= datetime('now', '-' || ? || ' seconds')
      LIMIT 1
    `).get(auth.entity_id, params.ad_id, params.event_type, dedupSeconds) as { id: string } | undefined;
    if (recentDupe) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Duplicate event — already reported recently', existing_event_id: recentDupe.id }) }], isError: true };
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

    // Check budget
    if (campaign.spent + cost > campaign.total_budget) {
      updateCampaignStatus(db, campaign.id, 'paused');
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Campaign budget exhausted', campaign_paused: true }) }], isError: true };
    }

    // Revenue split: 70% developer, 30% platform
    const developerRevenue = cost * 0.7;
    const platformRevenue = cost * 0.3;

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
      const updated = getCampaignById(db, campaign.id);
      if (updated && updated.spent >= updated.total_budget) {
        updateCampaignStatus(db, campaign.id, 'paused');
      }

      return event;
    });

    const event = processEvent();

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          event_id: event.id,
          event_type: params.event_type,
          amount_charged: cost,
          developer_revenue: developerRevenue,
          remaining_budget: campaign.total_budget - campaign.spent - cost,
        }),
      }],
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

// ─── create_ad ──────────────────────────────────────────────────────────────

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

    // Validate creative_text for prompt injection patterns
    if (params.creative_text.length > 0) {
      const validation = validateCreativeText(params.creative_text);
      if (!validation.valid) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: `Creative text rejected: ${validation.reason}` }) }], isError: true };
      }
    }

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

// ─── Wallet & Verification Tools ─────────────────────────────────────────────

server.tool(
  'register_wallet',
  'Register a wallet address for receiving on-chain conversion payouts. Optionally provide a signature to prove ownership (EIP-191).',
  {
    wallet_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe('Ethereum wallet address (0x...)'),
    signature: z.string().optional().describe('Optional EIP-191 signature of challenge message to prove wallet ownership'),
    timestamp: z.string().optional().describe('Timestamp used in challenge message (required if signature provided)'),
  },
  async (params, extra) => {
    logToolCall('register_wallet', extra.sessionId);
    const auth = requireAuth(extra, 'developer');
    checkRateLimit(extra, 'register_wallet');

    // Optional signature verification (for developers who want extra security)
    if (params.signature) {
      if (!params.timestamp) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'timestamp is required when providing a signature' }) }], isError: true };
      }
      const message = buildRegisterMessage(auth.entity_id, params.timestamp);
      const valid = verifyWalletSignature(params.wallet_address, message, params.signature);
      if (!valid) {
        return { content: [{ type: 'text', text: JSON.stringify({ error: 'Signature verification failed. Message must be: ' + message }) }], isError: true };
      }
    }

    // Check wallet not already claimed by another developer
    const existing = findDeveloperByWallet(db, params.wallet_address);
    if (existing && existing.id !== auth.entity_id) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Wallet already registered by another developer' }) }], isError: true };
    }

    const referralCode = generateReferralCode(params.wallet_address);
    const developer = updateDeveloperWallet(db, auth.entity_id, params.wallet_address, referralCode);

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          wallet_address: developer.wallet_address,
          referral_code: developer.referral_code,
          message: 'Wallet registered. On-chain campaign ads will now include your referral link.',
        }),
      }],
    };
  },
);

server.tool(
  'get_verification_status',
  'Check the verification status of a conversion event (verified, pending, or rejected).',
  {
    event_id: z.string().describe('The event_id returned by report_event'),
  },
  async (params, extra) => {
    logToolCall('get_verification_status', extra.sessionId);
    const auth = requireAuth(extra, 'developer');
    checkRateLimit(extra, 'get_verification_status');
    const { getEventById } = await import('./db/index.js');

    const event = getEventById(db, params.event_id);
    if (!event) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Event not found' }) }], isError: true };
    }
    if (event.developer_id !== auth.entity_id) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Not authorized to view this event' }) }], isError: true };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          event_id: event.id,
          event_type: event.event_type,
          verification_status: event.verification_status,
          verified_at: event.verified_at,
          tx_hash: event.tx_hash,
          chain_id: event.chain_id,
          amount_charged: event.amount_charged,
          developer_revenue: event.developer_revenue,
          verification_details: event.verification_details,
        }),
      }],
    };
  },
);


// ─── Withdrawal Tool ──────────────────────────────────────────────────────────

server.tool(
  'request_withdrawal',
  'Request a withdrawal of earned USDC.e to your registered Base wallet. Minimum $1.00, maximum $50.00 per request. Rate limited to 1 per hour.',
  {
    amount: z.number().min(1).max(50).optional().describe('Amount in USD to withdraw. If omitted, withdraws full available balance (up to $50).'),
  },
  async (params, extra) => {
    logToolCall('request_withdrawal', extra.sessionId);
    const auth = requireAuth(extra, 'developer');
    checkRateLimit(extra, 'request_withdrawal');

    // Check if payments are enabled
    if (!isPaymentEnabled()) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Withdrawals are not enabled on this server (WALLET_PRIVATE_KEY not configured)' }) }], isError: true };
    }

    // Get developer info
    const developer = getDeveloperById(db, auth.entity_id);
    if (!developer) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Developer not found' }) }], isError: true };
    }
    if (!developer.wallet_address) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'No wallet registered. Call register_wallet first.' }) }], isError: true };
    }

    // Check rate limit (1 per hour)
    const recent = getRecentWithdrawal(db, auth.entity_id, 60);
    if (recent) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Rate limited: 1 withdrawal per hour. Last withdrawal: ' + recent.created_at }) }], isError: true };
    }

    // Calculate available balance
    const totalEarned = getDeveloperEarningsTotal(db, auth.entity_id);
    const totalWithdrawn = getTotalWithdrawn(db, auth.entity_id);
    const available = Math.round((totalEarned - totalWithdrawn) * 100) / 100;

    if (available < 1) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Minimum withdrawal is $1.00. Available: $' + available.toFixed(2) }) }], isError: true };
    }

    const amount = Math.min(params.amount ?? available, available, 50);
    if (amount < 1) {
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Withdrawal amount must be at least $1.00' }) }], isError: true };
    }

    // Create withdrawal record
    const withdrawal = createWithdrawal(db, {
      developer_id: auth.entity_id,
      amount,
      wallet_address: developer.wallet_address,
    });

    // Execute USDC transfer
    const result = await sendUsdc(developer.wallet_address, amount);

    if (result.success) {
      const completed = completeWithdrawal(db, withdrawal.id, result.tx_hash!);
      console.error(`[agentic-ads] Withdrawal completed: $${amount} USDC.e to ${developer.wallet_address} (tx: ${result.tx_hash})`);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            withdrawal_id: completed.id,
            amount: completed.amount,
            wallet_address: completed.wallet_address,
            tx_hash: completed.tx_hash,
            status: 'completed',
            explorer_url: `https://basescan.org/tx/${completed.tx_hash}`,
            remaining_balance: Math.round((available - amount) * 100) / 100,
          }),
        }],
      };
    } else {
      failWithdrawal(db, withdrawal.id, result.error ?? 'Unknown error');
      return { content: [{ type: 'text', text: JSON.stringify({ error: 'Withdrawal failed: ' + result.error, withdrawal_id: withdrawal.id }) }], isError: true };
    }
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
        version: '0.2.0',
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
      res.end(JSON.stringify({ status: 'ok', server: 'agentic-ads', version: '0.2.0' }));
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

    // ─── GET /dev/register — Self-serve registration form ─────────────────────
    if (url.pathname === '/dev/register' && req.method === 'GET') {
      const host = req.headers.host;
      const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : (host?.includes('localhost') ? 'http' : 'https');
      const publicBase = host ? `${proto}://${host}` : `http://localhost:${port}`;

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Register — Agentic Ads</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0a; color: #e0e0e0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #1a1a2e; border: 1px solid #333; border-radius: 12px; padding: 2rem; max-width: 480px; width: 100%; margin: 1rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; color: #fff; }
    .subtitle { color: #888; margin-bottom: 1.5rem; font-size: 0.9rem; }
    label { display: block; font-size: 0.85rem; color: #aaa; margin-bottom: 0.3rem; margin-top: 1rem; }
    input, textarea { width: 100%; padding: 0.6rem 0.8rem; background: #0d0d1a; border: 1px solid #444; border-radius: 6px; color: #fff; font-size: 0.95rem; }
    input:focus, textarea:focus { outline: none; border-color: #6c63ff; }
    textarea { resize: vertical; min-height: 60px; font-family: inherit; }
    button { width: 100%; margin-top: 1.5rem; padding: 0.7rem; background: #6c63ff; color: #fff; border: none; border-radius: 6px; font-size: 1rem; cursor: pointer; font-weight: 600; }
    button:hover { background: #5a52d5; }
    button:disabled { background: #444; cursor: not-allowed; }
    .result { margin-top: 1.5rem; padding: 1rem; background: #0d2818; border: 1px solid #1a5c2e; border-radius: 8px; display: none; }
    .result.error { background: #2d0a0a; border-color: #5c1a1a; }
    .result h3 { font-size: 0.9rem; margin-bottom: 0.5rem; }
    .key-box { background: #000; padding: 0.5rem 0.8rem; border-radius: 4px; font-family: monospace; font-size: 0.85rem; word-break: break-all; margin: 0.5rem 0; user-select: all; }
    .copy-btn { background: #333; border: 1px solid #555; color: #ccc; padding: 0.3rem 0.8rem; border-radius: 4px; cursor: pointer; font-size: 0.8rem; margin-top: 0.3rem; }
    .copy-btn:hover { background: #444; }
    .info { font-size: 0.8rem; color: #888; margin-top: 0.5rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Get Your API Key</h1>
    <p class="subtitle">Register to start monetizing your MCP server with ads. Takes 10 seconds.</p>
    <form id="regForm">
      <label for="name">Name / Project Name *</label>
      <input type="text" id="name" name="name" required placeholder="My MCP Bot">
      <label for="email">Email *</label>
      <input type="email" id="email" name="email" required placeholder="you@example.com">
      <label for="project_description">Project Description (optional)</label>
      <textarea id="project_description" name="project_description" placeholder="Brief description of your MCP server or agent..." maxlength="500"></textarea>
      <button type="submit" id="submitBtn">Get API Key</button>
    </form>
    <div class="result" id="result"></div>
  </div>
  <script>
    const form = document.getElementById('regForm');
    const resultDiv = document.getElementById('result');
    const submitBtn = document.getElementById('submitBtn');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      submitBtn.disabled = true;
      submitBtn.textContent = 'Registering...';
      resultDiv.style.display = 'none';
      try {
        const body = {
          name: document.getElementById('name').value.trim(),
          email: document.getElementById('email').value.trim(),
        };
        const desc = document.getElementById('project_description').value.trim();
        if (desc) body.project_description = desc;
        const res = await fetch('${publicBase}/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
          resultDiv.className = 'result error';
          resultDiv.innerHTML = '<h3>Registration Failed</h3><p>' + (data.error || 'Unknown error') + '</p>';
        } else {
          resultDiv.className = 'result';
          resultDiv.innerHTML =
            '<h3>Registration Successful!</h3>' +
            '<p>Your API key (save it — shown only once):</p>' +
            '<div class="key-box" id="apiKey">' + data.api_key + '</div>' +
            '<button class="copy-btn" onclick="navigator.clipboard.writeText(document.getElementById(\\'apiKey\\').textContent)">Copy Key</button>' +
            '<p class="info">MCP URL: <code>' + data.mcp_url + '</code></p>' +
            '<p class="info">Developer ID: <code>' + data.developer_id + '</code></p>';
        }
        resultDiv.style.display = 'block';
      } catch (err) {
        resultDiv.className = 'result error';
        resultDiv.innerHTML = '<h3>Error</h3><p>' + err.message + '</p>';
        resultDiv.style.display = 'block';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Get API Key';
      }
    });
  </script>
</body>
</html>`);
      return;
    }

    // ─── REST: POST /api/register ─────────────────────────────────────────────
    if (url.pathname === '/api/register' && req.method === 'POST') {
      // IP-based rate limiting (5 registrations per hour per IP)
      const clientIp = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket.remoteAddress ?? 'unknown';
      const regRateResult = rateLimiter.check(clientIp, '__register');
      if (!regRateResult.allowed) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(Math.ceil((regRateResult.retryAfterMs ?? 1000) / 1000)) });
        res.end(JSON.stringify({ error: 'Too many registrations. Try again later.' }));
        return;
      }

      // Read body with size limit
      let body = '';
      let bodyTooLarge = false;
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
        if (body.length > MAX_BODY_SIZE) {
          bodyTooLarge = true;
          req.destroy();
        }
      });
      req.on('end', () => {
        if (bodyTooLarge) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Request body too large (max 10KB)' }));
          return;
        }

        let parsed: { name?: unknown; email?: unknown; project_description?: unknown };
        try {
          parsed = JSON.parse(body) as { name?: unknown; email?: unknown; project_description?: unknown };
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON body' }));
          return;
        }

        const name = parsed.name;
        const email = parsed.email;
        const projectDescription = parsed.project_description;

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

        // Validate project_description (optional, string, max 500 chars)
        if (projectDescription !== undefined && projectDescription !== null) {
          if (typeof projectDescription !== 'string') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'project_description must be a string' }));
            return;
          }
          if (projectDescription.length > 500) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'project_description must be 500 characters or less' }));
            return;
          }
        }

        try {
          const developer = createDeveloper(db, {
            name: name.trim(),
            email,
            project_description: typeof projectDescription === 'string' ? projectDescription.trim() : undefined,
          });
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

    // ─── REST: GET /api/search ────────────────────────────────────────────────
    // Convenience endpoint for testing search_ads without MCP tooling.
    // Usage: GET /api/search?query=shoes&max_results=3&min_relevance=0.3
    // Auth: optional api_key query param OR Authorization: Bearer <key> header.
    if (url.pathname === '/api/search' && req.method === 'GET') {
      // Optional auth (api_key query param or Authorization header)
      const queryApiKey = url.searchParams.get('api_key');
      const rawKey = queryApiKey ?? extractKeyFromHeader(req.headers.authorization);
      let searchAuth: AuthContext | null = null;
      if (rawKey) {
        try {
          searchAuth = authenticate(db, rawKey);
        } catch (err) {
          if (err instanceof AuthError) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
            return;
          }
          throw err;
        }
      }

      // Parse query params
      const query = url.searchParams.get('query') ?? undefined;
      const keywordsParam = url.searchParams.get('keywords');
      const keywords = keywordsParam ? keywordsParam.split(',').map((k) => k.trim()).filter(Boolean) : undefined;
      const category = url.searchParams.get('category') ?? undefined;
      const geo = url.searchParams.get('geo') ?? undefined;
      const language = url.searchParams.get('language') ?? 'en';

      const rawMaxResults = url.searchParams.get('max_results');
      const maxResults = rawMaxResults ? Math.min(Math.max(parseInt(rawMaxResults, 10) || 3, 1), 10) : 3;

      const rawMinRelevance = url.searchParams.get('min_relevance');
      const minRelevance = rawMinRelevance ? Math.min(Math.max(parseFloat(rawMinRelevance) || 0, 0), 1) : 0;

      // Require at least one search dimension
      if (!query && !keywords?.length && !category) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Provide at least one of: query, keywords, category' }));
        return;
      }

      const { matchAds: restMatchAds, rankAds: restRankAds } = await import('./matching/index.js');

      const activeAds = getActiveAds(db, { geo, language });

      if (activeAds.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ads: [], count: 0 }));
        return;
      }

      const candidates = activeAds.map((ad) => {
        const camp = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(ad.campaign_id) as { bid_amount: number; advertiser_id: string };
        const adv = db.prepare('SELECT * FROM advertisers WHERE id = ?').get(camp.advertiser_id) as { name: string };
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
          bid_amount: camp.bid_amount,
          advertiser_name: adv.name,
        };
      });

      const matches = restMatchAds({ query, keywords, category, geo, language }, candidates);
      const ranked = restRankAds(matches, maxResults).filter((ad) => ad.relevance_score >= minRelevance);

      // Enrich with referral links for authenticated developers
      let developer: { wallet_address: string | null; referral_code: string | null } | null = null;
      if (searchAuth?.entity_type === 'developer') {
        developer = getDeveloperById(db, searchAuth.entity_id);
      }

      const { getAdById: restLookupAd, getCampaignById: restLookupCampaign } = await import('./db/index.js');

      const enriched = ranked.map((ad) => {
        const adRecord = restLookupAd(db, ad.ad_id);
        if (!adRecord) return ad;
        const camp = restLookupCampaign(db, adRecord.campaign_id);
        if (camp?.verification_type === 'on_chain' && developer?.wallet_address && developer?.referral_code) {
          return {
            ...ad,
            verification_type: 'on_chain' as const,
            referral_link: buildReferralLink(ad.link_url, developer.referral_code, developer.wallet_address),
            referral_code: developer.referral_code,
            conversion_instructions: 'User must transact via referral link. Report conversion with tx_hash and chain_id.',
          };
        }
        return ad;
      });

      console.error(`[agentic-ads] GET /api/search query="${query ?? ''}" results=${enriched.length} ts=${new Date().toISOString()}`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ads: enriched, count: enriched.length }));
      return;
    }

    // ─── REST: POST /api/events ───────────────────────────────────────────────
    // Report an impression or click event for a given ad_id.
    // Auth: Authorization: Bearer <developer_api_key>
    // Body: { ad_id: string, event_type: "impression" | "click" }
    if (url.pathname === '/api/events' && req.method === 'POST') {
      const rawKey = extractKeyFromHeader(req.headers.authorization);
      if (!rawKey) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing Authorization: Bearer <api_key>' }));
        return;
      }
      let eventsAuth: AuthContext;
      try {
        eventsAuth = authenticate(db, rawKey);
      } catch (err) {
        if (err instanceof AuthError) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
          return;
        }
        throw err;
      }
      if (eventsAuth.entity_type !== 'developer') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Developer API key required' }));
        return;
      }

      let body = '';
      let bodyTooLarge = false;
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString();
        if (body.length > MAX_BODY_SIZE) { bodyTooLarge = true; req.destroy(); }
      });
      req.on('end', async () => {
        if (bodyTooLarge) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Request body too large' }));
          return;
        }
        let parsed: { ad_id?: unknown; event_type?: unknown };
        try {
          parsed = JSON.parse(body) as { ad_id?: unknown; event_type?: unknown };
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON body' }));
          return;
        }
        const ad_id = typeof parsed.ad_id === 'string' ? parsed.ad_id : null;
        const event_type = parsed.event_type;
        if (!ad_id) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'ad_id is required' }));
          return;
        }
        if (event_type !== 'impression' && event_type !== 'click') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'event_type must be "impression" or "click"' }));
          return;
        }

        const { getAdById: evGetAd, insertEvent: evInsert, updateAdStats: evUpdateStats, updateCampaignSpent: evUpdateSpent, updateCampaignStatus: evUpdateStatus, getCampaignById: evGetCampaign } = await import('./db/index.js');

        const ad = evGetAd(db, ad_id);
        if (!ad) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Ad not found' }));
          return;
        }
        const campaign = evGetCampaign(db, ad.campaign_id);
        if (!campaign || campaign.status !== 'active') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Campaign not active' }));
          return;
        }

        // Dedup: same developer+ad+event within window
        const dedupSeconds = event_type === 'impression' ? 60 : 300;
        const recentDupe = db.prepare(`
          SELECT id FROM events
          WHERE developer_id = ? AND ad_id = ? AND event_type = ?
            AND created_at >= datetime('now', '-' || ? || ' seconds')
          LIMIT 1
        `).get(eventsAuth.entity_id, ad_id, event_type, dedupSeconds) as { id: string } | undefined;
        if (recentDupe) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Duplicate event — already reported recently', existing_event_id: recentDupe.id }));
          return;
        }

        let cost = 0;
        if (campaign.pricing_model === 'cpm' && event_type === 'impression') {
          cost = campaign.bid_amount / 1000;
        } else if (campaign.pricing_model === 'cpc' && event_type === 'click') {
          cost = campaign.bid_amount;
        }

        if (campaign.spent + cost > campaign.total_budget) {
          evUpdateStatus(db, campaign.id, 'paused');
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Campaign budget exhausted' }));
          return;
        }

        const developerRevenue = cost * 0.7;
        const platformRevenue = cost * 0.3;

        const ev = db.transaction(() => {
          const e = evInsert(db, {
            ad_id,
            developer_id: eventsAuth.entity_id,
            event_type,
            amount_charged: cost,
            developer_revenue: developerRevenue,
            platform_revenue: platformRevenue,
          });
          evUpdateStats(db, ad_id, event_type, cost);
          if (cost > 0) evUpdateSpent(db, campaign.id, cost);
          const updated = evGetCampaign(db, campaign.id);
          if (updated && updated.spent >= updated.total_budget) evUpdateStatus(db, campaign.id, 'paused');
          return e;
        })();

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          event_id: ev.id,
          event_type,
          amount_charged: cost,
          developer_revenue: developerRevenue,
          remaining_budget: campaign.total_budget - campaign.spent - cost,
        }));
      });
      return;
    }

    // ─── REST: GET /api/earnings ──────────────────────────────────────────────
    // Get earnings summary for the authenticated developer.
    // Auth: Authorization: Bearer <developer_api_key>
    if (url.pathname === '/api/earnings' && req.method === 'GET') {
      const rawKey = extractKeyFromHeader(req.headers.authorization);
      if (!rawKey) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing Authorization: Bearer <api_key>' }));
        return;
      }
      let earningsAuth: AuthContext;
      try {
        earningsAuth = authenticate(db, rawKey);
      } catch (err) {
        if (err instanceof AuthError) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
          return;
        }
        throw err;
      }
      if (earningsAuth.entity_type !== 'developer') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Developer API key required' }));
        return;
      }

      const devId = earningsAuth.entity_id;
      const totals = db.prepare(`
        SELECT
          COALESCE(SUM(developer_revenue), 0)                                          AS total_earnings,
          COALESCE(SUM(CASE WHEN event_type = 'impression' THEN 1 ELSE 0 END), 0)     AS total_impressions,
          COALESCE(SUM(CASE WHEN event_type = 'click'      THEN 1 ELSE 0 END), 0)     AS total_clicks,
          COALESCE(SUM(CASE WHEN event_type = 'conversion' THEN 1 ELSE 0 END), 0)     AS total_conversions
        FROM events WHERE developer_id = ?
      `).get(devId) as { total_earnings: number; total_impressions: number; total_clicks: number; total_conversions: number };

      function sqliteDt(d: Date): string {
        return d.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
      }
      const now = new Date();
      function earningsSinceRest(dt: Date): number {
        const row = db.prepare(`SELECT COALESCE(SUM(developer_revenue), 0) AS total FROM events WHERE developer_id = ? AND created_at >= ?`).get(devId, sqliteDt(dt)) as { total: number };
        return row.total;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        total_earnings: totals.total_earnings,
        total_impressions: totals.total_impressions,
        total_clicks: totals.total_clicks,
        total_conversions: totals.total_conversions,
        period_earnings: {
          last_24h: earningsSinceRest(new Date(now.getTime() - 24 * 60 * 60 * 1000)),
          last_7d:  earningsSinceRest(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)),
          last_30d: earningsSinceRest(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)),
          all_time: totals.total_earnings,
        },
      }));
      return;
    }

    // 404 for anything else
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. Use /mcp for MCP protocol, /health for health check, POST /api/register to create a developer account, GET /api/search to search ads, POST /api/events to report events, or GET /api/earnings to check earnings.' }));
  });

  httpServer.listen(port, () => {
    console.error(`[agentic-ads] MCP server listening on http://localhost:${port}/mcp`);
    console.error(`[agentic-ads] Health check: http://localhost:${port}/health`);
  });
}

// ─── Background Verification Worker ─────────────────────────────────────────
// Processes pending on-chain verifications every 30 seconds.
// Only runs in HTTP mode (long-lived server process).

async function processVerificationQueue() {
  const { getPendingVerifications, updateEventVerification, getAdById, getCampaignById, updateAdStats, updateCampaignSpent, updateCampaignStatus } = await import('./db/index.js');

  const pending = getPendingVerifications(db, 10);
  if (pending.length === 0) return;

  console.error(`[agentic-ads] Processing ${pending.length} pending verifications...`);

  for (const event of pending) {
    if (!event.tx_hash || !event.chain_id) continue;

    const developer = getDeveloperById(db, event.developer_id);
    if (!developer?.wallet_address) continue;

    const ad = getAdById(db, event.ad_id);
    if (!ad) continue;

    const campaign = getCampaignById(db, ad.campaign_id);
    if (!campaign) continue;

    try {
      const result = await verifyConversion(
        event.tx_hash,
        event.chain_id,
        developer.wallet_address,
        campaign.contract_address ?? undefined,
        db,
        5000,
      );

      if (result.status === 'verified') {
        const cost = campaign.bid_amount;
        const developerRevenue = cost * 0.7;
        const platformRevenue = cost * 0.3;

        db.transaction(() => {
          updateEventVerification(db, event.id, 'verified', { ...result.details, amount_charged: cost, developer_revenue: developerRevenue, platform_revenue: platformRevenue });
          // Update the event's financial fields
          db.prepare('UPDATE events SET amount_charged = ?, developer_revenue = ?, platform_revenue = ? WHERE id = ?')
            .run(cost, developerRevenue, platformRevenue, event.id);
          updateAdStats(db, event.ad_id, 'conversion', cost);
          updateCampaignSpent(db, campaign.id, cost);
          const updated = getCampaignById(db, campaign.id);
          if (updated && updated.spent >= updated.total_budget) {
            updateCampaignStatus(db, campaign.id, 'paused');
          }
        })();

        console.error(`[agentic-ads] Verified: event=${event.id} tx=${event.tx_hash}`);
      } else if (result.status === 'rejected') {
        updateEventVerification(db, event.id, 'rejected', { reason: result.reason });
        console.error(`[agentic-ads] Rejected: event=${event.id} reason=${result.reason}`);
      }
      // If still pending, skip — will retry next cycle
    } catch (err) {
      console.error(`[agentic-ads] Verification error for event=${event.id}:`, err);
    }
  }
}

function startVerificationWorker() {
  // Run every 30 seconds
  const interval = setInterval(() => {
    processVerificationQueue().catch(err => {
      console.error('[agentic-ads] Verification worker error:', err);
    });
  }, 30_000);
  // Don't block process exit
  interval.unref();
  console.error('[agentic-ads] Background verification worker started (30s interval)');
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
  startVerificationWorker();
}
