import type { AbstractConstructor, Mixin, TwitterClientBase } from './twitter-client-base.js';
import { buildBookmarksFeatures, buildLikesFeatures } from './twitter-client-features.js';
import type { SearchResult, TweetData } from './twitter-client-types.js';
import { extractCursorFromInstructions, parseTweetsFromInstructions } from './twitter-client-utils.js';

/** Options for timeline fetch methods */
export interface TimelineFetchOptions {
  /** Include raw GraphQL response in `_raw` field */
  includeRaw?: boolean;
}

/** Options for paged timeline fetch methods */
export interface TimelinePaginationOptions extends TimelineFetchOptions {
  maxPages?: number;
  /** Starting cursor for pagination (resume from previous fetch) */
  cursor?: string;
}

export interface TwitterClientTimelineMethods {
  getBookmarks(count?: number, options?: TimelineFetchOptions): Promise<SearchResult>;
  getAllBookmarks(options?: TimelinePaginationOptions): Promise<SearchResult>;
  getLikes(count?: number, options?: TimelineFetchOptions): Promise<SearchResult>;
  getAllLikes(options?: TimelinePaginationOptions): Promise<SearchResult>;
  getBookmarkFolderTimeline(folderId: string, count?: number, options?: TimelineFetchOptions): Promise<SearchResult>;
  getAllBookmarkFolderTimeline(folderId: string, options?: TimelinePaginationOptions): Promise<SearchResult>;
}

export function withTimelines<TBase extends AbstractConstructor<TwitterClientBase>>(
  Base: TBase,
): Mixin<TBase, TwitterClientTimelineMethods> {
  abstract class TwitterClientTimelines extends Base {
    // biome-ignore lint/complexity/noUselessConstructor lint/suspicious/noExplicitAny: TS mixin constructor requirement.
    constructor(...args: any[]) {
      super(...args);
    }

    private async getBookmarksQueryIds(): Promise<string[]> {
      const primary = await this.getQueryId('Bookmarks');
      return Array.from(new Set([primary, 'RV1g3b8n_SGOHwkqKYSCFw', 'tmd4ifV8RHltzn8ymGg1aw']));
    }

    private async getBookmarkFolderQueryIds(): Promise<string[]> {
      const primary = await this.getQueryId('BookmarkFolderTimeline');
      return Array.from(new Set([primary, 'KJIQpsvxrTfRIlbaRIySHQ']));
    }

    private async getLikesQueryIds(): Promise<string[]> {
      const primary = await this.getQueryId('Likes');
      return Array.from(new Set([primary, 'JR2gceKucIKcVNB_9JkhsA']));
    }

    /**
     * Get the authenticated user's bookmarks
     */
    async getBookmarks(count = 20, options: TimelineFetchOptions = {}): Promise<SearchResult> {
      return this.getBookmarksPaged(count, options);
    }

    async getAllBookmarks(options?: TimelinePaginationOptions): Promise<SearchResult> {
      return this.getBookmarksPaged(Number.POSITIVE_INFINITY, options);
    }

    /**
     * Get the authenticated user's liked tweets
     */
    async getLikes(count = 20, options: TimelineFetchOptions = {}): Promise<SearchResult> {
      return this.getLikesPaged(count, options);
    }

    async getAllLikes(options?: TimelinePaginationOptions): Promise<SearchResult> {
      return this.getLikesPaged(Number.POSITIVE_INFINITY, options);
    }

    private async getLikesPaged(limit: number, options: TimelinePaginationOptions = {}): Promise<SearchResult> {
      const userResult = await this.getCurrentUser();
      if (!userResult.success || !userResult.user) {
        return { success: false, error: userResult.error ?? 'Could not determine current user' };
      }
      const userId = userResult.user.id;
      const features = buildLikesFeatures();
      const pageSize = 20;
      const seen = new Set<string>();
      const tweets: TweetData[] = [];
      let cursor: string | undefined = options.cursor;
      let nextCursor: string | undefined;
      let pagesFetched = 0;
      const { includeRaw = false, maxPages } = options;

      type TimelineData = { tweets: TweetData[]; cursor?: string };

      const fetchPage = async (pageCount: number, pageCursor?: string): Promise<TimelineData | string> => {
        const queryIds = await this.getLikesQueryIds();

        const parseLikes = (json: Record<string, unknown>): TimelineData | undefined => {
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
          const extractedCursor = extractCursorFromInstructions(
            instructions as Parameters<typeof extractCursorFromInstructions>[0],
          );
          return { tweets: pageTweets, cursor: extractedCursor };
        };

        // Custom error checker: allow partial errors when instructions are present
        const checkErrors = (json: Record<string, unknown>): string | undefined => {
          const errors = json.errors as Array<{ message?: string }> | undefined;
          if (!errors || errors.length === 0) {
            return undefined;
          }
          const message = errors.map((e) => e.message ?? 'Unknown error').join(', ');
          const data = json.data as Record<string, unknown> | undefined;
          const user = data?.user as Record<string, unknown> | undefined;
          const result = user?.result as Record<string, unknown> | undefined;
          const timeline = result?.timeline as Record<string, unknown> | undefined;
          const tl = timeline?.timeline as Record<string, unknown> | undefined;
          const instructions = tl?.instructions;
          if (instructions) {
            return undefined; // data present, ignore non-fatal errors
          }
          if (message.includes('Query: Unspecified')) {
            return '__query_id_mismatch__';
          }
          return message;
        };

        const result = await this.graphqlFetchWithRefresh<TimelineData>(
          {
            operationName: 'Likes',
            queryIds,
            variables: {
              userId,
              count: pageCount,
              includePromotedContent: false,
              withClientEventToken: false,
              withBirdwatchNotes: false,
              withVoice: true,
              ...(pageCursor ? { cursor: pageCursor } : {}),
            },
            features,
          },
          parseLikes,
          checkErrors,
        );

        if (result.success) {
          return result.data;
        }
        return result.error;
      };

      const unlimited = limit === Number.POSITIVE_INFINITY;
      while (unlimited || tweets.length < limit) {
        const pageCount = unlimited ? pageSize : Math.min(pageSize, limit - tweets.length);
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
          if (!unlimited && tweets.length >= limit) {
            break;
          }
        }

        const pageCursor = page.cursor;
        if (!pageCursor || pageCursor === cursor || page.tweets.length === 0 || added === 0) {
          nextCursor = undefined;
          break;
        }
        if (maxPages && pagesFetched >= maxPages) {
          nextCursor = pageCursor;
          break;
        }
        cursor = pageCursor;
        nextCursor = pageCursor;
      }

      return { success: true, tweets, nextCursor };
    }

    /**
     * Get the authenticated user's bookmark folder timeline
     */
    async getBookmarkFolderTimeline(
      folderId: string,
      count = 20,
      options: TimelineFetchOptions = {},
    ): Promise<SearchResult> {
      return this.getBookmarkFolderTimelinePaged(folderId, count, options);
    }

    async getAllBookmarkFolderTimeline(folderId: string, options?: TimelinePaginationOptions): Promise<SearchResult> {
      return this.getBookmarkFolderTimelinePaged(folderId, Number.POSITIVE_INFINITY, options);
    }

    private async getBookmarksPaged(limit: number, options: TimelinePaginationOptions = {}): Promise<SearchResult> {
      const features = buildBookmarksFeatures();
      const pageSize = 20;
      const seen = new Set<string>();
      const tweets: TweetData[] = [];
      let cursor: string | undefined = options.cursor;
      let nextCursor: string | undefined;
      let pagesFetched = 0;
      const { includeRaw = false, maxPages } = options;

      type TimelineData = { tweets: TweetData[]; cursor?: string };

      const fetchPage = async (pageCount: number, pageCursor?: string): Promise<TimelineData | string> => {
        const queryIds = await this.getBookmarksQueryIds();

        const variables = {
          count: pageCount,
          includePromotedContent: false,
          withDownvotePerspective: false,
          withReactionsMetadata: false,
          withReactionsPerspective: false,
          ...(pageCursor ? { cursor: pageCursor } : {}),
        };

        const parseBookmarks = (json: Record<string, unknown>): TimelineData | undefined => {
          const data = json.data as Record<string, unknown> | undefined;
          const bookmarkTimelineV2 = data?.bookmark_timeline_v2 as Record<string, unknown> | undefined;
          const timeline = bookmarkTimelineV2?.timeline as Record<string, unknown> | undefined;
          const instructions = timeline?.instructions as Array<Record<string, unknown>> | undefined;
          const pageTweets = parseTweetsFromInstructions(
            instructions as Parameters<typeof parseTweetsFromInstructions>[0],
            { quoteDepth: this.quoteDepth, includeRaw },
          );
          const nextCursor = extractCursorFromInstructions(
            instructions as Parameters<typeof extractCursorFromInstructions>[0],
          );
          return { tweets: pageTweets, cursor: nextCursor };
        };

        // Custom error checker: allow non-fatal errors when instructions are present
        const checkErrors = (json: Record<string, unknown>): string | undefined => {
          const errors = json.errors as Array<{ message?: string }> | undefined;
          if (!errors || errors.length === 0) {
            return undefined;
          }
          const data = json.data as Record<string, unknown> | undefined;
          const bookmarkTimelineV2 = data?.bookmark_timeline_v2 as Record<string, unknown> | undefined;
          const timeline = bookmarkTimelineV2?.timeline as Record<string, unknown> | undefined;
          const instructions = timeline?.instructions;
          if (instructions) {
            return undefined; // data present, ignore non-fatal errors
          }
          return errors.map((e) => e.message ?? 'Unknown error').join(', ');
        };

        const result = await this.graphqlFetchWithRefresh<TimelineData>(
          {
            operationName: 'Bookmarks',
            queryIds,
            variables,
            features,
          },
          parseBookmarks,
          checkErrors,
        );

        if (result.success) {
          return result.data;
        }
        return result.error;
      };

      const unlimited = limit === Number.POSITIVE_INFINITY;
      while (unlimited || tweets.length < limit) {
        const pageCount = unlimited ? pageSize : Math.min(pageSize, limit - tweets.length);
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
          if (!unlimited && tweets.length >= limit) {
            break;
          }
        }

        const pageCursor = page.cursor;
        if (!pageCursor || pageCursor === cursor || page.tweets.length === 0 || added === 0) {
          nextCursor = undefined;
          break;
        }
        if (maxPages && pagesFetched >= maxPages) {
          nextCursor = pageCursor;
          break;
        }
        cursor = pageCursor;
        nextCursor = pageCursor;
      }

      return { success: true, tweets, nextCursor };
    }

    private async getBookmarkFolderTimelinePaged(
      folderId: string,
      limit: number,
      options: TimelinePaginationOptions = {},
    ): Promise<SearchResult> {
      const features = buildBookmarksFeatures();
      const pageSize = 20;
      const seen = new Set<string>();
      const tweets: TweetData[] = [];
      let cursor: string | undefined = options.cursor;
      let nextCursor: string | undefined;
      let pagesFetched = 0;
      const { includeRaw = false, maxPages } = options;

      type TimelineData = { tweets: TweetData[]; cursor?: string };

      const fetchPage = async (pageCount: number, pageCursor?: string): Promise<TimelineData | string> => {
        const queryIds = await this.getBookmarkFolderQueryIds();

        const parseFolderTimeline = (json: Record<string, unknown>): TimelineData | undefined => {
          const data = json.data as Record<string, unknown> | undefined;
          const bookmarkCollectionTimeline = data?.bookmark_collection_timeline as Record<string, unknown> | undefined;
          const timeline = bookmarkCollectionTimeline?.timeline as Record<string, unknown> | undefined;
          const instructions = timeline?.instructions as Array<Record<string, unknown>> | undefined;
          const pageTweets = parseTweetsFromInstructions(
            instructions as Parameters<typeof parseTweetsFromInstructions>[0],
            { quoteDepth: this.quoteDepth, includeRaw },
          );
          const nextCursor = extractCursorFromInstructions(
            instructions as Parameters<typeof extractCursorFromInstructions>[0],
          );
          return { tweets: pageTweets, cursor: nextCursor };
        };

        // Custom error checker: allow non-fatal errors when instructions are present
        const checkErrors = (json: Record<string, unknown>): string | undefined => {
          const errors = json.errors as Array<{ message?: string }> | undefined;
          if (!errors || errors.length === 0) {
            return undefined;
          }
          const data = json.data as Record<string, unknown> | undefined;
          const bookmarkCollectionTimeline = data?.bookmark_collection_timeline as Record<string, unknown> | undefined;
          const timeline = bookmarkCollectionTimeline?.timeline as Record<string, unknown> | undefined;
          const instructions = timeline?.instructions;
          if (instructions) {
            return undefined;
          }
          return errors.map((e) => e.message ?? 'Unknown error').join(', ');
        };

        // Try with count, then without if the variable is rejected
        const result = await this.graphqlFetchWithRefresh<TimelineData>(
          {
            operationName: 'BookmarkFolderTimeline',
            queryIds,
            variables: {
              bookmark_collection_id: folderId,
              includePromotedContent: true,
              count: pageCount,
              ...(pageCursor ? { cursor: pageCursor } : {}),
            },
            features,
          },
          parseFolderTimeline,
          checkErrors,
        );

        if (result.success) {
          return result.data;
        }

        // If the error is about the $count variable, retry without it
        if (result.error?.includes('Variable "$count"')) {
          const retryResult = await this.graphqlFetchWithRefresh<TimelineData>(
            {
              operationName: 'BookmarkFolderTimeline',
              queryIds,
              variables: {
                bookmark_collection_id: folderId,
                includePromotedContent: true,
                ...(pageCursor ? { cursor: pageCursor } : {}),
              },
              features,
            },
            parseFolderTimeline,
            checkErrors,
          );
          if (retryResult.success) {
            return retryResult.data;
          }
          return retryResult.error;
        }

        return result.error;
      };

      const unlimited = limit === Number.POSITIVE_INFINITY;
      while (unlimited || tweets.length < limit) {
        const pageCount = unlimited ? pageSize : Math.min(pageSize, limit - tweets.length);
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
          if (!unlimited && tweets.length >= limit) {
            break;
          }
        }

        const pageCursor = page.cursor;
        if (!pageCursor || pageCursor === cursor || page.tweets.length === 0 || added === 0) {
          nextCursor = undefined;
          break;
        }
        if (maxPages && pagesFetched >= maxPages) {
          nextCursor = pageCursor;
          break;
        }
        cursor = pageCursor;
        nextCursor = pageCursor;
      }

      return { success: true, tweets, nextCursor };
    }
  }

  return TwitterClientTimelines;
}
