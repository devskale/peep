import { paginateCursor } from './paginate-cursor.js';
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
      return this.getQueryIdsWithFallbacks('Bookmarks');
    }

    private async getBookmarkFolderQueryIds(): Promise<string[]> {
      return this.getQueryIdsWithFallbacks('BookmarkFolderTimeline');
    }

    private async getLikesQueryIds(): Promise<string[]> {
      return this.getQueryIdsWithFallbacks('Likes');
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

    private async getLikesPaged(limit: number, options: TimelinePaginationOptions = {}): Promise<SearchResult> {
      const userResult = await this.getCurrentUser();
      if (!userResult.success || !userResult.user) {
        return { success: false, error: userResult.error ?? 'Could not determine current user' };
      }
      const userId = userResult.user.id;
      const features = buildLikesFeatures();
      const { includeRaw = false, maxPages } = options;

      const result = await paginateCursor<TweetData>({
        cursor: options.cursor,
        limit,
        maxPages,
        getKey: (tweet) => tweet.id,
        fetchPage: async (count, pageCursor) => {
          const queryIds = await this.getLikesQueryIds();

          const parseLikes = (json: Record<string, unknown>) => {
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
              return undefined;
            }
            if (message.includes('Query: Unspecified')) {
              return '__query_id_mismatch__';
            }
            return message;
          };

          const gqlResult = await this.graphqlFetchWithRefresh(
            {
              operationName: 'Likes',
              queryIds,
              variables: {
                userId,
                count,
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

    private async getBookmarksPaged(limit: number, options: TimelinePaginationOptions = {}): Promise<SearchResult> {
      const features = buildBookmarksFeatures();
      const { includeRaw = false, maxPages } = options;

      const result = await paginateCursor<TweetData>({
        cursor: options.cursor,
        limit,
        maxPages,
        getKey: (tweet) => tweet.id,
        fetchPage: async (count, pageCursor) => {
          const queryIds = await this.getBookmarksQueryIds();

          const parseBookmarks = (json: Record<string, unknown>) => {
            const data = json.data as Record<string, unknown> | undefined;
            const bookmarkTimelineV2 = data?.bookmark_timeline_v2 as Record<string, unknown> | undefined;
            const timeline = bookmarkTimelineV2?.timeline as Record<string, unknown> | undefined;
            const instructions = timeline?.instructions as Array<Record<string, unknown>> | undefined;
            const pageTweets = parseTweetsFromInstructions(
              instructions as Parameters<typeof parseTweetsFromInstructions>[0],
              { quoteDepth: this.quoteDepth, includeRaw },
            );
            const cursor = extractCursorFromInstructions(
              instructions as Parameters<typeof extractCursorFromInstructions>[0],
            );
            return { items: pageTweets, cursor };
          };

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
              return undefined;
            }
            return errors.map((e) => e.message ?? 'Unknown error').join(', ');
          };

          const gqlResult = await this.graphqlFetchWithRefresh(
            {
              operationName: 'Bookmarks',
              queryIds,
              variables: {
                count,
                includePromotedContent: false,
                withDownvotePerspective: false,
                withReactionsMetadata: false,
                withReactionsPerspective: false,
                ...(pageCursor ? { cursor: pageCursor } : {}),
              },
              features,
            },
            parseBookmarks,
            checkErrors,
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

    private async getBookmarkFolderTimelinePaged(
      folderId: string,
      limit: number,
      options: TimelinePaginationOptions = {},
    ): Promise<SearchResult> {
      const features = buildBookmarksFeatures();
      const { includeRaw = false, maxPages } = options;

      const result = await paginateCursor<TweetData>({
        cursor: options.cursor,
        limit,
        maxPages,
        getKey: (tweet) => tweet.id,
        fetchPage: async (count, pageCursor) => {
          const queryIds = await this.getBookmarkFolderQueryIds();

          const parseFolderTimeline = (json: Record<string, unknown>) => {
            const data = json.data as Record<string, unknown> | undefined;
            const bookmarkCollectionTimeline = data?.bookmark_collection_timeline as
              | Record<string, unknown>
              | undefined;
            const timeline = bookmarkCollectionTimeline?.timeline as Record<string, unknown> | undefined;
            const instructions = timeline?.instructions as Array<Record<string, unknown>> | undefined;
            const pageTweets = parseTweetsFromInstructions(
              instructions as Parameters<typeof parseTweetsFromInstructions>[0],
              { quoteDepth: this.quoteDepth, includeRaw },
            );
            const cursor = extractCursorFromInstructions(
              instructions as Parameters<typeof extractCursorFromInstructions>[0],
            );
            return { items: pageTweets, cursor };
          };

          const checkErrors = (json: Record<string, unknown>): string | undefined => {
            const errors = json.errors as Array<{ message?: string }> | undefined;
            if (!errors || errors.length === 0) {
              return undefined;
            }
            const data = json.data as Record<string, unknown> | undefined;
            const bookmarkCollectionTimeline = data?.bookmark_collection_timeline as
              | Record<string, unknown>
              | undefined;
            const timeline = bookmarkCollectionTimeline?.timeline as Record<string, unknown> | undefined;
            const instructions = timeline?.instructions;
            if (instructions) {
              return undefined;
            }
            return errors.map((e) => e.message ?? 'Unknown error').join(', ');
          };

          const gqlResult = await this.graphqlFetchWithRefresh(
            {
              operationName: 'BookmarkFolderTimeline',
              queryIds,
              variables: {
                bookmark_collection_id: folderId,
                includePromotedContent: true,
                count,
                ...(pageCursor ? { cursor: pageCursor } : {}),
              },
              features,
            },
            parseFolderTimeline,
            checkErrors,
          );

          if (gqlResult.success) {
            return { success: true, ...gqlResult.data };
          }

          // If the error is about the $count variable, retry without it
          if (gqlResult.error?.includes('Variable "$count"')) {
            const retryResult = await this.graphqlFetchWithRefresh(
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
              return { success: true, ...retryResult.data };
            }
            return { success: false, error: retryResult.error };
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

  return TwitterClientTimelines;
}
