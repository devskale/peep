import type { AbstractConstructor, Mixin, TwitterClientBase } from './twitter-client-base.js';
import { buildUserTweetsFeatures } from './twitter-client-features.js';
import type { GraphqlTweetResult, SearchResult, TweetData } from './twitter-client-types.js';
import { extractCursorFromInstructions, parseTweetsFromInstructions } from './twitter-client-utils.js';

/** Options for user tweets fetch methods */
export interface UserTweetsFetchOptions {
  /** Include raw GraphQL response in `_raw` field */
  includeRaw?: boolean;
}

/** Options for paginated user tweets fetch */
export interface UserTweetsPaginationOptions extends UserTweetsFetchOptions {
  /** Maximum number of pages to fetch (default: 1) */
  maxPages?: number;
  /** Starting cursor for pagination (resume from previous fetch) */
  cursor?: string;
  /** Delay in milliseconds between page fetches (default: 1000) */
  pageDelayMs?: number;
}

export interface TwitterClientUserTweetsMethods {
  getUserTweets(userId: string, count?: number, options?: UserTweetsFetchOptions): Promise<SearchResult>;
  getUserTweetsPaged(userId: string, limit: number, options?: UserTweetsPaginationOptions): Promise<SearchResult>;
}

export function withUserTweets<TBase extends AbstractConstructor<TwitterClientBase>>(
  Base: TBase,
): Mixin<TBase, TwitterClientUserTweetsMethods> {
  abstract class TwitterClientUserTweets extends Base {
    // biome-ignore lint/complexity/noUselessConstructor lint/suspicious/noExplicitAny: TS mixin constructor requirement.
    constructor(...args: any[]) {
      super(...args);
    }

    private async getUserTweetsQueryIds(): Promise<string[]> {
      const primary = await this.getQueryId('UserTweets');
      // Fallback query ID observed from web client
      return Array.from(new Set([primary, 'Wms1GvIiHXAPBaCr9KblaA']));
    }

    /**
     * Get tweets from a user's profile timeline (single page).
     */
    async getUserTweets(userId: string, count = 20, options: UserTweetsFetchOptions = {}): Promise<SearchResult> {
      return this.getUserTweetsPaged(userId, count, options);
    }

    /**
     * Get tweets from a user's profile timeline with pagination support.
     */
    async getUserTweetsPaged(
      userId: string,
      limit: number,
      options: UserTweetsPaginationOptions = {},
    ): Promise<SearchResult> {
      if (!Number.isFinite(limit) || limit <= 0) {
        return { success: false, error: `Invalid limit: ${limit}` };
      }

      const { includeRaw = false, maxPages, pageDelayMs = 1000 } = options;
      const features = buildUserTweetsFeatures();
      const pageSize = 20;
      const seen = new Set<string>();
      const tweets: TweetData[] = [];
      let cursor: string | undefined = options.cursor;
      let nextCursor: string | undefined;
      let pagesFetched = 0;
      const hardMaxPages = 10;
      const computedMaxPages = Math.max(1, Math.ceil(limit / pageSize));
      const effectiveMaxPages = Math.min(hardMaxPages, maxPages ?? computedMaxPages);

      type UserTweetsData = { tweets: TweetData[]; cursor?: string };

      const fetchPage = async (pageCount: number, pageCursor?: string): Promise<UserTweetsData | string> => {
        const queryIds = await this.getUserTweetsQueryIds();

        const parseUserTweets = (json: Record<string, unknown>): UserTweetsData | undefined => {
          const data = json.data as Record<string, unknown> | undefined;
          const user = data?.user as Record<string, unknown> | undefined;
          const result = user?.result as Record<string, unknown> | undefined;
          const timeline = result?.timeline as Record<string, unknown> | undefined;
          const tl = timeline?.timeline as Record<string, unknown> | undefined;
          const instructions = tl?.instructions as Array<Record<string, unknown>> | undefined;
          const pageTweets = parseTweetsFromInstructions(instructions as Parameters<typeof parseTweetsFromInstructions>[0], { quoteDepth: this.quoteDepth, includeRaw });
          const pageCursor = extractCursorFromInstructions(instructions as Parameters<typeof extractCursorFromInstructions>[0]);
          return { tweets: pageTweets, cursor: pageCursor };
        };

        const result = await this.graphqlFetchWithRefresh<UserTweetsData>(
          {
            operationName: 'UserTweets',
            queryIds,
            variables: {
              userId,
              count: pageCount,
              includePromotedContent: false,
              withQuickPromoteEligibilityTweetFields: true,
              withVoice: true,
              ...(pageCursor ? { cursor: pageCursor } : {}),
            },
            features,
            fieldToggles: { withArticlePlainText: false },
          },
          parseUserTweets,
        );

        if (result.success) return result.data;
        return result.error;
      };

      while (tweets.length < limit) {
        // Add delay between pages (but not before the first page)
        if (pagesFetched > 0 && pageDelayMs > 0) {
          await this.sleep(pageDelayMs);
        }

        const remaining = limit - tweets.length;
        const pageCount = Math.min(pageSize, remaining);
        const page = await fetchPage(pageCount, cursor);
        if (typeof page === 'string') {
          return { success: false, error: page };
        }
        pagesFetched += 1;

        let added = 0;
        for (const tweet of page.tweets) {
          if (seen.has(tweet.id)) {
            continue;
          }
          seen.add(tweet.id);
          tweets.push(tweet);
          added += 1;
          if (tweets.length >= limit) {
            break;
          }
        }

        const pageCursor = page.cursor;
        if (!pageCursor || pageCursor === cursor || page.tweets.length === 0 || added === 0) {
          nextCursor = undefined;
          break;
        }

        if (pagesFetched >= effectiveMaxPages) {
          nextCursor = pageCursor;
          break;
        }

        cursor = pageCursor;
        nextCursor = pageCursor;
      }

      return { success: true, tweets, nextCursor };
    }
  }

  return TwitterClientUserTweets;
}
