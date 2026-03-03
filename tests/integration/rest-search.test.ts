// ──────────────────────────────────────────────────────────────────────────────
// Integration tests for GET /api/search REST endpoint (#119)
// Tests: auth, query params, min_relevance, max_results, error handling
// ──────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdtempSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initDatabase, createAdvertiser, createDeveloper, createCampaign, createAd } from '../../src/db/index.js';
import { generateApiKey } from '../../src/auth/middleware.js';

const SERVER_PATH = resolve('dist/server.js');

describe('GET /api/search (#119)', () => {
  let serverProcess: ChildProcess;
  let dbPath: string;
  let devKey: string;
  const PORT = 3198;
  const BASE_URL = `http://localhost:${PORT}`;

  beforeAll(async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'agentic-ads-rest-'));
    dbPath = join(tmpDir, 'test.db');

    const db = initDatabase(dbPath);

    const adv = createAdvertiser(db, { name: 'RestBrand' });
    const campaign = createCampaign(db, {
      advertiser_id: adv.id,
      name: 'REST Test Campaign',
      objective: 'traffic',
      total_budget: 500,
      pricing_model: 'cpc',
      bid_amount: 1.0,
    });

    createAd(db, {
      campaign_id: campaign.id,
      creative_text: 'Best running shoes for serious athletes — lightweight and fast',
      link_url: 'https://example.com/shoes',
      keywords: ['running', 'shoes', 'athlete', 'sport', 'fitness'],
      categories: ['sports'],
      geo: 'US',
      language: 'en',
    });

    createAd(db, {
      campaign_id: campaign.id,
      creative_text: 'Crypto DeFi swapping made easy',
      link_url: 'https://example.com/defi',
      keywords: ['crypto', 'defi', 'swap', 'blockchain'],
      categories: ['finance'],
      geo: 'ALL',
      language: 'en',
    });

    const dev = createDeveloper(db, { name: 'RestBot' });
    devKey = generateApiKey(db, 'developer', dev.id);
    db.close();

    serverProcess = spawn('node', [SERVER_PATH, '--http', '--port', String(PORT), '--db', dbPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Server startup timeout')), 10_000);
      serverProcess.stderr?.on('data', (data: Buffer) => {
        if (data.toString().includes('listening on')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      serverProcess.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  });

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        serverProcess.on('close', () => resolve());
        setTimeout(resolve, 2000);
      });
    }
    for (const suffix of ['', '-shm', '-wal']) {
      const f = dbPath + suffix;
      if (existsSync(f)) try { unlinkSync(f); } catch {}
    }
  });

  // ─── Basic functionality ──────────────────────────────────────────────────

  it('returns 200 with ads array for a matching query', async () => {
    const res = await fetch(`${BASE_URL}/api/search?query=running+shoes`);
    expect(res.status).toBe(200);
    const body = await res.json() as { ads: unknown[]; count: number };
    expect(Array.isArray(body.ads)).toBe(true);
    expect(typeof body.count).toBe('number');
    expect(body.count).toBe(body.ads.length);
  });

  it('matches shoes ad for running query', async () => {
    const res = await fetch(`${BASE_URL}/api/search?query=running+shoes`);
    const body = await res.json() as { ads: Array<{ creative_text: string }> };
    expect(body.ads.some((a) => a.creative_text.includes('running shoes'))).toBe(true);
  });

  it('returns empty when query has no keyword matches and min_relevance exceeds geo/language bonus', async () => {
    // Geo + language bonuses add up to 0.15 even with no keyword matches.
    // Setting min_relevance=0.5 filters these out, guaranteeing empty results.
    const res = await fetch(`${BASE_URL}/api/search?query=zzz+unknown+topic+xyz&min_relevance=0.5`);
    expect(res.status).toBe(200);
    const body = await res.json() as { ads: unknown[]; count: number };
    expect(body.ads).toEqual([]);
    expect(body.count).toBe(0);
  });

  // ─── min_relevance param ─────────────────────────────────────────────────

  it('min_relevance=0 returns ads normally', async () => {
    const res = await fetch(`${BASE_URL}/api/search?query=running+shoes&min_relevance=0`);
    const body = await res.json() as { ads: unknown[] };
    expect(body.ads.length).toBeGreaterThan(0);
  });

  it('min_relevance=1.0 returns empty (impossible to score 1.0)', async () => {
    const res = await fetch(`${BASE_URL}/api/search?query=running+shoes&min_relevance=1.0`);
    expect(res.status).toBe(200);
    const body = await res.json() as { ads: unknown[] };
    expect(body.ads).toEqual([]);
  });

  it('all returned ads satisfy min_relevance threshold', async () => {
    const minRelevance = 0.2;
    const res = await fetch(`${BASE_URL}/api/search?query=running+shoes&min_relevance=${minRelevance}`);
    const body = await res.json() as { ads: Array<{ relevance_score: number }> };
    for (const ad of body.ads) {
      expect(ad.relevance_score).toBeGreaterThanOrEqual(minRelevance);
    }
  });

  // ─── max_results param ───────────────────────────────────────────────────

  it('max_results=1 returns at most 1 ad', async () => {
    const res = await fetch(`${BASE_URL}/api/search?query=running+shoes&max_results=1`);
    const body = await res.json() as { ads: unknown[] };
    expect(body.ads.length).toBeLessThanOrEqual(1);
  });

  it('max_results is capped at 10', async () => {
    const res = await fetch(`${BASE_URL}/api/search?query=running&max_results=999`);
    const body = await res.json() as { ads: unknown[] };
    expect(body.ads.length).toBeLessThanOrEqual(10);
  });

  // ─── keywords param ──────────────────────────────────────────────────────

  it('keywords param works as alternative to query', async () => {
    const res = await fetch(`${BASE_URL}/api/search?keywords=running,shoes`);
    expect(res.status).toBe(200);
    const body = await res.json() as { ads: unknown[] };
    expect(Array.isArray(body.ads)).toBe(true);
  });

  // ─── Error cases ─────────────────────────────────────────────────────────

  it('returns 400 when no search params provided', async () => {
    const res = await fetch(`${BASE_URL}/api/search`);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toContain('query');
  });

  it('returns 401 for invalid api_key', async () => {
    const res = await fetch(`${BASE_URL}/api/search?query=shoes&api_key=aa_dev_${'f'.repeat(64)}`);
    expect(res.status).toBe(401);
  });

  // ─── Auth via Authorization header ──────────────────────────────────────

  it('accepts valid api_key via query param', async () => {
    const res = await fetch(`${BASE_URL}/api/search?query=running&api_key=${devKey}`);
    expect(res.status).toBe(200);
    const body = await res.json() as { ads: unknown[] };
    expect(Array.isArray(body.ads)).toBe(true);
  });

  it('accepts valid api_key via Authorization header', async () => {
    const res = await fetch(`${BASE_URL}/api/search?query=running`, {
      headers: { 'Authorization': `Bearer ${devKey}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ads: unknown[] };
    expect(Array.isArray(body.ads)).toBe(true);
  });

  // ─── Response shape ──────────────────────────────────────────────────────

  it('each ad has required fields', async () => {
    const res = await fetch(`${BASE_URL}/api/search?query=running+shoes`);
    const body = await res.json() as { ads: Array<Record<string, unknown>> };
    if (body.ads.length > 0) {
      const ad = body.ads[0];
      expect(ad).toHaveProperty('ad_id');
      expect(ad).toHaveProperty('advertiser_name');
      expect(ad).toHaveProperty('creative_text');
      expect(ad).toHaveProperty('link_url');
      expect(ad).toHaveProperty('relevance_score');
      expect(ad).toHaveProperty('disclosure', 'sponsored');
    }
  });

  // ─── POST should not match ────────────────────────────────────────────────

  it('POST /api/search → 404', async () => {
    const res = await fetch(`${BASE_URL}/api/search`, { method: 'POST' });
    expect(res.status).toBe(404);
  });
});
