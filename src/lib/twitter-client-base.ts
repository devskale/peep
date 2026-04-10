import { randomBytes, randomUUID } from 'node:crypto';
import { runtimeQueryIds } from './runtime-query-ids.js';
import { type OperationName, QUERY_IDS, TARGET_QUERY_ID_OPERATIONS, TWITTER_API_BASE } from './twitter-client-constants.js';
import type { CurrentUserResult, TwitterClientOptions } from './twitter-client-types.js';
import { normalizeQuoteDepth } from './twitter-client-utils.js';

// ---------------------------------------------------------------------------
// GraphQL fetch helpers — unified retry / refresh / fallback
// ---------------------------------------------------------------------------

/** Options for the base-class GraphQL fetch helpers. */
export interface GqlFetchOptions {
  /** GraphQL operation name (e.g. `TweetDetail`). Used to build the URL path. */
  operationName: string;
  /** Ordered list of query IDs to try. First success wins. */
  queryIds: string[];
  /** Variables to send (JSON-serialized into URL params or body). */
  variables: Record<string, unknown>;
  /** Feature flags. Included in both URL params and POST body when present. */
  features?: Record<string, boolean>;
  /** Field toggles. Included alongside features. */
  fieldToggles?: Record<string, boolean>;
  /** HTTP method. Defaults to `'GET'` (variables in URL params). */
  method?: 'GET' | 'POST';
  /** Extra headers merged on top of the standard JSON headers. */
  extraHeaders?: Record<string, string>;
  /** Raw body string for POST. When set, `variables`/`features`/`fieldToggles` are NOT auto-serialized. */
  body?: string;
  /** When true and all query IDs return 404, also try the generic POST endpoint. */
  fallbackToGenericPost?: boolean;
  /** When true, variables are sent in URL params even for POST requests. */
  variablesInUrl?: boolean;
}

/** Result returned by the GraphQL fetch helpers. */
export type GqlResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; had404: boolean };

/** Callback that receives a successful JSON response and returns typed data. */
export type GqlResponseParser<T> = (json: Record<string, unknown>) => T | undefined;

/** Callback that receives a JSON response and returns an error string if the response is an error (non-404). */
export type GqlErrorChecker = (json: Record<string, unknown>) => string | undefined;

/** Default error checker: looks for a top-level `errors` array. */
export const defaultGqlErrorChecker: GqlErrorChecker = (json) => {
  const errors = json.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const messages = errors
      .map((e: unknown) => (typeof e === 'object' && e !== null && 'message' in e ? (e as { message: string }).message : undefined))
      .filter((m): m is string => typeof m === 'string');
    if (messages.length > 0) {
      return messages.join(', ');
    }
  }
  return undefined;
};

// biome-ignore lint/suspicious/noExplicitAny: TS mixin base constructor requirement.
export type Constructor<T = object> = new (...args: any[]) => T;
// biome-ignore lint/suspicious/noExplicitAny: TS mixin base constructor requirement.
export type AbstractConstructor<T = object> = abstract new (...args: any[]) => T;
export type Mixin<TBase extends AbstractConstructor<TwitterClientBase>, TAdded> = abstract new (
  ...args: ConstructorParameters<TBase>
) => TwitterClientBase & TAdded;

export abstract class TwitterClientBase {
  protected authToken: string;
  protected ct0: string;
  protected cookieHeader: string;
  protected userAgent: string;
  protected timeoutMs?: number;
  protected quoteDepth: number;
  protected clientUuid: string;
  protected clientDeviceId: string;
  protected clientUserId?: string;

  constructor(options: TwitterClientOptions) {
    if (!options.cookies.authToken || !options.cookies.ct0) {
      throw new Error('Both authToken and ct0 cookies are required');
    }
    this.authToken = options.cookies.authToken;
    this.ct0 = options.cookies.ct0;
    this.cookieHeader = options.cookies.cookieHeader || `auth_token=${this.authToken}; ct0=${this.ct0}`;
    this.userAgent =
      options.userAgent ||
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    this.timeoutMs = options.timeoutMs;
    this.quoteDepth = normalizeQuoteDepth(options.quoteDepth);
    this.clientUuid = randomUUID();
    this.clientDeviceId = randomUUID();
  }

  protected abstract getCurrentUser(): Promise<CurrentUserResult>;

  protected async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  protected async getQueryId(operationName: OperationName): Promise<string> {
    const cached = await runtimeQueryIds.getQueryId(operationName);
    return cached ?? QUERY_IDS[operationName];
  }

  protected async refreshQueryIds(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    try {
      await runtimeQueryIds.refresh(TARGET_QUERY_ID_OPERATIONS, { force: true });
    } catch {
      // ignore refresh failures; callers will fall back to baked-in IDs
    }
  }

  protected async withRefreshedQueryIdsOn404<T extends { success: boolean; had404?: boolean }>(
    attempt: () => Promise<T>,
  ): Promise<{ result: T; refreshed: boolean }> {
    const firstAttempt = await attempt();
    if (firstAttempt.success || !firstAttempt.had404) {
      return { result: firstAttempt, refreshed: false };
    }
    await this.refreshQueryIds();
    const secondAttempt = await attempt();
    return { result: secondAttempt, refreshed: true };
  }

  protected async getTweetDetailQueryIds(): Promise<string[]> {
    const primary = await this.getQueryId('TweetDetail');
    return Array.from(new Set([primary, '97JF30KziU00483E_8elBA', 'aFvUsJm2c-oDkJV75blV6g']));
  }

  protected async getSearchTimelineQueryIds(): Promise<string[]> {
    const primary = await this.getQueryId('SearchTimeline');
    return Array.from(new Set([primary, 'M1jEez78PEfVfbQLvlWMvQ', '5h0kNbk3ii97rmfY6CdgAA', 'Tp1sewRU1AsZpBWhqCZicQ']));
  }

  protected async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    if (!this.timeoutMs || this.timeoutMs <= 0) {
      return fetch(url, init);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  protected getHeaders(): Record<string, string> {
    return this.getJsonHeaders();
  }

  protected createTransactionId(): string {
    return randomBytes(16).toString('hex');
  }

  protected getBaseHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      accept: '*/*',
      'accept-language': 'en-US,en;q=0.9',
      authorization:
        'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
      'x-csrf-token': this.ct0,
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-active-user': 'yes',
      'x-twitter-client-language': 'en',
      'x-client-uuid': this.clientUuid,
      'x-twitter-client-deviceid': this.clientDeviceId,
      'x-client-transaction-id': this.createTransactionId(),
      cookie: this.cookieHeader,
      'user-agent': this.userAgent,
      origin: 'https://x.com',
      referer: 'https://x.com/',
    };

    if (this.clientUserId) {
      headers['x-twitter-client-user-id'] = this.clientUserId;
    }

    return headers;
  }

  protected getJsonHeaders(): Record<string, string> {
    return {
      ...this.getBaseHeaders(),
      'content-type': 'application/json',
    };
  }

  protected getUploadHeaders(): Record<string, string> {
    // Note: do not set content-type; URLSearchParams/FormData need to set it (incl boundary) themselves.
    return this.getBaseHeaders();
  }

  // -----------------------------------------------------------------
  // Unified GraphQL fetch with query-ID fallback (no auto-refresh)
  // -----------------------------------------------------------------

  /**
   * Try each query ID in order. On 404 → try next ID. Returns the first
   * successful parse or the last error. Does **not** refresh query IDs;
   * wrap with `graphqlFetchWithRefresh()` for that.
   */
  protected async graphqlFetchWithRetry<T>(
    opts: GqlFetchOptions,
    parseResponse: GqlResponseParser<T>,
    checkError?: GqlErrorChecker,
  ): Promise<GqlResult<T>> {
    const {
      operationName,
      queryIds,
      variables,
      features,
      fieldToggles,
      method = 'GET',
      extraHeaders,
      body: rawBody,
      fallbackToGenericPost = false,
    } = opts;

    const errorChecker = checkError ?? defaultGqlErrorChecker;
    const headers = { ...this.getHeaders(), ...extraHeaders };

    // Build URL params (used for GET, and also sent alongside POST body)
    const params = new URLSearchParams();
    if (features) {
      params.set('features', JSON.stringify(features));
    }
    if (fieldToggles) {
      params.set('fieldToggles', JSON.stringify(fieldToggles));
    }
    if (method === 'GET' || opts.variablesInUrl) {
      params.set('variables', JSON.stringify(variables));
    }

    let lastError: string | undefined;
    let had404 = false;

    for (const queryId of queryIds) {
      const url = `${TWITTER_API_BASE}/${queryId}/${operationName}${params.toString() ? `?${params.toString()}` : ''}`;

      try {
        const response = await this.fetchWithTimeout(url, {
          method,
          headers,
          // For POST: body includes variables/features/queryId (mirrors what X's web client sends)
          body: method === 'POST' ? (rawBody ?? JSON.stringify({ variables, features, queryId })) : undefined,
        });

        if (response.status === 404) {
          had404 = true;
          lastError = `HTTP 404`;
          continue;
        }

        if (!response.ok) {
          const text = await response.text();
          return { success: false, error: `HTTP ${response.status}: ${text.slice(0, 200)}`, had404 };
        }

        const json = (await response.json()) as Record<string, unknown>;

        // Check for GraphQL-level errors
        const gqlError = errorChecker(json);
        if (gqlError) {
          return { success: false, error: gqlError, had404 };
        }

        const parsed = parseResponse(json);
        if (parsed !== undefined) {
          return { success: true, data: parsed };
        }

        // Parser returned undefined — treat as error
        lastError = `Could not parse response for ${operationName}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    // If all query IDs 404'd and fallbackToGenericPost is enabled, try generic endpoint
    if (had404 && fallbackToGenericPost) {
      const genericUrl = `${TWITTER_API_BASE}`;
      const genericBody = rawBody ?? JSON.stringify({ variables, features, queryId: queryIds[0] });

      try {
        const response = await this.fetchWithTimeout(genericUrl, {
          method: 'POST',
          headers,
          body: genericBody,
        });

        if (response.ok) {
          const json = (await response.json()) as Record<string, unknown>;
          const gqlError = errorChecker(json);
          if (gqlError) {
            return { success: false, error: gqlError, had404 };
          }
          const parsed = parseResponse(json);
          if (parsed !== undefined) {
            return { success: true, data: parsed };
          }
          lastError = `Could not parse response from generic POST`;
        } else {
          const text = await response.text();
          return { success: false, error: `HTTP ${response.status}: ${text.slice(0, 200)}`, had404 };
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    return { success: false, error: lastError ?? `Unknown error for ${operationName}`, had404 };
  }

  /**
   * Wraps `graphqlFetchWithRetry` with automatic query-ID refresh on 404.
   * This is the primary entry point for read/query operations.
   */
  protected async graphqlFetchWithRefresh<T>(
    opts: GqlFetchOptions,
    parseResponse: GqlResponseParser<T>,
    checkError?: GqlErrorChecker,
  ): Promise<GqlResult<T>> {
    const first = await this.graphqlFetchWithRetry(opts, parseResponse, checkError);
    if (first.success || !first.had404) {
      return first;
    }
    await this.refreshQueryIds();
    return this.graphqlFetchWithRetry(opts, parseResponse, checkError);
  }

  /**
   * Like `graphqlFetchWithRefresh` but also tries a POST fallback to the
   * generic GraphQL endpoint when all query IDs 404. Used for write
   * mutations (tweet, like, retweet, bookmark, etc.).
   */
  protected async graphqlMutationWithRetry<T>(
    opts: GqlFetchOptions,
    parseResponse: GqlResponseParser<T>,
    checkError?: GqlErrorChecker,
  ): Promise<GqlResult<T>> {
    const optsWithFallback: GqlFetchOptions = { ...opts, fallbackToGenericPost: true };
    const first = await this.graphqlFetchWithRetry(optsWithFallback, parseResponse, checkError);
    if (first.success || !first.had404) {
      return first;
    }
    await this.refreshQueryIds();
    return this.graphqlFetchWithRetry(optsWithFallback, parseResponse, checkError);
  }

  protected async ensureClientUserId(): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      return;
    }
    if (this.clientUserId) {
      return;
    }
    const result = await this.getCurrentUser();
    if (result.success && result.user?.id) {
      this.clientUserId = result.user.id;
    }
  }
}
