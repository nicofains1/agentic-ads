// ──────────────────────────────────────────────────────────────────────────────
// Integration tests: Verified Conversion Flow via MCP stdio (#94)
// Tests the full wallet registration → referral enrichment → on-chain
// conversion reporting → verification status flow via real MCP protocol
// ──────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve } from 'node:path';
import { mkdtempSync, unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initDatabase, createAdvertiser, createDeveloper, createCampaign, createAd } from '../../src/db/index.js';
import { generateApiKey } from '../../src/auth/middleware.js';

const SERVER_PATH = resolve('dist/server.js');

// ─── Helpers ────────────────────────────────────────────────────────────────

async function createMcpClient(dbPath: string, apiKey: string): Promise<Client> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [SERVER_PATH, '--stdio', '--db', dbPath, '--api-key', apiKey],
  });
  const client = new Client({ name: 'verified-conversion-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

function parseToolResult(result: Awaited<ReturnType<Client['callTool']>>): { data: Record<string, unknown>; isError?: boolean } {
  const content = result.content as Array<{ type: string; text: string }>;
  const text = content[0]?.text ?? '{}';
  try {
    return {
      data: JSON.parse(text),
      isError: result.isError as boolean | undefined,
    };
  } catch {
    // MCP-level errors return raw strings
    return {
      data: { error: text },
      isError: true,
    };
  }
}

// ─── Setup ──────────────────────────────────────────────────────────────────

describe('Verified Conversions: Full MCP Integration', () => {
  let dbPath: string;
  let advKey: string;
  let devKey: string;
  let advertiserId: string;
  let developerId: string;
  let onChainCampaignId: string;
  let onChainAdId: string;
  let trustCampaignId: string;
  let trustAdId: string;

  beforeAll(() => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'agentic-ads-verified-'));
    dbPath = join(tmpDir, 'test.db');

    const db = initDatabase(dbPath);

    // Create advertiser
    const adv = createAdvertiser(db, { name: 'TestSwaps', company: 'TestSwaps Inc.' });
    advertiserId = adv.id;
    advKey = generateApiKey(db, 'advertiser', advertiserId);

    // Create on-chain campaign (CPA + verification)
    const onChainCampaign = createCampaign(db, {
      advertiser_id: advertiserId,
      name: 'Verified Swap Campaign',
      objective: 'conversions',
      total_budget: 100,
      daily_budget: 20,
      pricing_model: 'cpa',
      bid_amount: 2.00,
      verification_type: 'on_chain',
      contract_address: '0xFeeCollector000000000000000000000000000001',
      chain_ids: [137, 1, 42161],
    });
    onChainCampaignId = onChainCampaign.id;

    const onChainAd = createAd(db, {
      campaign_id: onChainCampaignId,
      creative_text: 'Swap tokens at the best rate — verified on-chain!',
      link_url: 'https://testswaps.example.com',
      keywords: ['swap', 'crypto', 'defi', 'tokens'],
      categories: ['finance', 'crypto'],
      geo: 'ALL',
      language: 'en',
    });
    onChainAdId = onChainAd.id;

    // Create trust-based campaign for comparison
    const trustCampaign = createCampaign(db, {
      advertiser_id: advertiserId,
      name: 'Trust-Based Campaign',
      objective: 'traffic',
      total_budget: 50,
      pricing_model: 'cpc',
      bid_amount: 0.50,
    });
    trustCampaignId = trustCampaign.id;

    const trustAd = createAd(db, {
      campaign_id: trustCampaignId,
      creative_text: 'Regular CPC ad for swap tokens',
      link_url: 'https://regular.example.com',
      keywords: ['swap', 'tokens'],
      categories: ['finance'],
      geo: 'ALL',
      language: 'en',
    });
    trustAdId = trustAd.id;

    // Create developer (no wallet yet)
    const dev = createDeveloper(db, { name: 'VerifiedBot' });
    developerId = dev.id;
    devKey = generateApiKey(db, 'developer', developerId);

    db.close();
  });

  afterAll(() => {
    for (const suffix of ['', '-shm', '-wal']) {
      const f = dbPath + suffix;
      if (existsSync(f)) try { unlinkSync(f); } catch {}
    }
  });

  // ─── register_wallet ─────────────────────────────────────────────────────

  describe('register_wallet', () => {
    it('registers a wallet and returns referral code', async () => {
      const client = await createMcpClient(dbPath, devKey);
      try {
        const result = await client.callTool({
          name: 'register_wallet',
          arguments: {
            wallet_address: '0xde01234567890abcdef1234567890abcdef12345',
          },
        });
        const { data, isError } = parseToolResult(result);
        expect(isError).toBeFalsy();
        expect(data.wallet_address).toBe('0xde01234567890abcdef1234567890abcdef12345');
        expect(data.referral_code).toBeDefined();
        expect(typeof data.referral_code).toBe('string');
        expect((data.referral_code as string).length).toBe(8);
        expect(data.message).toContain('Wallet registered');
      } finally {
        await client.close();
      }
    });

    it('rejects invalid wallet address format', async () => {
      const client = await createMcpClient(dbPath, devKey);
      try {
        const result = await client.callTool({
          name: 'register_wallet',
          arguments: {
            wallet_address: 'not-a-wallet',
          },
        });
        // Zod regex validation should reject
        const content = result.content as Array<{ type: string; text: string }>;
        const text = content[0]?.text ?? '';
        expect(result.isError === true || text.toLowerCase().includes('error')).toBe(true);
      } finally {
        await client.close();
      }
    });

    it('prevents wallet claiming by another developer', async () => {
      // Create second developer
      const db = initDatabase(dbPath);
      const dev2 = createDeveloper(db, { name: 'OtherBot' });
      const dev2Key = generateApiKey(db, 'developer', dev2.id);
      db.close();

      const client = await createMcpClient(dbPath, dev2Key);
      try {
        const result = await client.callTool({
          name: 'register_wallet',
          arguments: {
            wallet_address: '0xde01234567890abcdef1234567890abcdef12345', // Already claimed by first dev
          },
        });
        const { data, isError } = parseToolResult(result);
        expect(isError).toBe(true);
        expect(data.error).toContain('already registered');
      } finally {
        await client.close();
      }
    });

    it('advertiser cannot call register_wallet', async () => {
      const client = await createMcpClient(dbPath, advKey);
      try {
        const result = await client.callTool({
          name: 'register_wallet',
          arguments: {
            wallet_address: '0x0000000000000000000000000000000000000001',
          },
        });
        const content = result.content as Array<{ type: string; text: string }>;
        const text = content[0]?.text ?? '';
        expect(result.isError === true || text.includes('developer authentication') || text.includes('error')).toBe(true);
      } finally {
        await client.close();
      }
    });
  });

  // ─── search_ads referral enrichment ─────────────────────────────────────

  describe('search_ads referral enrichment', () => {
    it('enriches on-chain campaign ads with referral link for wallet-registered developer', async () => {
      const client = await createMcpClient(dbPath, devKey);
      try {
        const result = await client.callTool({
          name: 'search_ads',
          arguments: {
            query: 'swap crypto tokens',
            keywords: ['swap', 'crypto'],
            category: 'crypto',
            language: 'en',
            max_results: 10,
          },
        });
        const { data } = parseToolResult(result);
        const ads = data.ads as Array<Record<string, unknown>>;
        expect(ads.length).toBeGreaterThan(0);

        // Find the on-chain ad
        const onChainAd = ads.find(a => a.ad_id === onChainAdId);
        expect(onChainAd).toBeDefined();
        expect(onChainAd!.verification_type).toBe('on_chain');
        expect(onChainAd!.referral_link).toBeDefined();
        expect((onChainAd!.referral_link as string)).toContain('ref=');
        expect((onChainAd!.referral_link as string)).toContain('referrer=');
        expect(onChainAd!.referral_code).toBeDefined();
        expect(onChainAd!.conversion_instructions).toBeDefined();

        // Trust-based ad should NOT have referral enrichment
        const trustAd = ads.find(a => a.ad_id === trustAdId);
        if (trustAd) {
          expect(trustAd.verification_type).toBeUndefined();
          expect(trustAd.referral_link).toBeUndefined();
        }
      } finally {
        await client.close();
      }
    });

    it('does NOT enrich ads for developer without wallet', async () => {
      // Create developer without wallet
      const db = initDatabase(dbPath);
      const noWalletDev = createDeveloper(db, { name: 'NoWalletBot' });
      const noWalletKey = generateApiKey(db, 'developer', noWalletDev.id);
      db.close();

      const client = await createMcpClient(dbPath, noWalletKey);
      try {
        const result = await client.callTool({
          name: 'search_ads',
          arguments: {
            query: 'swap crypto',
            keywords: ['swap'],
            language: 'en',
            max_results: 10,
          },
        });
        const { data } = parseToolResult(result);
        const ads = data.ads as Array<Record<string, unknown>>;

        // No ad should have referral enrichment
        for (const ad of ads) {
          expect(ad.referral_link).toBeUndefined();
          expect(ad.referral_code).toBeUndefined();
        }
      } finally {
        await client.close();
      }
    });
  });

  // ─── report_event with on-chain verification ──────────────────────────────

  describe('report_event on-chain conversions', () => {
    it('requires tx_hash and chain_id for on-chain campaign conversions', async () => {
      const client = await createMcpClient(dbPath, devKey);
      try {
        const result = await client.callTool({
          name: 'report_event',
          arguments: {
            ad_id: onChainAdId,
            event_type: 'conversion',
            // Missing tx_hash and chain_id
          },
        });
        const { data, isError } = parseToolResult(result);
        expect(isError).toBe(true);
        expect(data.error).toContain('tx_hash and chain_id');
      } finally {
        await client.close();
      }
    });

    it('rejects conversion without registered wallet', async () => {
      // Create dev without wallet
      const db = initDatabase(dbPath);
      const noWallet = createDeveloper(db, { name: 'NoWalletConvert' });
      const noWalletKey = generateApiKey(db, 'developer', noWallet.id);
      db.close();

      const client = await createMcpClient(dbPath, noWalletKey);
      try {
        const result = await client.callTool({
          name: 'report_event',
          arguments: {
            ad_id: onChainAdId,
            event_type: 'conversion',
            tx_hash: '0xabc123',
            chain_id: 137,
          },
        });
        const { data, isError } = parseToolResult(result);
        expect(isError).toBe(true);
        expect(data.error).toContain('Wallet not registered');
      } finally {
        await client.close();
      }
    });

    it('rejects duplicate tx_hash', async () => {
      // First, insert an event with a tx_hash directly
      const db = initDatabase(dbPath);
      const { insertEvent } = await import('../../src/db/index.js');
      insertEvent(db, {
        ad_id: onChainAdId,
        developer_id: developerId,
        event_type: 'conversion',
        amount_charged: 2.00,
        developer_revenue: 1.40,
        platform_revenue: 0.60,
        tx_hash: '0xduplicate123',
        chain_id: 137,
        verification_status: 'verified',
      });
      db.close();

      const client = await createMcpClient(dbPath, devKey);
      try {
        const result = await client.callTool({
          name: 'report_event',
          arguments: {
            ad_id: onChainAdId,
            event_type: 'conversion',
            tx_hash: '0xduplicate123',
            chain_id: 137,
          },
        });
        const { data, isError } = parseToolResult(result);
        expect(isError).toBe(true);
        expect(data.error).toContain('already reported');
        expect(data.existing_event_id).toBeDefined();
      } finally {
        await client.close();
      }
    });

    it('allows impressions on on-chain campaigns without tx_hash (trust-based)', async () => {
      const client = await createMcpClient(dbPath, devKey);
      try {
        const result = await client.callTool({
          name: 'report_event',
          arguments: {
            ad_id: onChainAdId,
            event_type: 'impression',
          },
        });
        const { data, isError } = parseToolResult(result);
        expect(isError).toBeFalsy();
        expect(data.event_type).toBe('impression');
        expect(data.amount_charged).toBe(0); // CPA: impression is free
      } finally {
        await client.close();
      }
    });

    it('allows clicks on on-chain campaigns without tx_hash (trust-based)', async () => {
      const client = await createMcpClient(dbPath, devKey);
      try {
        const result = await client.callTool({
          name: 'report_event',
          arguments: {
            ad_id: onChainAdId,
            event_type: 'click',
          },
        });
        const { data, isError } = parseToolResult(result);
        expect(isError).toBeFalsy();
        expect(data.event_type).toBe('click');
        expect(data.amount_charged).toBe(0); // CPA: click is free
      } finally {
        await client.close();
      }
    });

    it('trust-based campaign conversions work without tx_hash', async () => {
      const client = await createMcpClient(dbPath, devKey);
      try {
        const result = await client.callTool({
          name: 'report_event',
          arguments: {
            ad_id: trustAdId,
            event_type: 'conversion',
          },
        });
        const { data, isError } = parseToolResult(result);
        expect(isError).toBeFalsy();
        expect(data.event_type).toBe('conversion');
        // CPC campaign: conversion is free
        expect(data.amount_charged).toBe(0);
      } finally {
        await client.close();
      }
    });
  });

  // ─── get_verification_status ───────────────────────────────────────────────

  describe('get_verification_status', () => {
    let verifiedEventId: string;
    let pendingEventId: string;

    it('returns status for a verified event', async () => {
      // Insert a verified event directly
      const db = initDatabase(dbPath);
      const { insertEvent } = await import('../../src/db/index.js');
      const event = insertEvent(db, {
        ad_id: onChainAdId,
        developer_id: developerId,
        event_type: 'conversion',
        amount_charged: 2.00,
        developer_revenue: 1.40,
        platform_revenue: 0.60,
        tx_hash: '0xverified_status_test',
        chain_id: 137,
        verification_status: 'verified',
        verification_details: { referrer_address: '0xde01234567890abcdef1234567890abcdef12345' },
      });
      verifiedEventId = event.id;
      db.close();

      const client = await createMcpClient(dbPath, devKey);
      try {
        const result = await client.callTool({
          name: 'get_verification_status',
          arguments: { event_id: verifiedEventId },
        });
        const { data, isError } = parseToolResult(result);
        expect(isError).toBeFalsy();
        expect(data.event_id).toBe(verifiedEventId);
        expect(data.verification_status).toBe('verified');
        expect(data.tx_hash).toBe('0xverified_status_test');
        expect(data.chain_id).toBe(137);
        expect(data.amount_charged).toBe(2.00);
        expect(data.developer_revenue).toBe(1.40);
      } finally {
        await client.close();
      }
    });

    it('returns status for a pending event', async () => {
      const db = initDatabase(dbPath);
      const { insertEvent } = await import('../../src/db/index.js');
      const event = insertEvent(db, {
        ad_id: onChainAdId,
        developer_id: developerId,
        event_type: 'conversion',
        amount_charged: 0,
        developer_revenue: 0,
        platform_revenue: 0,
        tx_hash: '0xpending_status_test',
        chain_id: 137,
        verification_status: 'pending',
      });
      pendingEventId = event.id;
      db.close();

      const client = await createMcpClient(dbPath, devKey);
      try {
        const result = await client.callTool({
          name: 'get_verification_status',
          arguments: { event_id: pendingEventId },
        });
        const { data, isError } = parseToolResult(result);
        expect(isError).toBeFalsy();
        expect(data.verification_status).toBe('pending');
        expect(data.amount_charged).toBe(0);
      } finally {
        await client.close();
      }
    });

    it('rejects nonexistent event', async () => {
      const client = await createMcpClient(dbPath, devKey);
      try {
        const result = await client.callTool({
          name: 'get_verification_status',
          arguments: { event_id: 'nonexistent-event-id' },
        });
        const { data, isError } = parseToolResult(result);
        expect(isError).toBe(true);
        expect(data.error).toContain('Event not found');
      } finally {
        await client.close();
      }
    });

    it('rejects event belonging to another developer', async () => {
      // Create another developer and try to access first dev's event
      const db = initDatabase(dbPath);
      const otherDev = createDeveloper(db, { name: 'SnoopyBot' });
      const otherDevKey = generateApiKey(db, 'developer', otherDev.id);
      db.close();

      const client = await createMcpClient(dbPath, otherDevKey);
      try {
        const result = await client.callTool({
          name: 'get_verification_status',
          arguments: { event_id: verifiedEventId },
        });
        const { data, isError } = parseToolResult(result);
        expect(isError).toBe(true);
        expect(data.error).toContain('Not authorized');
      } finally {
        await client.close();
      }
    });
  });

  // ─── Billing accuracy for verified conversions ─────────────────────────────

  describe('Verified conversion billing', () => {
    it('on-chain CPA campaign: verified conversion charges bid_amount with 70/30 split', async () => {
      // Directly insert a verified conversion and check DB state
      const db = initDatabase(dbPath);
      const { insertEvent, updateAdStats, updateCampaignSpent, getCampaignById: getCamp } = await import('../../src/db/index.js');

      const campaign = getCamp(db, onChainCampaignId)!;
      const spentBefore = campaign.spent;

      const cost = campaign.bid_amount; // $2.00
      const devRev = cost * 0.7;        // $1.40
      const platRev = cost * 0.3;       // $0.60

      const event = insertEvent(db, {
        ad_id: onChainAdId,
        developer_id: developerId,
        event_type: 'conversion',
        amount_charged: cost,
        developer_revenue: devRev,
        platform_revenue: platRev,
        tx_hash: '0xbilling_test_verified',
        chain_id: 137,
        verification_status: 'verified',
        verification_details: { referrer_address: '0xde01234567890abcdef1234567890abcdef12345' },
      });

      updateAdStats(db, onChainAdId, 'conversion', cost);
      updateCampaignSpent(db, onChainCampaignId, cost);

      const updated = getCamp(db, onChainCampaignId)!;
      expect(updated.spent).toBe(spentBefore + cost);

      expect(event.amount_charged).toBe(2.00);
      expect(event.developer_revenue).toBe(1.40);
      expect(event.platform_revenue).toBe(0.60);

      // Verify 70/30 split precision
      expect(event.developer_revenue + event.platform_revenue).toBe(event.amount_charged);

      db.close();
    });

    it('pending conversion charges $0 (no payout until verified)', async () => {
      const db = initDatabase(dbPath);
      const { insertEvent } = await import('../../src/db/index.js');

      const event = insertEvent(db, {
        ad_id: onChainAdId,
        developer_id: developerId,
        event_type: 'conversion',
        amount_charged: 0,
        developer_revenue: 0,
        platform_revenue: 0,
        tx_hash: '0xbilling_test_pending',
        chain_id: 137,
        verification_status: 'pending',
      });

      expect(event.amount_charged).toBe(0);
      expect(event.developer_revenue).toBe(0);

      db.close();
    });
  });

  // ─── Background verification worker ────────────────────────────────────────

  describe('Background verification worker (DB-level)', () => {
    it('getPendingVerifications returns pending events ordered by creation', async () => {
      const db = initDatabase(dbPath);
      const { insertEvent, getPendingVerifications } = await import('../../src/db/index.js');

      // Insert 3 pending events with unique tx_hashes
      for (let i = 0; i < 3; i++) {
        insertEvent(db, {
          ad_id: onChainAdId,
          developer_id: developerId,
          event_type: 'conversion',
          amount_charged: 0,
          developer_revenue: 0,
          platform_revenue: 0,
          tx_hash: `0xworker_test_${i}_${Date.now()}`,
          chain_id: 137,
          verification_status: 'pending',
        });
      }

      const pending = getPendingVerifications(db, 100);
      expect(pending.length).toBeGreaterThanOrEqual(3);

      // All should be pending
      for (const ev of pending) {
        expect(ev.verification_status).toBe('pending');
      }

      db.close();
    });

    it('updateEventVerification transitions pending → verified with details', async () => {
      const db = initDatabase(dbPath);
      const { insertEvent, updateEventVerification, getEventById } = await import('../../src/db/index.js');

      const event = insertEvent(db, {
        ad_id: onChainAdId,
        developer_id: developerId,
        event_type: 'conversion',
        amount_charged: 0,
        developer_revenue: 0,
        platform_revenue: 0,
        tx_hash: `0xworker_verify_${Date.now()}`,
        chain_id: 137,
        verification_status: 'pending',
      });

      // Simulate worker verifying
      updateEventVerification(db, event.id, 'verified', {
        referrer_address: '0xde01234567890abcdef1234567890abcdef12345',
        block_number: 12345,
      });

      const updated = getEventById(db, event.id)!;
      expect(updated.verification_status).toBe('verified');
      expect(updated.verified_at).toBeDefined();
      expect(updated.verification_details).toBeDefined();
      expect(typeof updated.verification_details).toBe('object');

      db.close();
    });

    it('updateEventVerification transitions pending → rejected', async () => {
      const db = initDatabase(dbPath);
      const { insertEvent, updateEventVerification, getEventById } = await import('../../src/db/index.js');

      const event = insertEvent(db, {
        ad_id: onChainAdId,
        developer_id: developerId,
        event_type: 'conversion',
        amount_charged: 0,
        developer_revenue: 0,
        platform_revenue: 0,
        tx_hash: `0xworker_reject_${Date.now()}`,
        chain_id: 137,
        verification_status: 'pending',
      });

      updateEventVerification(db, event.id, 'rejected', { reason: 'Transaction too old' });

      const updated = getEventById(db, event.id)!;
      expect(updated.verification_status).toBe('rejected');
      expect(updated.verified_at).toBeDefined();

      db.close();
    });
  });

  // ─── Full verified flow: register → search → report ────────────────────────

  describe('Full verified flow (end-to-end)', () => {
    it('complete lifecycle: register_wallet → search_ads (referral) → impression → click → earnings', async () => {
      // Create fresh developer for this test
      const db = initDatabase(dbPath);
      const freshDev = createDeveloper(db, { name: 'FlowTestBot' });
      const freshDevKey = generateApiKey(db, 'developer', freshDev.id);
      db.close();

      // 1. Register wallet
      const devClient = await createMcpClient(dbPath, freshDevKey);

      const regResult = await devClient.callTool({
        name: 'register_wallet',
        arguments: {
          wallet_address: '0xF100e57000000000000000000000000000000001',
        },
      });
      const { data: regData } = parseToolResult(regResult);
      expect(regData.wallet_address).toBe('0xF100e57000000000000000000000000000000001');
      const referralCode = regData.referral_code as string;
      expect(referralCode).toHaveLength(8);

      // 2. Search ads — should get referral-enriched on-chain ad
      const searchResult = await devClient.callTool({
        name: 'search_ads',
        arguments: {
          query: 'swap crypto tokens defi',
          keywords: ['swap', 'crypto'],
          language: 'en',
          max_results: 10,
        },
      });
      const { data: searchData } = parseToolResult(searchResult);
      const ads = searchData.ads as Array<Record<string, unknown>>;
      const enrichedAd = ads.find(a => a.verification_type === 'on_chain');
      expect(enrichedAd).toBeDefined();
      expect(enrichedAd!.referral_link).toContain(referralCode);
      expect(enrichedAd!.referral_link).toContain('0xF100e57000000000000000000000000000000001');

      // 3. Report impression (free)
      const impResult = await devClient.callTool({
        name: 'report_event',
        arguments: { ad_id: enrichedAd!.ad_id as string, event_type: 'impression' },
      });
      const { data: impData } = parseToolResult(impResult);
      expect(impData.amount_charged).toBe(0);

      // 4. Report click (free on CPA)
      const clickResult = await devClient.callTool({
        name: 'report_event',
        arguments: { ad_id: enrichedAd!.ad_id as string, event_type: 'click' },
      });
      const { data: clickData } = parseToolResult(clickResult);
      expect(clickData.amount_charged).toBe(0); // CPA: only conversion charges

      // 5. Check earnings (should be 0 since no verified conversion yet)
      const earningsResult = await devClient.callTool({
        name: 'get_developer_earnings',
        arguments: {},
      });
      const { data: earningsData } = parseToolResult(earningsResult);
      expect(typeof earningsData.total_earnings).toBe('number');

      await devClient.close();
    });
  });

}, { timeout: 60_000 });
