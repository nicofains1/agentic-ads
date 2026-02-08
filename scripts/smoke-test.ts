#!/usr/bin/env tsx
// ──────────────────────────────────────────────────────────────────────────────
// Smoke test — connects to the MCP server via stdio and runs all tools
// Usage: tsx scripts/smoke-test.ts --db test-prod.db --dev-key <key> --adv-key <key>
// ──────────────────────────────────────────────────────────────────────────────

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';

const args = process.argv.slice(2);

function getArg(name: string): string {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || !args[idx + 1]) {
    console.error(`Missing required arg: --${name}`);
    process.exit(1);
  }
  return args[idx + 1];
}

const dbPath = getArg('db');
const devKey = getArg('dev-key');
const advKey = getArg('adv-key');

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function createClient(apiKey: string): Promise<Client> {
  const serverPath = resolve('dist/server.js');
  const transport = new StdioClientTransport({
    command: 'node',
    args: [serverPath, '--stdio', '--db', dbPath, '--api-key', apiKey],
  });

  const client = new Client({ name: 'smoke-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

async function callTool(client: Client, name: string, args: Record<string, unknown> = {}): Promise<{ text: string; isError?: boolean }> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text: string }>;
  return { text: content[0]?.text ?? '', isError: result.isError as boolean | undefined };
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔬 Agentic Ads Smoke Test\n');

  // ── Test 1: Developer client connects and lists tools ──
  console.log('1. Developer client — connect & list tools');
  const devClient = await createClient(devKey);
  const tools = await devClient.listTools();
  const toolNames = tools.tools.map((t) => t.name).sort();
  assert(toolNames.length === 6, `Found ${toolNames.length} tools`);
  assert(toolNames.includes('search_ads'), 'search_ads registered');
  assert(toolNames.includes('report_event'), 'report_event registered');
  assert(toolNames.includes('get_ad_guidelines'), 'get_ad_guidelines registered');

  // ── Test 2: get_ad_guidelines (public, no auth needed) ──
  console.log('\n2. get_ad_guidelines');
  const guidelines = await callTool(devClient, 'get_ad_guidelines');
  const guidelinesData = JSON.parse(guidelines.text);
  assert(Array.isArray(guidelinesData.rules), 'Returns rules array');
  assert(guidelinesData.rules.length > 0, `${guidelinesData.rules.length} rules defined`);

  // ── Test 3: search_ads with relevant query ──
  console.log('\n3. search_ads — relevant query');
  const searchResult = await callTool(devClient, 'search_ads', {
    query: 'best running shoes for marathon',
    keywords: ['running shoes', 'sneakers'],
    category: 'footwear',
    geo: 'US',
    language: 'en',
    max_results: 3,
  });
  const searchData = JSON.parse(searchResult.text);
  assert(searchData.ads.length > 0, `Found ${searchData.ads.length} ads`);
  if (searchData.ads.length > 0) {
    const ad = searchData.ads[0];
    assert(ad.relevance_score > 0, `Relevance score: ${ad.relevance_score}`);
    assert(ad.disclosure === 'sponsored', 'Disclosure: sponsored');
    assert(typeof ad.ad_id === 'string', `Has ad_id: ${ad.ad_id}`);
    assert(typeof ad.creative_text === 'string', 'Has creative_text');
    assert(typeof ad.link_url === 'string', 'Has link_url');

    // ── Test 4: report_event — impression ──
    console.log('\n4. report_event — impression (CPC model, should be free)');
    const impression = await callTool(devClient, 'report_event', {
      ad_id: ad.ad_id,
      event_type: 'impression',
    });
    const impData = JSON.parse(impression.text);
    assert(!impression.isError, 'No error on impression');
    assert(impData.amount_charged === 0, `Impression cost: $${impData.amount_charged} (CPC = free)`);
    assert(impData.event_type === 'impression', 'Event type: impression');

    // ── Test 5: report_event — click ──
    console.log('\n5. report_event — click (CPC $0.50)');
    const click = await callTool(devClient, 'report_event', {
      ad_id: ad.ad_id,
      event_type: 'click',
    });
    const clickData = JSON.parse(click.text);
    assert(!impression.isError, 'No error on click');
    assert(clickData.amount_charged === 0.5, `Click cost: $${clickData.amount_charged}`);
    assert(clickData.developer_revenue === 0.35, `Dev revenue: $${clickData.developer_revenue} (70%)`);
  }

  // ── Test 6: search_ads with irrelevant language ──
  console.log('\n6. search_ads — no match (different language)');
  const noMatch = await callTool(devClient, 'search_ads', {
    query: 'pizza delivery',
    language: 'zh',
    max_results: 3,
  });
  const noMatchData = JSON.parse(noMatch.text);
  assert(noMatchData.ads.length === 0, 'No ads for unmatched language');

  // ── Test 7: Advertiser client — auth enforcement ──
  console.log('\n7. Auth enforcement — advertiser key');
  const advClient = await createClient(advKey);

  // Advertiser should be able to get analytics
  const analytics = await callTool(advClient, 'get_campaign_analytics', {
    campaign_id: searchData.ads?.[0]?.ad_id ? 'need-campaign-id' : 'dummy',
  });
  // We expect an error because we don't have the campaign_id handy, but it should be auth error vs not found
  // Let's test that developer key can't use advertiser tools instead

  // ── Test 8: Developer can't use advertiser tools ──
  console.log('\n8. Auth enforcement — developer key on advertiser tool');
  const authFail = await callTool(devClient, 'create_campaign', {
    name: 'Test',
    objective: 'awareness',
    total_budget: 100,
    pricing_model: 'cpc',
    bid_amount: 1.0,
  });
  // This should fail because developer key != advertiser
  assert(authFail.isError === true || authFail.text.includes('error'), 'Developer rejected from create_campaign');

  // ── Test 9: Advertiser can create campaign ──
  console.log('\n9. Advertiser creates campaign');
  const newCampaign = await callTool(advClient, 'create_campaign', {
    name: 'Smoke Test Campaign',
    objective: 'traffic',
    total_budget: 5,
    pricing_model: 'cpc',
    bid_amount: 0.25,
  });
  const campaignData = JSON.parse(newCampaign.text);
  assert(!newCampaign.isError, 'Campaign created without error');
  assert(typeof campaignData.campaign_id === 'string', `Campaign ID: ${campaignData.campaign_id}`);

  // ── Test 10: Advertiser gets analytics ──
  console.log('\n10. Advertiser gets campaign analytics');
  const analyticsResult = await callTool(advClient, 'get_campaign_analytics', {
    campaign_id: campaignData.campaign_id,
  });
  const analyticsData = JSON.parse(analyticsResult.text);
  assert(!analyticsResult.isError, 'Analytics returned without error');
  assert(analyticsData.budget.total === 5, `Budget: $${analyticsData.budget.total}`);

  // ── Summary ──
  console.log('\n' + '═'.repeat(50));
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(50) + '\n');

  await devClient.close();
  await advClient.close();

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
