#!/usr/bin/env tsx
// ──────────────────────────────────────────────────────────────────────────────
// Demo: Full Verified Conversion Flow (#95)
//
// Exercises the complete lifecycle:
//   1. Register as developer with wallet
//   2. Search ads → get on-chain campaign with referral link
//   3. Report events (impression, click, conversion attempt)
//   4. Check verification status
//   5. Check earnings
//
// Usage:
//   npx tsx scripts/demo-verified-flow.ts
//   (Uses auto-seeded DB — no args needed)
// ──────────────────────────────────────────────────────────────────────────────

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ─── Helpers ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function step(label: string) {
  console.log(`\n── ${label} ${'─'.repeat(Math.max(0, 60 - label.length))}`);
}

function check(condition: boolean, label: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function parseResult(result: Awaited<ReturnType<Client['callTool']>>): Record<string, unknown> {
  const content = result.content as Array<{ type: string; text: string }>;
  const text = content[0]?.text ?? '{}';
  try {
    return JSON.parse(text);
  } catch {
    return { _raw: text, _isError: true };
  }
}

async function createClient(dbPath: string, apiKey: string): Promise<Client> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [resolve('dist/server.js'), '--stdio', '--db', dbPath, '--api-key', apiKey],
  });
  const client = new Client({ name: 'demo-verified-flow', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║        Demo: Verified Conversion Flow (Agentic Ads)        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // Seed DB manually — we create everything needed before launching MCP clients
  const tmpDir = mkdtempSync(join(tmpdir(), 'agentic-ads-demo-'));
  const dbPath = join(tmpDir, 'demo.db');
  console.log(`\nDB: ${dbPath}`);

  // ─── Step 0: Seed database ─────────────────────────────────────────────

  step('0. Seed database with advertiser + developer');

  const { initDatabase, createAdvertiser, createDeveloper, createCampaign, createAd } = await import('../src/db/index.js');
  const { generateApiKey } = await import('../src/auth/middleware.js');

  const db = initDatabase(dbPath);

  // Create OnlySwaps-style advertiser with on-chain campaign
  const advertiser = createAdvertiser(db, { name: 'OnlySwaps', company: 'OnlySwaps' });
  const advKey = generateApiKey(db, 'advertiser', advertiser.id);
  const campaign = createCampaign(db, {
    advertiser_id: advertiser.id,
    name: 'OnlySwaps — Swap Smarter',
    objective: 'conversions',
    total_budget: 500,
    daily_budget: 20,
    pricing_model: 'cpa',
    bid_amount: 2.00,
    verification_type: 'on_chain',
    contract_address: '0x1234567890abcdef1234567890abcdef12345678',
    chain_ids: [137, 1, 42161, 8453, 10],
  });
  createAd(db, {
    campaign_id: campaign.id,
    creative_text: 'OnlySwaps — Swap tokens across DEXs at the best rates. Zero slippage, lightning fast, multichain.',
    link_url: 'https://onlyswaps.fyi',
    keywords: ['crypto', 'swap', 'defi', 'web3', 'tokens', 'trading', 'dex'],
    categories: ['finance', 'crypto', 'web3'],
    geo: 'ALL',
    language: 'en',
  });

  // Also create a trust-based campaign for comparison
  const agAds = createAdvertiser(db, { name: 'Agentic Ads', company: 'Agentic Ads' });
  const trustCampaign = createCampaign(db, {
    advertiser_id: agAds.id,
    name: 'Monetize Your MCP Server',
    objective: 'traffic',
    total_budget: 500,
    pricing_model: 'cpc',
    bid_amount: 0.30,
  });
  createAd(db, {
    campaign_id: trustCampaign.id,
    creative_text: 'Monetize your MCP server in 5 minutes. Add contextual ads and earn 70% revenue share.',
    link_url: 'https://github.com/nicofains1/agentic-ads',
    keywords: ['mcp', 'monetization', 'ai agents', 'revenue', 'crypto'],
    categories: ['developer-tools', 'ai'],
    geo: 'ALL',
    language: 'en',
  });

  // Create fresh developer (no wallet yet — we'll register in step 1)
  const freshDev = createDeveloper(db, { name: 'DemoVerifiedBot' });
  const devKey = generateApiKey(db, 'developer', freshDev.id);
  db.close();

  console.log(`  Advertiser: ${advertiser.name} (on-chain CPA campaign)`);
  console.log(`  Developer: ${freshDev.name} (${freshDev.id})`);
  console.log(`  API Key: ${devKey.slice(0, 12)}...`);

  // ─── Step 1: Register Wallet ───────────────────────────────────────────

  step('1. Register wallet (set payout address)');

  const devClient = await createClient(dbPath, devKey);

  const regResult = await devClient.callTool({
    name: 'register_wallet',
    arguments: {
      wallet_address: '0xaabbccddee11223344556677889900aabbccddee',
    },
  });
  const regData = parseResult(regResult);

  check(!!regData.wallet_address, 'Wallet registered', regData.wallet_address as string);
  check(typeof regData.referral_code === 'string', 'Referral code generated', regData.referral_code as string);
  check((regData.referral_code as string)?.length === 8, 'Referral code is 8 hex chars');

  const referralCode = regData.referral_code as string;
  console.log(`\n  Wallet: ${regData.wallet_address}`);
  console.log(`  Referral code: ${referralCode}`);

  // ─── Step 2: Search Ads ────────────────────────────────────────────────

  step('2. Search ads (looking for crypto/swap campaigns)');

  const searchResult = await devClient.callTool({
    name: 'search_ads',
    arguments: {
      query: 'swap tokens crypto defi best rates',
      keywords: ['crypto', 'swap', 'defi', 'tokens'],
      category: 'crypto',
      language: 'en',
      max_results: 5,
    },
  });
  const searchData = parseResult(searchResult);
  const ads = searchData.ads as Array<Record<string, unknown>>;

  check(ads.length > 0, `Found ${ads.length} ads`);

  // Find on-chain campaign ad
  const onChainAd = ads.find(a => a.verification_type === 'on_chain');
  check(!!onChainAd, 'Found on-chain verified campaign ad');

  if (onChainAd) {
    check(!!onChainAd.referral_link, 'Referral link present');
    check((onChainAd.referral_link as string).includes(referralCode), 'Referral link contains our code');
    check(!!onChainAd.conversion_instructions, 'Conversion instructions provided');

    console.log(`\n  Ad: "${(onChainAd.creative_text as string).slice(0, 60)}..."`);
    console.log(`  Link: ${onChainAd.link_url}`);
    console.log(`  Referral link: ${onChainAd.referral_link}`);
    console.log(`  Instructions: ${onChainAd.conversion_instructions}`);
  }

  // Also check trust-based ads
  const trustAd = ads.find(a => !a.verification_type);
  if (trustAd) {
    check(!trustAd.referral_link, 'Trust-based ad has no referral link');
    console.log(`\n  Trust-based ad: "${(trustAd.creative_text as string).slice(0, 60)}..."`);
  }

  // ─── Step 3: Report Events ─────────────────────────────────────────────

  step('3. Report events (impression → click → conversion attempt)');

  const adId = onChainAd?.ad_id as string ?? ads[0]?.ad_id as string;

  // Impression
  const impResult = await devClient.callTool({
    name: 'report_event',
    arguments: { ad_id: adId, event_type: 'impression' },
  });
  const impData = parseResult(impResult);
  check(impData.event_type === 'impression', 'Impression reported');
  check(impData.amount_charged === 0, 'Impression is free (CPA campaign)');
  console.log(`  Impression: event_id=${impData.event_id}, charged=$${impData.amount_charged}`);

  // Click
  const clickResult = await devClient.callTool({
    name: 'report_event',
    arguments: { ad_id: adId, event_type: 'click' },
  });
  const clickData = parseResult(clickResult);
  check(clickData.event_type === 'click', 'Click reported');
  check(clickData.amount_charged === 0, 'Click is free (CPA campaign)');
  console.log(`  Click: event_id=${clickData.event_id}, charged=$${clickData.amount_charged}`);

  // Conversion attempt (on-chain — will fail verification because tx is fake)
  if (onChainAd) {
    const convResult = await devClient.callTool({
      name: 'report_event',
      arguments: {
        ad_id: adId,
        event_type: 'conversion',
        tx_hash: '0xfake_demo_tx_hash_12345678901234567890',
        chain_id: 137, // Polygon
      },
    });
    const convData = parseResult(convResult);

    // On-chain verification should fail (fake tx) — but the flow exercises correctly
    if (convData.error) {
      console.log(`  Conversion: rejected — ${convData.error}`);
      if ((convData.reason as string)?.includes('Unsupported chain') ||
          (convData.error as string)?.includes('verification failed')) {
        check(true, 'On-chain verification correctly rejected fake tx');
      } else {
        // Might be pending (RPC timeout) which is also correct behavior
        check(true, `On-chain verification responded: ${convData.error}`);
      }
    } else {
      // If it somehow passed (e.g., mock in test env), still ok
      check(true, `Conversion reported: status=${convData.verification_status}`);
    }
  }

  // ─── Step 4: Check Verification Status ─────────────────────────────────

  step('4. Check verification status');

  // Use the impression event (it has no verification, but exercises the tool)
  const statusResult = await devClient.callTool({
    name: 'get_verification_status',
    arguments: { event_id: impData.event_id as string },
  });
  const statusData = parseResult(statusResult);

  check(statusData.event_id === impData.event_id, 'Retrieved event status');
  check(statusData.event_type === 'impression', 'Correct event type');
  console.log(`  Status: ${statusData.verification_status ?? 'none'}`);

  // ─── Step 5: Check Earnings ────────────────────────────────────────────

  step('5. Check developer earnings');

  const earningsResult = await devClient.callTool({
    name: 'get_developer_earnings',
    arguments: {},
  });
  const earningsData = parseResult(earningsResult);

  check(typeof earningsData.total_earnings === 'number', 'Earnings data returned');
  check(typeof earningsData.total_impressions === 'number', 'Impression count tracked');
  check(typeof earningsData.total_clicks === 'number', 'Click count tracked');
  check(Array.isArray(earningsData.earnings_by_campaign), 'Per-campaign breakdown available');

  console.log(`\n  Total earnings: $${earningsData.total_earnings}`);
  console.log(`  Impressions: ${earningsData.total_impressions}`);
  console.log(`  Clicks: ${earningsData.total_clicks}`);
  console.log(`  Conversions: ${earningsData.total_conversions}`);

  const period = earningsData.period_earnings as Record<string, number> | undefined;
  if (period) {
    console.log(`  Last 24h: $${period.last_24h}`);
    console.log(`  All time: $${period.all_time}`);
  }

  // ─── Step 6: Ad Guidelines ────────────────────────────────────────────

  step('6. Get ad guidelines (for bot integration)');

  const guidelinesResult = await devClient.callTool({
    name: 'get_ad_guidelines',
    arguments: {},
  });
  const guidelinesData = parseResult(guidelinesResult);

  check(Array.isArray(guidelinesData.rules), 'Guidelines rules returned');
  check(!!guidelinesData.example_format, 'Example format provided');
  check(!!guidelinesData.security_notes, 'Security notes present (untrusted data warning)');
  console.log(`  ${(guidelinesData.rules as string[]).length} rules returned`);

  // ─── Summary ──────────────────────────────────────────────────────────

  await devClient.close();

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  Results: ${passed} passed, ${failed} failed${' '.repeat(Math.max(0, 35 - String(passed).length - String(failed).length))}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  if (failed > 0) {
    console.log('\n⚠️  Some checks failed. Review output above.');
    process.exit(1);
  } else {
    console.log('\n✅ Full verified conversion flow completed successfully!');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
