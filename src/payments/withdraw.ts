// ──────────────────────────────────────────────────────────────────────────────
// USDC withdrawal — viem-based on-chain transfers (#106)
// ──────────────────────────────────────────────────────────────────────────────

import { createPublicClient, createWalletClient, http, parseUnits, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// Native USDC on Base (Circle official)
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const;
// USDC has 6 decimals
const USDC_DECIMALS = 6;

const ERC20_ABI = [
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'transfer', stateMutability: 'nonpayable', inputs: [{ type: 'address', name: 'to' }, { type: 'uint256', name: 'amount' }], outputs: [{ type: 'bool' }] },
] as const;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WithdrawalResult {
  success: boolean;
  tx_hash?: string;
  error?: string;
  amount_usdc?: string;
  gas_used?: string;
}

// ─── Client setup (lazy init — only when WALLET_PRIVATE_KEY is set) ─────────

/* eslint-disable @typescript-eslint/no-explicit-any */
let _publicClient: any = null;
let _walletClient: any = null;
/* eslint-enable @typescript-eslint/no-explicit-any */

function getClients() {
  if (_publicClient && _walletClient) return { publicClient: _publicClient, walletClient: _walletClient };

  const privateKey = process.env.WALLET_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('WALLET_PRIVATE_KEY env var not set — cannot process withdrawals');
  }

  const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const transport = http(rpcUrl);

  _publicClient = createPublicClient({ chain: base, transport });
  _walletClient = createWalletClient({ chain: base, transport, account });

  return { publicClient: _publicClient, walletClient: _walletClient };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Get the platform wallet's USDC balance on Base.
 */
export async function getPlatformBalance(): Promise<string> {
  const { publicClient, walletClient } = getClients();
  const balance = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [walletClient.account!.address],
  });
  return formatUnits(balance, USDC_DECIMALS);
}

/**
 * Send USDC from platform wallet to a developer's wallet on Base.
 * Simulates first, then sends. Returns tx hash on success.
 */
export async function sendUsdc(
  recipientAddress: string,
  amountUsd: number,
): Promise<WithdrawalResult> {
  if (amountUsd <= 0) {
    return { success: false, error: 'Amount must be positive' };
  }
  if (amountUsd > 50) {
    return { success: false, error: 'Maximum withdrawal is $50 per request' };
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(recipientAddress)) {
    return { success: false, error: 'Invalid wallet address' };
  }

  try {
    const { publicClient, walletClient } = getClients();
    const amount = parseUnits(amountUsd.toFixed(USDC_DECIMALS), USDC_DECIMALS);

    // Check balance first
    const balance = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [walletClient.account!.address],
    });

    if (balance < amount) {
      return { success: false, error: 'Insufficient platform USDC balance' };
    }

    // Simulate to catch errors before spending gas
    const { request } = await publicClient.simulateContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [recipientAddress as `0x${string}`, amount],
      account: walletClient.account!,
    });

    // Send the transaction
    const hash = await walletClient.writeContract(request);

    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 30_000 });

    if (receipt.status === 'success') {
      return {
        success: true,
        tx_hash: hash,
        amount_usdc: amountUsd.toFixed(USDC_DECIMALS),
        gas_used: receipt.gasUsed.toString(),
      };
    } else {
      return { success: false, error: 'Transaction reverted on-chain', tx_hash: hash };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Transfer failed: ${message}` };
  }
}

/**
 * Check if the payment system is configured (private key set).
 */
export function isPaymentEnabled(): boolean {
  return !!process.env.WALLET_PRIVATE_KEY;
}
