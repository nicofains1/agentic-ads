// ──────────────────────────────────────────────────────────────────────────────
// Rate limiter — sliding window per API key per tool (#14)
// ──────────────────────────────────────────────────────────────────────────────

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number | null;
}

export class RateLimitError extends Error {
  retryAfterMs: number;

  constructor(retryAfterMs: number) {
    super(`Rate limit exceeded. Retry after ${Math.ceil(retryAfterMs / 1000)}s.`);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

// Default limits per tool (requests per minute, unless otherwise specified)
const DEFAULT_LIMITS: Record<string, RateLimitConfig> = {
  search_ads:             { maxRequests: 60,  windowMs: 60_000 },
  report_event:           { maxRequests: 120, windowMs: 60_000 },
  create_campaign:        { maxRequests: 10,  windowMs: 60_000 },
  create_ad:              { maxRequests: 10,  windowMs: 60_000 },
  get_campaign_analytics: { maxRequests: 30,  windowMs: 60_000 },
  get_ad_guidelines:      { maxRequests: 60,  windowMs: 60_000 },
  update_campaign:        { maxRequests: 20,  windowMs: 60_000 },
  list_campaigns:         { maxRequests: 30,  windowMs: 60_000 },
  // REST endpoint rate limits (keyed by IP, not API key)
  __register:             { maxRequests: 5,   windowMs: 3_600_000 }, // 5 per hour per IP
};

export class RateLimiter {
  private windows = new Map<string, number[]>();
  private limits: Record<string, RateLimitConfig>;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(limits?: Record<string, RateLimitConfig>) {
    this.limits = limits ?? DEFAULT_LIMITS;
  }

  /** Start periodic cleanup of expired entries. */
  startCleanup(intervalMs = 60_000): void {
    this.cleanupInterval = setInterval(() => this.cleanup(), intervalMs);
    // Don't block process exit
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /** Stop periodic cleanup. */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Check and record a request. Returns whether it's allowed.
   * @param keyId - The API key ID (or entity_id)
   * @param toolName - The MCP tool being called
   * @param now - Current timestamp (injectable for testing)
   */
  check(keyId: string, toolName: string, now = Date.now()): RateLimitResult {
    const config = this.limits[toolName];
    if (!config) {
      // No limit configured for this tool — allow
      return { allowed: true, remaining: Infinity, retryAfterMs: null };
    }

    const bucketKey = `${keyId}:${toolName}`;
    const timestamps = this.windows.get(bucketKey) ?? [];
    const windowStart = now - config.windowMs;

    // Remove expired timestamps
    const active = timestamps.filter((t) => t > windowStart);

    if (active.length >= config.maxRequests) {
      // Find when the oldest active request will expire
      const oldestActive = active[0];
      const retryAfterMs = oldestActive + config.windowMs - now;
      this.windows.set(bucketKey, active);
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(retryAfterMs, 1),
      };
    }

    // Allow and record
    active.push(now);
    this.windows.set(bucketKey, active);

    return {
      allowed: true,
      remaining: config.maxRequests - active.length,
      retryAfterMs: null,
    };
  }

  /**
   * Check and throw RateLimitError if exceeded.
   */
  enforce(keyId: string, toolName: string, now = Date.now()): void {
    const result = this.check(keyId, toolName, now);
    if (!result.allowed) {
      throw new RateLimitError(result.retryAfterMs!);
    }
  }

  /** Remove all expired entries to free memory. */
  cleanup(now = Date.now()): void {
    for (const [key, timestamps] of this.windows.entries()) {
      // Extract tool name to get window config
      const toolName = key.split(':').slice(1).join(':');
      const config = this.limits[toolName];
      if (!config) {
        this.windows.delete(key);
        continue;
      }
      const windowStart = now - config.windowMs;
      const active = timestamps.filter((t) => t > windowStart);
      if (active.length === 0) {
        this.windows.delete(key);
      } else {
        this.windows.set(key, active);
      }
    }
  }

  /** Reset all rate limit state (for testing). */
  reset(): void {
    this.windows.clear();
  }
}
