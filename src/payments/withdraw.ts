// ──────────────────────────────────────────────────────────────────────────────
// USDC withdrawal — viem-based on-chain transfers (#106)
// ──────────────────────────────────────────────────────────────────────────────

import { createPublicClient, createWalletClient, http, parseUnits, formatUnits } from 'viem';
import { polygon } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// USDC.e on Polygon (bridged) — what we currently hold
const USDC_E_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' as const;
// USDC.e has 6 decimals
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

let _publicClient: ReturnType<typeof createPublicClient> | null = null;
let _walletClient: ReturnType<typeof createWalletClient> | null = null;

function getClients() {
  if (_publicClient && _walletClient) return { publicClient: _publicClient, walletClient: _walletClient };

  const privateKey = process.env.WALLET_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('WALLET_PRIVATE_KEY env var not set — cannot process withdrawals');
  }

  const rpcUrl = process.env.POLYGON_RPC_URL || 'https://polygon-bor-rpc.publicnode.com';
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const transport = http(rpcUrl);

  _publicClient = createPublicClient({ chain: polygon, transport });
  _walletClient = createWalletClient({ chain: polygon, transport, account });

  return { publicClient: _publicClient, walletClient: _walletClient };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Get the platform wallet's USDC.e balance on Polygon.
 */
export async function getPlatformBalance(): Promise<string> {
  const { publicClient, walletClient } = getClients();
  const balance = await publicClient.readContract({
    address: USDC_E_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [walletClient.account!.address],
  });
  return formatUnits(balance, USDC_DECIMALS);
}

/**
 * Send USDC.e from platform wallet to a developer's wallet.
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
      address: USDC_E_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [walletClient.account!.address],
    });

    if (balance < amount) {
      return { success: false, error: 'Insufficient platform USDC.e balance' };
    }

    // Simulate to catch errors before spending gas
    const { request } = await publicClient.simulateContract({
      address: USDC_E_ADDRESS,
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
