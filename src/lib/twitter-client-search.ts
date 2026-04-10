import { paginateCursor } from './paginate-cursor.js';
import type { AbstractConstructor, Mixin, TwitterClientBase } from './twitter-client-base.js';
import { buildSearchFeatures } from './twitter-client-features.js';
import type { SearchResult, TweetData } from './twitter-client-types.js';
import { extractCursorFromInstructions, parseTweetsFromInstructions } from './twitter-client-utils.js';

/** Options for search methods */
export interface SearchFetchOptions {
  /** Include raw GraphQL response in `_raw` field */
  includeRaw?: boolean;
}

/** Options for paged search methods */
export interface SearchPaginationOptions extends SearchFetchOptions {
  maxPages?: number;
  /** Starting cursor for pagination (resume from previous fetch) */
  cursor?: string;
}

export interface TwitterClientSearchMethods {
  search(query: string, count?: number, options?: SearchFetchOptions): Promise<SearchResult>;
  getAllSearchResults(query: string, options?: SearchPaginationOptions): Promise<SearchResult>;
}

export function withSearch<TBase extends AbstractConstructor<TwitterClientBase>>(
  Base: TBase,
): Mixin<TBase, TwitterClientSearchMethods> {
  abstract class TwitterClientSearch extends Base {
    // biome-ignore lint/complexity/noUselessConstructor lint/suspicious/noExplicitAny: TS mixin constructor requirement.
    constructor(...args: any[]) {
      super(...args);
    }

    /**
     * Search for tweets matching a query
     */
    async search(query: string, count = 20, options: SearchFetchOptions = {}): Promise<SearchResult> {
      return this.searchPaged(query, count, options);
    }

    /**
     * Get all search results (paged)
     */
    async getAllSearchResults(query: string, options?: SearchPaginationOptions): Promise<SearchResult> {
      return this.searchPaged(query, Number.POSITIVE_INFINITY, options);
    }

    private async searchPaged(
      query: string,
      limit: number,
      options: SearchPaginationOptions = {},
    ): Promise<SearchResult> {
      const features = buildSearchFeatures();
      const { includeRaw = false, maxPages } = options;

      const result = await paginateCursor<TweetData>({
        cursor: options.cursor,
        limit,
        maxPages,
        getKey: (tweet) => tweet.id,
        fetchPage: async (count, pageCursor) => {
          const queryIds = await this.getSearchTimelineQueryIds();

          const parseSearchResults = (json: Record<string, unknown>) => {
            const data = json.data as Record<string, unknown> | undefined;
            const searchByRawQuery = data?.search_by_raw_query as Record<string, unknown> | undefined;
            const searchTimeline = searchByRawQuery?.search_timeline as Record<string, unknown> | undefined;
            const timeline = searchTimeline?.timeline as Record<string, unknown> | undefined;
            const instructions = timeline?.instructions as Array<Record<string, unknown>> | undefined;
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
            const errors = json.errors as Array<{ message?: string; extensions?: { code?: string } }> | undefined;
            if (!errors || errors.length === 0) {
              return undefined;
            }
            const shouldRefresh = errors.some((e) => e?.extensions?.code === 'GRAPHQL_VALIDATION_FAILED');
            if (shouldRefresh) {
              return '__query_id_mismatch__';
            }
            return errors.map((e) => e.message ?? 'Unknown error').join(', ');
          };

          const gqlResult = await this.graphqlFetchWithRefresh(
            {
              operationName: 'SearchTimeline',
              queryIds,
              variables: {
                rawQuery: query,
                count,
                querySource: 'typed_query',
                product: 'Latest',
                ...(pageCursor ? { cursor: pageCursor } : {}),
              },
              features,
              method: 'POST',
              variablesInUrl: true,
            },
            parseSearchResults,
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
      return { success: false, error: result.error, tweets: result.items };
    }
  }

  return TwitterClientSearch;
}
