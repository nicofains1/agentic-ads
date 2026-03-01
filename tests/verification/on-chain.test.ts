import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { verifyConversion } from '../../src/verification/on-chain.js';

// ─── Mock fetch for JSON-RPC calls ──────────────────────────────────────────

const REFERRER = '0xDev1234567890abcdef1234567890abcdef123456';
const REFERRER_PADDED = '0x' + REFERRER.slice(2).toLowerCase().padStart(64, '0');
const CONTRACT = '0xFeeCollector000000000000000000000000000001';
const FEE_COLLECTED_TOPIC = '0x108516ddcf5ba43cea6bb2cd5ff6d59ac196c1c86571be36c4d87e708816ac8e';

function mockReceipt(overrides: Record<string, unknown> = {}) {
  return {
    status: '0x1',
    blockNumber: '0x100', // block 256
    from: '0xUser000000000000000000000000000000000001',
    to: CONTRACT.toLowerCase(),
    logs: [
      {
        address: CONTRACT.toLowerCase(),
        topics: [FEE_COLLECTED_TOPIC, '0x' + '00'.repeat(12) + 'abcdef1234567890abcdef1234567890abcdef12', REFERRER_PADDED],
        data: '0x' + '00'.repeat(31) + '0a', // 10 wei
      },
    ],
    ...overrides,
  };
}

function createFetchMock(responses: Array<{ result: unknown }>) {
  let callIndex = 0;
  return vi.fn(async () => ({
    ok: true,
    json: async () => responses[callIndex++] ?? { result: null },
  }));
}

describe('On-Chain Verification', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('verifies a valid conversion transaction', async () => {
    global.fetch = createFetchMock([
      { result: mockReceipt() },           // eth_getTransactionReceipt
      { result: '0x110' },                 // eth_blockNumber (block 272, 16 blocks ahead)
    ]) as unknown as typeof fetch;

    const result = await verifyConversion(
      '0xabc123',
      137, // Polygon
      REFERRER,
      CONTRACT,
      undefined,
      5000,
    );

    expect(result.verified).toBe(true);
    expect(result.status).toBe('verified');
    expect(result.details?.referrer_address).toBe(REFERRER);
  });

  it('returns pending when transaction not found', async () => {
    global.fetch = createFetchMock([
      { result: null },  // no receipt
    ]) as unknown as typeof fetch;

    const result = await verifyConversion('0xnotfound', 137, REFERRER);
    expect(result.verified).toBe(false);
    expect(result.status).toBe('pending');
  });

  it('rejects reverted transactions', async () => {
    global.fetch = createFetchMock([
      { result: mockReceipt({ status: '0x0' }) },
    ]) as unknown as typeof fetch;

    const result = await verifyConversion('0xreverted', 137, REFERRER);
    expect(result.verified).toBe(false);
    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('reverted');
  });

  it('rejects transactions that are too old', async () => {
    global.fetch = createFetchMock([
      { result: mockReceipt({ blockNumber: '0x100' }) },  // block 256
      { result: '0x3000' },                                // block 12288 — way ahead
    ]) as unknown as typeof fetch;

    const result = await verifyConversion('0xold', 137, REFERRER, CONTRACT);
    expect(result.verified).toBe(false);
    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('too old');
  });

  it('rejects when referrer not found in logs', async () => {
    const receiptNoReferrer = mockReceipt({
      logs: [{
        address: CONTRACT.toLowerCase(),
        topics: [FEE_COLLECTED_TOPIC, '0x' + '00'.repeat(32), '0x' + '00'.repeat(32)],
        data: '0x' + '00'.repeat(32),
      }],
      from: '0x0000000000000000000000000000000000000099',
    });

    global.fetch = createFetchMock([
      { result: receiptNoReferrer },
      { result: '0x110' },
    ]) as unknown as typeof fetch;

    const result = await verifyConversion('0xnoreferrer', 137, REFERRER, CONTRACT);
    expect(result.verified).toBe(false);
    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('referrer');
  });

  it('rejects when transaction did not interact with expected contract', async () => {
    const receiptWrongContract = mockReceipt({
      to: '0x0000000000000000000000000000000000000099',
      logs: [{
        address: '0x0000000000000000000000000000000000000099',
        topics: [FEE_COLLECTED_TOPIC, REFERRER_PADDED],
        data: '0x' + '00'.repeat(32),
      }],
    });

    global.fetch = createFetchMock([
      { result: receiptWrongContract },
      { result: '0x110' },
    ]) as unknown as typeof fetch;

    const result = await verifyConversion('0xwrongcontract', 137, REFERRER, CONTRACT);
    expect(result.verified).toBe(false);
    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('expected contract');
  });

  it('returns rejected for unsupported chains', async () => {
    const result = await verifyConversion('0xabc', 99999, REFERRER);
    expect(result.verified).toBe(false);
    expect(result.status).toBe('rejected');
    expect(result.reason).toContain('Unsupported chain');
  });

  it('returns pending on network timeout', async () => {
    global.fetch = vi.fn(async () => {
      const err = new Error('timeout');
      err.name = 'AbortError';
      throw err;
    }) as unknown as typeof fetch;

    const result = await verifyConversion('0xtimeout', 137, REFERRER, undefined, undefined, 100);
    expect(result.verified).toBe(false);
    expect(result.status).toBe('pending');
    expect(result.reason).toContain('timed out');
  });

  it('verifies when referrer is tx sender (no logs match needed)', async () => {
    const receiptFromReferrer = mockReceipt({
      from: REFERRER.toLowerCase(),
      logs: [], // no events at all
    });

    global.fetch = createFetchMock([
      { result: receiptFromReferrer },
      { result: '0x110' },
    ]) as unknown as typeof fetch;

    const result = await verifyConversion('0xfromreferrer', 137, REFERRER, undefined);
    expect(result.verified).toBe(true);
    expect(result.status).toBe('verified');
  });
});
