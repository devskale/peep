import { paginateCursor } from './paginate-cursor.js';
import type { AbstractConstructor, Mixin, TwitterClientBase } from './twitter-client-base.js';
import { buildHomeTimelineFeatures } from './twitter-client-features.js';
import type { SearchResult, TweetData } from './twitter-client-types.js';
import { extractCursorFromInstructions, parseTweetsFromInstructions } from './twitter-client-utils.js';

const QUERY_UNSPECIFIED_REGEX = /query:\s*unspecified/i;

/** Options for home timeline fetch methods */
export interface HomeTimelineFetchOptions {
  /** Include raw GraphQL response in `_raw` field */
  includeRaw?: boolean;
}

export interface TwitterClientHomeMethods {
  getHomeTimeline(count?: number, options?: HomeTimelineFetchOptions): Promise<SearchResult>;
  getHomeLatestTimeline(count?: number, options?: HomeTimelineFetchOptions): Promise<SearchResult>;
}

export function withHome<TBase extends AbstractConstructor<TwitterClientBase>>(
  Base: TBase,
): Mixin<TBase, TwitterClientHomeMethods> {
  abstract class TwitterClientHome extends Base {
    // biome-ignore lint/complexity/noUselessConstructor lint/suspicious/noExplicitAny: TS mixin constructor requirement.
    constructor(...args: any[]) {
      super(...args);
    }

    private async getHomeTimelineQueryIds(): Promise<string[]> {
      return this.getQueryIdsWithFallbacks('HomeTimeline');
    }

    private async getHomeLatestTimelineQueryIds(): Promise<string[]> {
      return this.getQueryIdsWithFallbacks('HomeLatestTimeline');
    }

    /**
     * Get the authenticated user's "For You" home timeline
     */
    async getHomeTimeline(count = 20, options: HomeTimelineFetchOptions = {}): Promise<SearchResult> {
      return this.fetchHomeTimeline('HomeTimeline', count, options);
    }

    /**
     * Get the authenticated user's "Following" (latest/chronological) home timeline
     */
    async getHomeLatestTimeline(count = 20, options: HomeTimelineFetchOptions = {}): Promise<SearchResult> {
      return this.fetchHomeTimeline('HomeLatestTimeline', count, options);
    }

    private async fetchHomeTimeline(
      operation: 'HomeTimeline' | 'HomeLatestTimeline',
      count: number,
      options: HomeTimelineFetchOptions,
    ): Promise<SearchResult> {
      const { includeRaw = false } = options;
      const features = buildHomeTimelineFeatures();

      const result = await paginateCursor<TweetData>({
        limit: count,
        getKey: (tweet) => tweet.id,
        fetchPage: async (pageCount, pageCursor) => {
          const queryIds =
            operation === 'HomeTimeline'
              ? await this.getHomeTimelineQueryIds()
              : await this.getHomeLatestTimelineQueryIds();

          const parseHomeTimeline = (json: Record<string, unknown>) => {
            const data = json.data as Record<string, unknown> | undefined;
            const home = data?.home as Record<string, unknown> | undefined;
            const homeTimelineUrt = home?.home_timeline_urt as Record<string, unknown> | undefined;
            const instructions = homeTimelineUrt?.instructions as Array<Record<string, unknown>> | undefined;
            const pageTweets = parseTweetsFromInstructions(
              instructions as Parameters<typeof parseTweetsFromInstructions>[0],
              { quoteDepth: this.quoteDepth, includeRaw },
            );
            const nextCursor = extractCursorFromInstructions(
              instructions as Parameters<typeof extractCursorFromInstructions>[0],
            );
            return { items: pageTweets, cursor: nextCursor };
          };

          const checkErrors = (json: Record<string, unknown>): string | undefined => {
            const errors = json.errors as Array<{ message?: string }> | undefined;
            if (!errors || errors.length === 0) {
              return undefined;
            }
            const errorMessage = errors.map((e) => e.message ?? 'Unknown error').join(', ');
            if (QUERY_UNSPECIFIED_REGEX.test(errorMessage)) {
              return '__query_id_mismatch__';
            }
            return errorMessage;
          };

          const gqlResult = await this.graphqlFetchWithRefresh(
            {
              operationName: operation,
              queryIds,
              variables: {
                count: pageCount,
                includePromotedContent: true,
                latestControlAvailable: true,
                requestContext: 'launch',
                withCommunity: true,
                ...(pageCursor ? { cursor: pageCursor } : {}),
              },
              features,
            },
            parseHomeTimeline,
            checkErrors,
          );

          if (gqlResult.success) {
            return { success: true, ...gqlResult.data };
          }
          return { success: false, error: gqlResult.error };
        },
      });

      if (result.success) {
        return { success: true, tweets: result.items };
      }
      return { success: false, error: result.error, tweets: result.items };
    }
  }

  return TwitterClientHome;
}
