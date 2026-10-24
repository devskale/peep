import { afterEach, describe, expect, it, vi } from 'vitest';
import { TwitterClient } from '../src/lib/twitter-client.js';
import {
  computeRateLimitDelayMs,
  type GqlFetchOptions,
  type GqlResponseParser,
} from '../src/lib/twitter-client-base.js';
import { type TwitterClientPrivate, validCookies } from './twitter-client-fixtures.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a client where `fetch` is mocked via the private `fetchWithTimeout`.
 * We intercept global `fetch` since the base class calls it indirectly.
 */
function createClient(): TwitterClientPrivate {
  const client = new TwitterClient({ cookies: validCookies }) as unknown as TwitterClientPrivate;
  return client;
}

/** Build minimal GqlFetchOptions for testing. */
function makeOpts(overrides: Partial<GqlFetchOptions> = {}): GqlFetchOptions {
  return {
    operationName: 'TestOperation',
    queryIds: ['query-id-1'],
    variables: { test: true },
    ...overrides,
  };
}

/** Parser that extracts a `data` field. */
const parseData: GqlResponseParser<{ value: string }> = (json) => {
  const d = json.data as Record<string, unknown> | undefined;
  if (d && typeof d === 'object' && 'value' in d) {
    return { value: d.value as string };
  }
  return undefined;
};

// ---------------------------------------------------------------------------
// graphqlFetchWithRetry
// ---------------------------------------------------------------------------

describe('graphqlFetchWithRetry', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns parsed data on first query ID success', async () => {
    const client = createClient();

    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ data: { value: 'hello' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const result = await client.graphqlFetchWithRetry(makeOpts(), parseData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.value).toBe('hello');
    }
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('tries next query ID on 404 and succeeds', async () => {
    const client = createClient();
    let callCount = 0;

    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response('Not Found', { status: 404 });
      }
      return new Response(JSON.stringify({ data: { value: 'fallback' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const result = await client.graphqlFetchWithRetry(makeOpts({ queryIds: ['id-a', 'id-b'] }), parseData);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.value).toBe('fallback');
    }
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('returns had404=true when all query IDs 404', async () => {
    const client = createClient();

    globalThis.fetch = vi.fn(async () => {
      return new Response('Not Found', { status: 404 });
    }) as unknown as typeof fetch;

    const result = await client.graphqlFetchWithRetry(makeOpts({ queryIds: ['id-a', 'id-b'] }), parseData);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.had404).toBe(true);
    }
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('returns error on non-404 HTTP error without setting had404', async () => {
    const client = createClient();

    globalThis.fetch = vi.fn(async () => {
      return new Response('Server Error', { status: 500 });
    }) as unknown as typeof fetch;

    const result = await client.graphqlFetchWithRetry(makeOpts(), parseData);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.had404).toBe(false);
      expect(result.error).toContain('500');
    }
  });

  it('returns GraphQL error from response', async () => {
    const client = createClient();

    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ errors: [{ message: 'Something went wrong' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const result = await client.graphqlFetchWithRetry(makeOpts(), parseData);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Something went wrong');
      expect(result.had404).toBe(false);
    }
  });

  it('returns error when parser returns undefined', async () => {
    const client = createClient();

    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ data: { wrong: 'shape' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const result = await client.graphqlFetchWithRetry(makeOpts(), parseData);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Could not parse');
    }
  });

  it('tries generic POST endpoint when fallbackToGenericPost=true and all 404', async () => {
    const client = createClient();
    let callCount = 0;

    globalThis.fetch = vi.fn(async (_url, init) => {
      callCount++;
      // First two calls are query-ID-specific URLs (both 404)
      if (callCount <= 2) {
        return new Response('Not Found', { status: 404 });
      }
      // Third call is the generic POST endpoint
      const method = (init as RequestInit | undefined)?.method;
      expect(method).toBe('POST');
      return new Response(JSON.stringify({ data: { value: 'generic-post' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const result = await client.graphqlFetchWithRetry(
      makeOpts({ queryIds: ['id-a', 'id-b'], fallbackToGenericPost: true, method: 'POST' }),
      parseData,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.value).toBe('generic-post');
    }
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// graphqlFetchWithRefresh
// ---------------------------------------------------------------------------

describe('graphqlFetchWithRefresh', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('does not refresh on success', async () => {
    const client = createClient();
    const refreshSpy = vi.spyOn(client, 'refreshQueryIds' as never);

    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ data: { value: 'ok' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const result = await client.graphqlFetchWithRefresh(makeOpts(), parseData);

    expect(result.success).toBe(true);
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it('does not refresh on non-404 error', async () => {
    const client = createClient();
    const refreshSpy = vi.spyOn(client, 'refreshQueryIds' as never);

    globalThis.fetch = vi.fn(async () => {
      return new Response('Server Error', { status: 500 });
    }) as unknown as typeof fetch;

    await client.graphqlFetchWithRefresh(makeOpts(), parseData);

    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it('refreshes query IDs on 404 and retries', async () => {
    const client = createClient();
    const refreshSpy = vi.spyOn(client, 'refreshQueryIds' as never);
    let callCount = 0;

    globalThis.fetch = vi.fn(async () => {
      callCount++;
      // First attempt: 404
      if (callCount === 1) {
        return new Response('Not Found', { status: 404 });
      }
      // Second attempt (after refresh): success
      return new Response(JSON.stringify({ data: { value: 'after-refresh' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const result = await client.graphqlFetchWithRefresh(makeOpts(), parseData);

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.value).toBe('after-refresh');
    }
  });

  it('still returns error if refresh + retry also fails', async () => {
    const client = createClient();
    const refreshSpy = vi.spyOn(client, 'refreshQueryIds' as never);

    globalThis.fetch = vi.fn(async () => {
      return new Response('Not Found', { status: 404 });
    }) as unknown as typeof fetch;

    const result = await client.graphqlFetchWithRefresh(makeOpts(), parseData);

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.had404).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 429 rate-limit handling
// ---------------------------------------------------------------------------

describe('computeRateLimitDelayMs', () => {
  it('honors Retry-After delta-seconds', () => {
    expect(computeRateLimitDelayMs(0, '5')).toBe(5000);
  });

  it('honors Retry-After HTTP-date', () => {
    const inThreeSeconds = new Date(Date.now() + 3000).toUTCString();
    const delay = computeRateLimitDelayMs(0, inThreeSeconds);
    expect(delay).toBeGreaterThanOrEqual(2000);
    expect(delay).toBeLessThanOrEqual(3000);
  });

  it('caps Retry-After at 60s', () => {
    expect(computeRateLimitDelayMs(0, '3600')).toBe(60_000);
  });

  it('falls back to exponential backoff with jitter', () => {
    expect(computeRateLimitDelayMs(0, null)).toBeGreaterThanOrEqual(1000);
    expect(computeRateLimitDelayMs(0, null)).toBeLessThanOrEqual(1200);
    expect(computeRateLimitDelayMs(3, undefined)).toBeGreaterThanOrEqual(8000);
    expect(computeRateLimitDelayMs(3, undefined)).toBeLessThanOrEqual(9600);
  });

  it('returns 0-delay for retry-after 0', () => {
    expect(computeRateLimitDelayMs(0, '0')).toBe(0);
  });
});

describe('429 rate-limit retry', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function stubSleep(client: TwitterClientPrivate): number[] {
    const delays: number[] = [];
    vi.spyOn(client, 'sleep' as never).mockImplementation((async (ms: number) => {
      delays.push(ms);
    }) as never);
    return delays;
  }

  it('retries the same query ID after 429 and succeeds', async () => {
    const client = createClient();
    const delays = stubSleep(client);
    let callCount = 0;
    const requestedUrls: string[] = [];

    globalThis.fetch = vi.fn(async (url) => {
      requestedUrls.push(String(url));
      callCount++;
      if (callCount === 1) {
        return new Response('Rate limited', { status: 429, headers: { 'retry-after': '0' } });
      }
      return new Response(JSON.stringify({ data: { value: 'after-429' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const result = await client.graphqlFetchWithRetry(makeOpts(), parseData);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.value).toBe('after-429');
    }
    expect(callCount).toBe(2);
    expect(delays).toEqual([0]);
    // Same query ID retried, not the next one
    expect(new Set(requestedUrls).size).toBe(1);
  });

  it('gives up after max retries and reports rate limiting', async () => {
    const client = createClient();
    stubSleep(client);

    globalThis.fetch = vi.fn(async () => {
      return new Response('Rate limited', { status: 429 });
    }) as unknown as typeof fetch;

    const result = await client.graphqlFetchWithRetry(makeOpts(), parseData);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('429');
      expect(result.had404).toBe(false);
    }
    // 1 initial attempt + 2 retries
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('does not try fallback query IDs or refresh when rate limited', async () => {
    const client = createClient();
    const refreshSpy = vi.spyOn(client, 'refreshQueryIds' as never);
    stubSleep(client);
    let callCount = 0;

    globalThis.fetch = vi.fn(async () => {
      callCount++;
      return new Response('Rate limited', { status: 429 });
    }) as unknown as typeof fetch;

    const result = await client.graphqlFetchWithRefresh(makeOpts({ queryIds: ['id-a', 'id-b'] }), parseData);

    expect(result.success).toBe(false);
    // Retries only the first query ID (3 calls), never falls through to id-b,
    // and never triggers a query-ID refresh (429 is not 404).
    expect(callCount).toBe(3);
    expect(refreshSpy).not.toHaveBeenCalled();
  });

  it('does not sleep when retry-after is 0 and succeeds immediately', async () => {
    const client = createClient();
    const delays = stubSleep(client);
    let callCount = 0;

    globalThis.fetch = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response('Rate limited', { status: 429, headers: { 'retry-after': '0' } });
      }
      return new Response(JSON.stringify({ data: { value: 'ok' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const result = await client.graphqlMutationWithRetry(makeOpts({ method: 'POST' }), parseData);

    expect(result.success).toBe(true);
    expect(delays).toEqual([0]);
  });
});

// ---------------------------------------------------------------------------
// graphqlMutationWithRetry
// ---------------------------------------------------------------------------

describe('graphqlMutationWithRetry', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('tries generic POST fallback on 404 without refresh first', async () => {
    const client = createClient();
    const refreshSpy = vi.spyOn(client, 'refreshQueryIds' as never);
    let callCount = 0;

    globalThis.fetch = vi.fn(async () => {
      callCount++;
      // First call: operation URL → 404
      // Second call: generic POST fallback → success (mutation succeeds without refresh)
      if (callCount === 1) {
        return new Response('Not Found', { status: 404 });
      }
      return new Response(JSON.stringify({ data: { value: 'mutation-ok' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const result = await client.graphqlMutationWithRetry(makeOpts({ method: 'POST' }), parseData);

    // Generic fallback succeeded, so no refresh needed
    expect(refreshSpy).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.value).toBe('mutation-ok');
    }
  });

  it('refreshes when both operation URL and generic POST 404, then retries both', async () => {
    const client = createClient();
    const refreshSpy = vi.spyOn(client, 'refreshQueryIds' as never);
    let callCount = 0;

    globalThis.fetch = vi.fn(async () => {
      callCount++;
      // Attempt 1: operation URL → 404
      // Attempt 1: generic POST → 404
      // (refresh happens)
      // Attempt 2: operation URL → 404
      // Attempt 2: generic POST → success
      if (callCount <= 3) {
        return new Response('Not Found', { status: 404 });
      }
      return new Response(JSON.stringify({ data: { value: 'after-refresh-mutation' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const result = await client.graphqlMutationWithRetry(makeOpts({ method: 'POST' }), parseData);

    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.value).toBe('after-refresh-mutation');
    }
  });
});
