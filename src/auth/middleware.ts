// ──────────────────────────────────────────────────────────────────────────────
// API key authentication middleware (#13)
// ──────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import { createApiKey, findApiKey } from '../db/index.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AuthContext {
  entity_type: 'advertiser' | 'developer';
  entity_id: string;
  key_id: string;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

// ─── Key Generation ─────────────────────────────────────────────────────────

const KEY_PREFIX = {
  advertiser: 'aa_adv_',
  developer: 'aa_dev_',
} as const;

/**
 * Generate a new API key for an entity and store its hash in the DB.
 * Returns the raw key (shown once, never stored).
 */
export function generateApiKey(
  db: InstanceType<typeof Database>,
  entity_type: 'advertiser' | 'developer',
  entity_id: string,
): string {
  const random = crypto.randomBytes(32).toString('hex');
  const rawKey = `${KEY_PREFIX[entity_type]}${random}`;
  const keyHash = hashKey(rawKey);

  createApiKey(db, { key_hash: keyHash, entity_type, entity_id });

  return rawKey;
}

// ─── Key Hashing ────────────────────────────────────────────────────────────

export function hashKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

// ─── Key Parsing ────────────────────────────────────────────────────────────

function parseKeyPrefix(rawKey: string): 'advertiser' | 'developer' | null {
  if (rawKey.startsWith(KEY_PREFIX.advertiser)) return 'advertiser';
  if (rawKey.startsWith(KEY_PREFIX.developer)) return 'developer';
  return null;
}

// ─── Authentication ─────────────────────────────────────────────────────────

/**
 * Authenticate a raw API key against the database.
 * Returns an AuthContext on success, throws AuthError on failure.
 */
export function authenticate(
  db: InstanceType<typeof Database>,
  rawKey: string,
): AuthContext {
  if (!rawKey) {
    throw new AuthError('API key is required');
  }

  const prefixType = parseKeyPrefix(rawKey);
  if (!prefixType) {
    throw new AuthError('Invalid API key format');
  }

  const keyHash = hashKey(rawKey);
  const apiKey = findApiKey(db, keyHash);

  if (!apiKey) {
    throw new AuthError('Invalid API key');
  }

  // Sanity check: prefix should match stored entity_type
  if (apiKey.entity_type !== prefixType) {
    throw new AuthError('API key type mismatch');
  }

  return {
    entity_type: apiKey.entity_type,
    entity_id: apiKey.entity_id,
    key_id: apiKey.id,
  };
}

// ─── HTTP Header Extraction ─────────────────────────────────────────────────

/**
 * Extract API key from an HTTP Authorization header.
 * Expects: `Bearer <key>`
 */
export function extractKeyFromHeader(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
  return parts[1];
}
