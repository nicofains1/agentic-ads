// ──────────────────────────────────────────────────────────────────────────────
// Wallet signature verification — EIP-191 personal_sign (#82)
// Uses @noble/curves (pre-configured with hash functions, unlike raw @noble/secp256k1)
// ──────────────────────────────────────────────────────────────────────────────

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { hexToBytes as _hexToBytes } from '@noble/hashes/utils.js';

/**
 * Recover the signer address from an EIP-191 personal_sign signature.
 *
 * EIP-191 wraps the message as:
 *   "\x19Ethereum Signed Message:\n" + len(message) + message
 * Then keccak256-hashes it and recovers the public key from the signature.
 */
export function recoverAddress(message: string, signature: string): string {
  // 1. Build EIP-191 prefixed message
  const prefix = `\x19Ethereum Signed Message:\n${message.length}`;
  const prefixed = new TextEncoder().encode(prefix + message);

  // 2. Hash with keccak256
  const hash = keccak_256(prefixed);

  // 3. Parse signature (64 bytes + 1 byte recovery id)
  const sigHex = signature.startsWith('0x') ? signature.slice(2) : signature;
  if (sigHex.length !== 130) {
    throw new Error('Invalid signature length (expected 65 bytes / 130 hex chars)');
  }

  let v = parseInt(sigHex.slice(128, 130), 16);
  // Normalize v: 27/28 → 0/1
  if (v >= 27) v -= 27;
  if (v !== 0 && v !== 1) {
    throw new Error(`Invalid recovery id: ${v}`);
  }

  // 4. Build recovered-format signature (recovery_byte + r + s) and recover public key
  const rsBuf = _hexToBytes(sigHex.slice(0, 128));
  const recoveredSig = new Uint8Array(65);
  recoveredSig[0] = v;
  recoveredSig.set(rsBuf, 1);
  const compressed = secp256k1.recoverPublicKey(recoveredSig, hash);
  const uncompressed = secp256k1.Point.fromHex(bytesToHex(compressed)).toBytes(false); // 65 bytes (04 + x + y)

  // 5. Address = keccak256(pubkey[1..65])[12..32]
  const pubkeyHash = keccak_256(uncompressed.slice(1));
  const address = '0x' + bytesToHex(pubkeyHash.slice(12));

  return address.toLowerCase();
}

/**
 * Verify that a signature was produced by the claimed wallet address.
 */
export function verifyWalletSignature(
  walletAddress: string,
  message: string,
  signature: string,
): boolean {
  try {
    const recovered = recoverAddress(message, signature);
    return recovered === walletAddress.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Build the challenge message for wallet registration.
 */
export function buildRegisterMessage(developerId: string, timestamp: string): string {
  return `agentic-ads:register:${developerId}:${timestamp}`;
}

// ─── Hex utilities ──────────────────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
