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
      const primary = await this.getQueryId('HomeTimeline');
      return Array.from(new Set([primary, 'edseUwk9sP5Phz__9TIRnA']));
    }

    private async getHomeLatestTimelineQueryIds(): Promise<string[]> {
      const primary = await this.getQueryId('HomeLatestTimeline');
      return Array.from(new Set([primary, 'iOEZpOdfekFsxSlPQCQtPg']));
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
      const pageSize = 20;
      const seen = new Set<string>();
      const tweets: TweetData[] = [];
      let cursor: string | undefined;

      type TimelineData = { tweets: TweetData[]; cursor?: string };

      const fetchPage = async (pageCount: number, pageCursor?: string): Promise<TimelineData | string> => {
        const queryIds =
          operation === 'HomeTimeline'
            ? await this.getHomeTimelineQueryIds()
            : await this.getHomeLatestTimelineQueryIds();

        const parseHomeTimeline = (json: Record<string, unknown>): TimelineData | undefined => {
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
          return { tweets: pageTweets, cursor: nextCursor };
        };

        // Custom error checker: detect query unspecified (should trigger refresh)
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

        const result = await this.graphqlFetchWithRefresh<TimelineData>(
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

        if (result.success) {
          return result.data;
        }
        return result.error;
      };

      while (tweets.length < count) {
        const pageCount = Math.min(pageSize, count - tweets.length);
        const page = await fetchPage(pageCount, cursor);
        if (typeof page === 'string') {
          return { success: false, error: page };
        }

        let added = 0;
        for (const tweet of page.tweets) {
          if (seen.has(tweet.id)) {
            continue;
          }
          seen.add(tweet.id);
          tweets.push(tweet);
          added += 1;
          if (tweets.length >= count) {
            break;
          }
        }

        if (!page.cursor || page.cursor === cursor || page.tweets.length === 0 || added === 0) {
          break;
        }
        cursor = page.cursor;
      }

      return { success: true, tweets };
    }
  }

  return TwitterClientHome;
}
