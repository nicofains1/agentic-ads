// ──────────────────────────────────────────────────────────────────────────────
// Referral code management (#82)
// ──────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';

/**
 * Generate a deterministic referral code from a wallet address.
 * sha256(wallet.toLowerCase()) → first 8 hex chars.
 * Collision-resistant enough for our scale (16^8 = 4 billion possibilities).
 */
export function generateReferralCode(walletAddress: string): string {
  const hash = crypto.createHash('sha256').update(walletAddress.toLowerCase()).digest('hex');
  return hash.slice(0, 8);
}

/**
 * Build a referral link by appending referral params to an ad's link URL.
 * OnlySwaps accepts ?ref=<code>&referrer=<wallet> format.
 */
export function buildReferralLink(
  baseUrl: string,
  referralCode: string,
  walletAddress: string,
): string {
  const url = new URL(baseUrl);
  url.searchParams.set('ref', referralCode);
  url.searchParams.set('referrer', walletAddress);
  return url.toString();
}
