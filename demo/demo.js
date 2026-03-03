#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// Agentic Ads — 5-Minute Integration Demo
// ─────────────────────────────────────────────────────────────────────────────
//
// What this demo does:
//   1. Registers a new publisher account (or reuses AGENTIC_ADS_API_KEY)
//   2. Fetches a sponsored recommendation for a sample query
//   3. Reports an impression + a simulated click via MCP
//   4. Shows your earnings in real time
//
// Requirements: Node.js 18+ (uses built-in fetch — zero npm install needed)
//
// Usage:
//   node demo.js
//   AGENTIC_ADS_API_KEY=aa_dev_... node demo.js   # reuse existing key
//
// ─────────────────────────────────────────────────────────────────────────────

const BASE_URL = process.env.AGENTIC_ADS_URL ?? 'https://agentic-ads-production.up.railway.app';
const SAMPLE_QUERY = process.env.DEMO_QUERY ?? 'best tools for AI agent developers';

// ANSI colours (no deps)
const c = {
  reset: '\x1b[0m',
  bold:  '\x1b[1m',
  green: '\x1b[32m',
  cyan:  '\x1b[36m',
  yellow:'\x1b[33m',
  grey:  '\x1b[90m',
  red:   '\x1b[31m',
};

function log(msg)  { process.stdout.write(msg + '\n'); }
function ok(msg)   { log(`${c.green}✓${c.reset} ${msg}`); }
function step(msg) { log(`\n${c.cyan}${c.bold}▶ ${msg}${c.reset}`); }
function info(msg) { log(`  ${c.grey}${msg}${c.reset}`); }
function warn(msg) { log(`${c.yellow}⚠ ${msg}${c.reset}`); }
function err(msg)  { log(`${c.red}✗ ${msg}${c.reset}`); }

// ─── MCP helper — opens a session, calls a tool, returns parsed result ────────

async function mcpCall(apiKey, toolName, toolArgs) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'Authorization': `Bearer ${apiKey}`,
  };

  // 1. Initialize session
  const initRes = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'agentic-ads-demo', version: '1.0.0' },
      },
    }),
  });

  const sessionId = initRes.headers.get('mcp-session-id');
  if (!sessionId) throw new Error('MCP init failed — no session ID');

  const sessionHeaders = { ...headers, 'mcp-session-id': sessionId };

  // 2. Initialized notification (required by MCP spec)
  await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: sessionHeaders,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
  });

  // 3. Call tool
  const callRes = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: sessionHeaders,
    body: JSON.stringify({
      jsonrpc: '2.0', id: 2,
      method: 'tools/call',
      params: { name: toolName, arguments: toolArgs },
    }),
  });

  // Parse SSE or plain JSON response
  const raw = await callRes.text();
  const dataLine = raw.split('\n').find(l => l.startsWith('data:'));
  const parsed = dataLine ? JSON.parse(dataLine.slice(5).trim()) : JSON.parse(raw);

  const text = parsed?.result?.content?.[0]?.text;
  if (!text) {
    const errMsg = parsed?.error?.message ?? 'no content in response';
    throw new Error(`Tool ${toolName} returned no content: ${errMsg}`);
  }
  return JSON.parse(text);
}

// ─── Main demo ────────────────────────────────────────────────────────────────

async function main() {
  log('');
  log(`${c.bold}╔══════════════════════════════════════════════════════╗${c.reset}`);
  log(`${c.bold}║       Agentic Ads — Publisher Integration Demo       ║${c.reset}`);
  log(`${c.bold}╚══════════════════════════════════════════════════════╝${c.reset}`);
  log('');
  log(`  Server: ${c.cyan}${BASE_URL}${c.reset}`);
  log(`  Query:  ${c.cyan}"${SAMPLE_QUERY}"${c.reset}`);
  log('');

  // ── Step 1: Get API Key ──────────────────────────────────────────────────

  step('Step 1/4 — Register as publisher (or reuse existing key)');

  let apiKey = process.env.AGENTIC_ADS_API_KEY;
  let developerId = null;

  if (apiKey) {
    ok(`Using existing API key from env: ${apiKey.slice(0, 20)}...`);
  } else {
    const demoName = `demo-bot-${Date.now()}`;
    const regRes = await fetch(`${BASE_URL}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: demoName, email: `${demoName}@demo.example.com` }),
    });

    if (!regRes.ok) {
      const body = await regRes.text();
      if (regRes.status === 429 || body.includes('Too many')) {
        err('Registration rate limit hit (5/hour per IP).');
        log('');
        log('  Save your key from a previous run and reuse it:');
        log(`  ${c.cyan}export AGENTIC_ADS_API_KEY="aa_dev_..."${c.reset}`);
        log(`  ${c.cyan}node demo.js${c.reset}`);
        log('');
        log('  Or try again in 1 hour.');
      } else {
        err(`Registration failed (${regRes.status}): ${body}`);
      }
      process.exit(1);
    }

    const reg = await regRes.json();
    apiKey      = reg.api_key;
    developerId = reg.developer_id;

    ok(`Registered!  developer_id: ${developerId}`);
    ok(`API key:      ${apiKey.slice(0, 28)}...`);
    info(`MCP endpoint: ${reg.mcp_url}`);
    info('');
    info('Save this key to skip registration next time:');
    info(`  export AGENTIC_ADS_API_KEY="${apiKey}"`);
  }

  // ── Step 2: Search for ads (REST — fastest path) ─────────────────────────

  step('Step 2/4 — Fetch sponsored recommendation');

  const searchUrl = `${BASE_URL}/api/search?query=${encodeURIComponent(SAMPLE_QUERY)}&max_results=3`;
  info(`GET ${searchUrl}`);

  const searchRes = await fetch(searchUrl, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });

  if (!searchRes.ok) {
    err(`Search failed: ${searchRes.status}`);
    process.exit(1);
  }

  const searchData = await searchRes.json();
  const ads = searchData.ads ?? [];

  if (ads.length === 0) {
    warn('No ads returned. The demo will continue with simulated data.');
  } else {
    ok(`Got ${ads.length} sponsored recommendation(s)`);
    log('');
    log(`  ${c.bold}Top result:${c.reset}`);
    log(`  ${c.yellow}[Sponsored by ${ads[0].advertiser_name}]${c.reset}`);
    log(`  ${ads[0].creative_text}`);
    log(`  ${c.cyan}→ ${ads[0].link_url}${c.reset}`);
    log(`  Relevance score: ${ads[0].relevance_score}`);
  }

  // ── Step 3: Report impression + click via MCP ────────────────────────────

  const topAd = ads[0];

  if (topAd) {
    step('Step 3/4 — Report impression + simulated click via MCP');

    // Impression
    try {
      info('Reporting impression...');
      const impRes = await mcpCall(apiKey, 'report_event', {
        ad_id: topAd.ad_id,
        event_type: 'impression',
      });
      ok(`Impression recorded: ${JSON.stringify(impRes).slice(0, 80)}`);
    } catch (e) {
      warn(`Impression report: ${e.message}`);
    }

    // Click
    try {
      info('Reporting click...');
      const clickRes = await mcpCall(apiKey, 'report_event', {
        ad_id: topAd.ad_id,
        event_type: 'click',
      });
      ok(`Click recorded: ${JSON.stringify(clickRes).slice(0, 80)}`);
    } catch (e) {
      warn(`Click report: ${e.message}`);
    }
  } else {
    step('Step 3/4 — Report impression + click (skipped — no ads)');
    warn('No ad to report events for.');
  }

  // ── Step 4: Show earnings ─────────────────────────────────────────────────

  step('Step 4/4 — Check your earnings');

  try {
    const earnings = await mcpCall(apiKey, 'get_developer_earnings', {});

    const total   = (earnings.total_earnings   ?? 0).toFixed(4);
    const clicks  = earnings.total_clicks       ?? 0;
    const imps    = earnings.total_impressions  ?? 0;
    const last24h = (earnings.period_earnings?.last_24h ?? 0).toFixed(4);

    log('');
    log(`${c.bold}╔══════════════════════════════════════════════════════╗${c.reset}`);
    log(`${c.bold}║                  YOUR EARNINGS                       ║${c.reset}`);
    log(`${c.bold}╠══════════════════════════════════════════════════════╣${c.reset}`);
    log(`${c.bold}║${c.reset}  Total earned (all-time):  ${c.green}${c.bold}$${total}${c.reset}${' '.repeat(Math.max(0, 22 - total.length))}${c.bold}║${c.reset}`);
    log(`${c.bold}║${c.reset}  Earnings last 24h:        ${c.green}$${last24h}${' '.repeat(Math.max(0, 23 - last24h.length))}${c.bold}║${c.reset}`);
    log(`${c.bold}║${c.reset}  Impressions:              ${imps}${' '.repeat(Math.max(0, 25 - String(imps).length))}${c.bold}║${c.reset}`);
    log(`${c.bold}║${c.reset}  Clicks:                   ${clicks}${' '.repeat(Math.max(0, 25 - String(clicks).length))}${c.bold}║${c.reset}`);
    log(`${c.bold}╚══════════════════════════════════════════════════════╝${c.reset}`);
    log('');

    if (earnings.earnings_by_campaign?.length > 0) {
      log(`${c.bold}  Revenue by campaign:${c.reset}`);
      for (const camp of earnings.earnings_by_campaign) {
        log(`  ${c.grey}• ${camp.advertiser_name} / ${camp.campaign_name}: ${c.green}$${camp.revenue.toFixed(4)}${c.reset} (${camp.clicks} clicks)`);
      }
      log('');
    }

  } catch (e) {
    warn(`Could not fetch earnings: ${e.message}`);
    info('(This is normal on a fresh account before events are processed)');
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  log(`${c.green}${c.bold}✓ Demo complete!${c.reset}`);
  log('');
  log('Next steps:');
  log('  1. Add Agentic Ads to your MCP server (see docs/quickstart.md)');
  log('  2. Every tool call = an impression = revenue');
  log('  3. 70% revenue share, paid in USDC, withdrawable at any time');
  log('');
  log('  Integration guide: https://github.com/nicofains1/agentic-ads/blob/main/docs/quickstart.md');
  log(`  Live API: ${BASE_URL}/mcp`);
  log('');
}

main().catch(e => {
  err(`Fatal: ${e.message}`);
  if (process.env.DEBUG) console.error(e);
  process.exit(1);
});
