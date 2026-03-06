/**
 * PostHog analytics integration — server-side event tracking.
 *
 * All calls are no-ops when POSTHOG_API_KEY is not set,
 * so dev/test environments are unaffected.
 */

import { PostHog } from 'posthog-node';

let client: PostHog | null = null;

/**
 * Initialize the PostHog client using the POSTHOG_API_KEY env var.
 * If the env var is not set, all tracking calls become no-ops.
 */
export function initPostHog(): void {
  const apiKey = process.env.POSTHOG_API_KEY;
  if (!apiKey) {
    console.error('[posthog] POSTHOG_API_KEY not set — analytics disabled');
    return;
  }

  client = new PostHog(apiKey, {
    host: 'https://us.i.posthog.com',
  });

  console.error('[posthog] Analytics initialized');
}

/**
 * Track an event. No-op if the PostHog client is not initialized.
 */
export function trackEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (!client) return;

  client.capture({
    distinctId,
    event,
    properties,
  });
}

/**
 * Flush pending events and shut down the PostHog client.
 * Call this on process termination (e.g. SIGTERM).
 */
export async function shutdownPostHog(): Promise<void> {
  if (!client) return;

  await client.shutdown();
  client = null;
  console.error('[posthog] Analytics shut down');
}
