// ──────────────────────────────────────────────────────────────────────────────
// On-chain verification — zero-dep JSON-RPC transaction verification (#83)
// ──────────────────────────────────────────────────────────────────────────────

import type Database from 'better-sqlite3';
import type { ChainConfig } from '../db/schema.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface VerificationResult {
  verified: boolean;
  status: 'verified' | 'rejected' | 'pending';
  reason?: string;
  details?: {
    swap_amount?: string;
    token_in?: string;
    token_out?: string;
    referrer_address?: string;
    swapper_address?: string;
    block_number?: number;
    timestamp?: number;
  };
}

interface TransactionReceipt {
  status: string; // "0x1" = success
  blockNumber: string;
  from: string;
  to: string;
  logs: Array<{
    address: string;
    topics: string[];
    data: string;
  }>;
}

// ─── Event Signatures (keccak256 hashes) ─────────────────────────────────────
// These are the topic0 values for events emitted by OnlySwaps contracts.

// FeeCollector.sol: event FeeCollected(address indexed token, address indexed recipient, uint256 amount)
const FEE_COLLECTED_TOPIC = '0x108516ddcf5ba43cea6bb2cd5ff6d59ac196c1c86571be36c4d87e708816ac8e';

// SwapWithFeeHelper.sol: event SwapExecuted(address indexed user, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)
const SWAP_EXECUTED_TOPIC = '0x4ec3e6ff8dce90e7b94e8e8e3c0081fa8451daa7ab1e0e11e4c706ee2a1e6b93';

// Fallback RPC URLs (used when chain_configs table is empty or unavailable)
const FALLBACK_RPCS: Record<number, string> = {
  1: 'https://eth.drpc.org',
  10: 'https://mainnet.optimism.io',
  137: 'https://polygon-bor-rpc.publicnode.com',
  8453: 'https://mainnet.base.org',
  42161: 'https://arb1.arbitrum.io/rpc',
  43114: 'https://api.avax.network/ext/bc/C/rpc',
};

// ─── Main Verification ──────────────────────────────────────────────────────

/**
 * Verify a conversion transaction on-chain.
 *
 * Checks:
 * 1. Transaction exists and succeeded
 * 2. Transaction is recent (within ~1 hour)
 * 3. Transaction interacted with the expected contract (or any if no contract specified)
 * 4. Transaction logs contain a swap/fee event with the expected referrer
 */
export async function verifyConversion(
  txHash: string,
  chainId: number,
  expectedReferrer: string,
  contractAddress?: string,
  db?: InstanceType<typeof Database>,
  timeoutMs = 5000,
): Promise<VerificationResult> {
  try {
    const rpcUrl = getRpcUrl(chainId, db);
    if (!rpcUrl) {
      return { verified: false, status: 'rejected', reason: `Unsupported chain: ${chainId}` };
    }

    // Fetch transaction receipt
    const receipt = await getTransactionReceipt(txHash, rpcUrl, timeoutMs);
    if (!receipt) {
      return { verified: false, status: 'pending', reason: 'Transaction not found or not yet confirmed' };
    }

    // Check transaction succeeded
    if (receipt.status !== '0x1') {
      return { verified: false, status: 'rejected', reason: 'Transaction failed (reverted)' };
    }

    // Check recency — MANDATORY (return pending if RPC fails)
    const currentBlock = await getCurrentBlockNumber(rpcUrl, timeoutMs);
    if (!currentBlock) {
      return { verified: false, status: 'pending', reason: 'Could not verify block recency (RPC failed)' };
    }
    const txBlock = parseInt(receipt.blockNumber, 16);
    const blockDiff = currentBlock - txBlock;
    // Allow generous window: 7200 blocks (~2 hours on most chains)
    if (blockDiff > 7200) {
      return { verified: false, status: 'rejected', reason: `Transaction too old (${blockDiff} blocks ago)` };
    }

    // Anti-fraud: reject self-swaps (tx sender === referrer)
    const referrerLower = expectedReferrer.toLowerCase();
    const swapperAddress = receipt.from?.toLowerCase();
    if (swapperAddress === referrerLower) {
      return { verified: false, status: 'rejected', reason: 'Self-swap detected: transaction sender cannot be the referrer' };
    }

    // Check contract interaction (if specified)
    if (contractAddress) {
      const targetLower = contractAddress.toLowerCase();
      const interactedWithContract = receipt.to?.toLowerCase() === targetLower ||
        receipt.logs.some(log => log.address.toLowerCase() === targetLower);
      if (!interactedWithContract) {
        return { verified: false, status: 'rejected', reason: 'Transaction did not interact with expected contract' };
      }
    }

    // Check for referrer in event logs (NOT tx.from — must be in contract events)
    const referrerPadded = '0x' + referrerLower.slice(2).padStart(64, '0');

    const hasReferrer = receipt.logs.some(log => {
      // Check indexed topics (topics[1], topics[2], topics[3])
      const inTopics = log.topics.some(topic =>
        topic.toLowerCase() === referrerPadded ||
        topic.toLowerCase() === referrerLower
      );
      // Check log data (contains unindexed params — referrer might be in there)
      const inData = log.data.toLowerCase().includes(referrerLower.slice(2));
      return inTopics || inData;
    });

    if (!hasReferrer) {
      const hasSwapEvent = receipt.logs.some(log =>
        log.topics[0] === FEE_COLLECTED_TOPIC ||
        log.topics[0] === SWAP_EXECUTED_TOPIC
      );

      if (!hasSwapEvent) {
        return { verified: false, status: 'rejected', reason: 'No swap event found in transaction' };
      }

      return { verified: false, status: 'rejected', reason: 'Swap found but referrer address not in transaction logs' };
    }

    // Extract swap details from logs
    const details = extractSwapDetails(receipt);
    details.referrer_address = expectedReferrer;
    details.swapper_address = swapperAddress;
    details.block_number = txBlock;

    return {
      verified: true,
      status: 'verified',
      details,
    };
  } catch (err) {
    // Network errors, timeouts → pending (retry later)
    if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('timeout'))) {
      return { verified: false, status: 'pending', reason: 'RPC request timed out' };
    }
    return { verified: false, status: 'pending', reason: `Verification error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── JSON-RPC Helpers ───────────────────────────────────────────────────────

async function getTransactionReceipt(
  txHash: string,
  rpcUrl: string,
  timeoutMs: number,
): Promise<TransactionReceipt | null> {
  const response = await fetchJsonRpc(rpcUrl, 'eth_getTransactionReceipt', [txHash], timeoutMs);
  return (response.result as TransactionReceipt) ?? null;
}

async function getCurrentBlockNumber(
  rpcUrl: string,
  timeoutMs: number,
): Promise<number | null> {
  try {
    const response = await fetchJsonRpc(rpcUrl, 'eth_blockNumber', [], timeoutMs);
    return response.result ? parseInt(response.result as string, 16) : null;
  } catch {
    return null; // Non-critical — we still verify other aspects
  }
}

async function fetchJsonRpc(
  rpcUrl: string,
  method: string,
  params: unknown[],
  timeoutMs: number,
): Promise<{ result: unknown; error?: { message: string } }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`RPC HTTP error: ${res.status}`);
    }

    return await res.json() as { result: unknown; error?: { message: string } };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getRpcUrl(chainId: number, db?: InstanceType<typeof Database>): string | null {
  // Try DB first
  if (db) {
    const config = db.prepare('SELECT rpc_url FROM chain_configs WHERE chain_id = ?')
      .get(chainId) as { rpc_url: string } | undefined;
    if (config) return config.rpc_url;
  }
  // Fallback to hardcoded
  return FALLBACK_RPCS[chainId] ?? null;
}

function extractSwapDetails(receipt: TransactionReceipt): VerificationResult['details'] & Record<string, unknown> {
  const details: VerificationResult['details'] & Record<string, unknown> = {};

  for (const log of receipt.logs) {
    if (log.topics[0] === FEE_COLLECTED_TOPIC && log.data.length >= 66) {
      // FeeCollected: token (indexed), recipient (indexed), amount (data)
      if (log.topics[1]) details.token_in = '0x' + log.topics[1].slice(26);
      if (log.data.length >= 66) details.swap_amount = BigInt(log.data.slice(0, 66)).toString();
    }
  }

  return details;
}
