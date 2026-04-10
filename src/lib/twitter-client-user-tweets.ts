import { paginateCursor } from './paginate-cursor.js';
import type { AbstractConstructor, Mixin, TwitterClientBase } from './twitter-client-base.js';
import { buildUserTweetsFeatures } from './twitter-client-features.js';
import type { SearchResult, TweetData } from './twitter-client-types.js';
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
      return this.getQueryIdsWithFallbacks('UserTweets');
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
      const hardMaxPages = 10;
      const effectiveMaxPages = Math.min(hardMaxPages, maxPages ?? Math.ceil(limit / 20));

      const result = await paginateCursor<TweetData>({
        cursor: options.cursor,
        limit,
        maxPages: effectiveMaxPages,
        pageDelayMs,
        sleep: (ms) => this.sleep(ms),
        getKey: (tweet) => tweet.id,
        fetchPage: async (count, pageCursor) => {
          const queryIds = await this.getUserTweetsQueryIds();

          const parseUserTweets = (json: Record<string, unknown>) => {
            const data = json.data as Record<string, unknown> | undefined;
            const user = data?.user as Record<string, unknown> | undefined;
            const result = user?.result as Record<string, unknown> | undefined;
            const timeline = result?.timeline as Record<string, unknown> | undefined;
            const tl = timeline?.timeline as Record<string, unknown> | undefined;
            const instructions = tl?.instructions as Array<Record<string, unknown>> | undefined;
            const pageTweets = parseTweetsFromInstructions(
              instructions as Parameters<typeof parseTweetsFromInstructions>[0],
              { quoteDepth: this.quoteDepth, includeRaw },
            );
            const cursor = extractCursorFromInstructions(
              instructions as Parameters<typeof extractCursorFromInstructions>[0],
            );
            return { items: pageTweets, cursor };
          };

          const gqlResult = await this.graphqlFetchWithRefresh(
            {
              operationName: 'UserTweets',
              queryIds,
              variables: {
                userId,
                count,
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

          if (gqlResult.success) {
            return { success: true, ...gqlResult.data };
          }
          return { success: false, error: gqlResult.error };
        },
      });

      if (result.success) {
        return { success: true, tweets: result.items, nextCursor: result.nextCursor };
      }
      return { success: false, error: result.error, tweets: result.items, nextCursor: result.nextCursor };
    }
  }

  return TwitterClientUserTweets;
}
