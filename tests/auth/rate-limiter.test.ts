import { describe, it, expect, beforeEach } from 'vitest';
import { RateLimiter, RateLimitError } from '../../src/auth/rate-limiter.js';

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({
      test_tool: { maxRequests: 3, windowMs: 1000 },
      fast_tool: { maxRequests: 2, windowMs: 500 },
    });
  });

  describe('check', () => {
    it('allows requests within limit', () => {
      const now = 1000;
      const r1 = limiter.check('key1', 'test_tool', now);
      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(2);

      const r2 = limiter.check('key1', 'test_tool', now + 100);
      expect(r2.allowed).toBe(true);
      expect(r2.remaining).toBe(1);

      const r3 = limiter.check('key1', 'test_tool', now + 200);
      expect(r3.allowed).toBe(true);
      expect(r3.remaining).toBe(0);
    });

    it('blocks requests exceeding limit', () => {
      const now = 1000;
      limiter.check('key1', 'test_tool', now);
      limiter.check('key1', 'test_tool', now + 100);
      limiter.check('key1', 'test_tool', now + 200);

      const r4 = limiter.check('key1', 'test_tool', now + 300);
      expect(r4.allowed).toBe(false);
      expect(r4.remaining).toBe(0);
      expect(r4.retryAfterMs).toBeGreaterThan(0);
    });

    it('allows requests after window expires', () => {
      const now = 1000;
      limiter.check('key1', 'test_tool', now);
      limiter.check('key1', 'test_tool', now + 100);
      limiter.check('key1', 'test_tool', now + 200);

      // After window expires (1000ms)
      const r = limiter.check('key1', 'test_tool', now + 1100);
      expect(r.allowed).toBe(true);
    });

    it('tracks different keys independently', () => {
      const now = 1000;
      limiter.check('key1', 'test_tool', now);
      limiter.check('key1', 'test_tool', now);
      limiter.check('key1', 'test_tool', now);

      // key1 is at limit, but key2 should be fine
      const r = limiter.check('key2', 'test_tool', now);
      expect(r.allowed).toBe(true);
    });

    it('tracks different tools independently', () => {
      const now = 1000;
      limiter.check('key1', 'test_tool', now);
      limiter.check('key1', 'test_tool', now);
      limiter.check('key1', 'test_tool', now);

      // test_tool is at limit, but fast_tool should be fine
      const r = limiter.check('key1', 'fast_tool', now);
      expect(r.allowed).toBe(true);
    });

    it('allows unconfigured tools', () => {
      const r = limiter.check('key1', 'unknown_tool');
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(Infinity);
    });

    it('returns correct retryAfterMs', () => {
      const now = 1000;
      limiter.check('key1', 'test_tool', now);
      limiter.check('key1', 'test_tool', now + 100);
      limiter.check('key1', 'test_tool', now + 200);

      const r = limiter.check('key1', 'test_tool', now + 500);
      expect(r.allowed).toBe(false);
      // Oldest request at now=1000, window=1000ms, so expires at 2000
      // retryAfterMs = 1000 + 1000 - 1500 = 500
      expect(r.retryAfterMs).toBe(500);
    });
  });

  describe('enforce', () => {
    it('does not throw within limit', () => {
      expect(() => limiter.enforce('key1', 'test_tool')).not.toThrow();
    });

    it('throws RateLimitError when exceeded', () => {
      const now = 1000;
      limiter.enforce('key1', 'test_tool', now);
      limiter.enforce('key1', 'test_tool', now);
      limiter.enforce('key1', 'test_tool', now);

      expect(() => limiter.enforce('key1', 'test_tool', now)).toThrow(RateLimitError);
    });

    it('includes retryAfterMs in error', () => {
      const now = 1000;
      limiter.enforce('key1', 'test_tool', now);
      limiter.enforce('key1', 'test_tool', now);
      limiter.enforce('key1', 'test_tool', now);

      try {
        limiter.enforce('key1', 'test_tool', now + 100);
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitError);
        expect((err as RateLimitError).retryAfterMs).toBeGreaterThan(0);
      }
    });
  });

  describe('cleanup', () => {
    it('removes expired entries', () => {
      const now = 1000;
      limiter.check('key1', 'test_tool', now);
      limiter.check('key1', 'test_tool', now + 100);

      // After window expires
      limiter.cleanup(now + 2000);

      // Should be able to make 3 requests again
      const r1 = limiter.check('key1', 'test_tool', now + 2000);
      expect(r1.allowed).toBe(true);
      expect(r1.remaining).toBe(2);
    });
  });

  describe('reset', () => {
    it('clears all state', () => {
      limiter.check('key1', 'test_tool');
      limiter.check('key1', 'test_tool');
      limiter.check('key1', 'test_tool');

      limiter.reset();

      const r = limiter.check('key1', 'test_tool');
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(2);
    });
  });
});
