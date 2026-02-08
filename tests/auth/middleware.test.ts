import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase } from '../../src/db/index.js';
import { createAdvertiser, createDeveloper } from '../../src/db/index.js';
import {
  generateApiKey,
  authenticate,
  hashKey,
  extractKeyFromHeader,
  AuthError,
} from '../../src/auth/middleware.js';

describe('Auth Middleware', () => {
  let db: ReturnType<typeof initDatabase>;
  let advertiserId: string;
  let developerId: string;

  beforeEach(() => {
    db = initDatabase(':memory:');
    const adv = createAdvertiser(db, { name: 'Test Advertiser' });
    const dev = createDeveloper(db, { name: 'Test Developer' });
    advertiserId = adv.id;
    developerId = dev.id;
  });

  describe('generateApiKey', () => {
    it('generates advertiser key with correct prefix', () => {
      const key = generateApiKey(db, 'advertiser', advertiserId);
      expect(key).toMatch(/^aa_adv_[a-f0-9]{64}$/);
    });

    it('generates developer key with correct prefix', () => {
      const key = generateApiKey(db, 'developer', developerId);
      expect(key).toMatch(/^aa_dev_[a-f0-9]{64}$/);
    });

    it('generates unique keys each time', () => {
      const key1 = generateApiKey(db, 'advertiser', advertiserId);
      const key2 = generateApiKey(db, 'advertiser', advertiserId);
      expect(key1).not.toBe(key2);
    });

    it('stores the key hash in the database', () => {
      const key = generateApiKey(db, 'advertiser', advertiserId);
      const keyHash = hashKey(key);
      const row = db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(keyHash);
      expect(row).toBeDefined();
    });
  });

  describe('authenticate', () => {
    it('authenticates a valid advertiser key', () => {
      const key = generateApiKey(db, 'advertiser', advertiserId);
      const auth = authenticate(db, key);
      expect(auth.entity_type).toBe('advertiser');
      expect(auth.entity_id).toBe(advertiserId);
      expect(auth.key_id).toBeDefined();
    });

    it('authenticates a valid developer key', () => {
      const key = generateApiKey(db, 'developer', developerId);
      const auth = authenticate(db, key);
      expect(auth.entity_type).toBe('developer');
      expect(auth.entity_id).toBe(developerId);
    });

    it('throws AuthError for empty key', () => {
      expect(() => authenticate(db, '')).toThrow(AuthError);
      expect(() => authenticate(db, '')).toThrow('API key is required');
    });

    it('throws AuthError for invalid prefix', () => {
      expect(() => authenticate(db, 'invalid_prefix_key')).toThrow(AuthError);
      expect(() => authenticate(db, 'invalid_prefix_key')).toThrow('Invalid API key format');
    });

    it('throws AuthError for unknown key', () => {
      expect(() => authenticate(db, 'aa_adv_' + 'a'.repeat(64))).toThrow(AuthError);
      expect(() => authenticate(db, 'aa_adv_' + 'a'.repeat(64))).toThrow('Invalid API key');
    });

    it('throws AuthError on key type mismatch (prefix ≠ stored entity_type)', () => {
      // Create a raw key with advertiser prefix
      const fakeRawKey = 'aa_adv_' + 'ab'.repeat(32);
      const keyHash = hashKey(fakeRawKey);
      // Insert into DB as developer (mismatch: prefix says adv, DB says dev)
      db.prepare(
        `INSERT INTO api_keys (id, key_hash, entity_type, entity_id) VALUES (?, ?, ?, ?)`,
      ).run('mismatch-key', keyHash, 'developer', developerId);

      expect(() => authenticate(db, fakeRawKey)).toThrow(AuthError);
      expect(() => authenticate(db, fakeRawKey)).toThrow('API key type mismatch');
    });
  });

  describe('hashKey', () => {
    it('produces consistent SHA-256 hash', () => {
      const key = 'aa_adv_test123';
      expect(hashKey(key)).toBe(hashKey(key));
    });

    it('produces different hashes for different keys', () => {
      expect(hashKey('aa_adv_key1')).not.toBe(hashKey('aa_adv_key2'));
    });

    it('produces a 64-char hex string', () => {
      expect(hashKey('test')).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('extractKeyFromHeader', () => {
    it('extracts key from valid Bearer header', () => {
      expect(extractKeyFromHeader('Bearer aa_adv_test123')).toBe('aa_adv_test123');
    });

    it('returns null for missing header', () => {
      expect(extractKeyFromHeader(undefined)).toBeNull();
    });

    it('returns null for non-Bearer scheme', () => {
      expect(extractKeyFromHeader('Basic abc123')).toBeNull();
    });

    it('returns null for malformed header', () => {
      expect(extractKeyFromHeader('Bearer')).toBeNull();
      expect(extractKeyFromHeader('Bearer a b c')).toBeNull();
    });
  });
});
