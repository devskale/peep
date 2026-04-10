import { paginateCursor } from './paginate-cursor.js';
import type { AbstractConstructor, Mixin, TwitterClientBase } from './twitter-client-base.js';
import { buildListsFeatures } from './twitter-client-features.js';
import type { TimelineFetchOptions, TimelinePaginationOptions } from './twitter-client-timelines.js';
import type { ListsResult, SearchResult, TweetData, TwitterList } from './twitter-client-types.js';
import { extractCursorFromInstructions, parseTweetsFromInstructions } from './twitter-client-utils.js';

export interface TwitterClientListMethods {
  getOwnedLists(count?: number): Promise<ListsResult>;
  getListMemberships(count?: number): Promise<ListsResult>;
  getListTimeline(listId: string, count?: number, options?: TimelineFetchOptions): Promise<SearchResult>;
  getAllListTimeline(listId: string, options?: TimelinePaginationOptions): Promise<SearchResult>;
}

interface GraphqlListResult {
  id_str?: string;
  name?: string;
  description?: string;
  member_count?: number;
  subscriber_count?: number;
  mode?: string;
  created_at?: string;
  user_results?: {
    result?: {
      rest_id?: string;
      legacy?: {
        screen_name?: string;
        name?: string;
      };
    };
  };
}

function parseList(listResult: GraphqlListResult): TwitterList | null {
  if (!listResult.id_str || !listResult.name) {
    return null;
  }

  const owner = listResult.user_results?.result;
  return {
    id: listResult.id_str,
    name: listResult.name,
    description: listResult.description,
    memberCount: listResult.member_count,
    subscriberCount: listResult.subscriber_count,
    isPrivate: listResult.mode?.toLowerCase() === 'private',
    createdAt: listResult.created_at,
    owner: owner
      ? {
          id: owner.rest_id ?? '',
          username: owner.legacy?.screen_name ?? '',
          name: owner.legacy?.name ?? '',
        }
      : undefined,
  };
}

function parseListsFromInstructions(
  instructions:
    | Array<{
        entries?: Array<{
          content?: {
            itemContent?: {
              list?: GraphqlListResult;
            };
          };
        }>;
      }>
    | undefined,
): TwitterList[] {
  const lists: TwitterList[] = [];
  if (!instructions) {
    return lists;
  }

  for (const instruction of instructions) {
    if (!instruction.entries) {
      continue;
    }
    for (const entry of instruction.entries) {
      const listResult = entry.content?.itemContent?.list;
      if (listResult) {
        const parsed = parseList(listResult);
        if (parsed) {
          lists.push(parsed);
        }
      }
    }
  }

  return lists;
}

export function withLists<TBase extends AbstractConstructor<TwitterClientBase>>(
  Base: TBase,
): Mixin<TBase, TwitterClientListMethods> {
  abstract class TwitterClientLists extends Base {
    // biome-ignore lint/complexity/noUselessConstructor lint/suspicious/noExplicitAny: TS mixin constructor requirement.
    constructor(...args: any[]) {
      super(...args);
    }

    private async getListOwnershipsQueryIds(): Promise<string[]> {
      return this.getQueryIdsWithFallbacks('ListOwnerships');
    }

    private async getListMembershipsQueryIds(): Promise<string[]> {
      return this.getQueryIdsWithFallbacks('ListMemberships');
    }

    private async getListTimelineQueryIds(): Promise<string[]> {
      return this.getQueryIdsWithFallbacks('ListLatestTweetsTimeline');
    }

    /**
     * Get lists owned by the authenticated user
     */
    async getOwnedLists(count = 100): Promise<ListsResult> {
      const userResult = await this.getCurrentUser();
      if (!userResult.success || !userResult.user) {
        return { success: false, error: userResult.error ?? 'Could not determine current user' };
      }

      const queryIds = await this.getListOwnershipsQueryIds();

      const parseLists = (json: Record<string, unknown>): TwitterList[] | undefined => {
        const data = json.data as Record<string, unknown> | undefined;
        const user = data?.user as Record<string, unknown> | undefined;
        const result = user?.result as Record<string, unknown> | undefined;
        const timeline = result?.timeline as Record<string, unknown> | undefined;
        const tl = timeline?.timeline as Record<string, unknown> | undefined;
        const instructions = tl?.instructions as Array<Record<string, unknown>> | undefined;
        const lists = parseListsFromInstructions(instructions as Parameters<typeof parseListsFromInstructions>[0]);
        return lists; // empty array is a valid result
      };

      const result = await this.graphqlFetchWithRefresh<TwitterList[]>(
        {
          operationName: 'ListOwnerships',
          queryIds,
          variables: {
            userId: userResult.user.id,
            count,
            isListMembershipShown: true,
            isListMemberTargetUserId: userResult.user.id,
          },
          features: buildListsFeatures(),
        },
        parseLists,
      );

      if (result.success) {
        return { success: true, lists: result.data };
      }
      return { success: false, error: result.error };
    }

    /**
     * Get lists the authenticated user is a member of
     */
    async getListMemberships(count = 100): Promise<ListsResult> {
      const userResult = await this.getCurrentUser();
      if (!userResult.success || !userResult.user) {
        return { success: false, error: userResult.error ?? 'Could not determine current user' };
      }

      const queryIds = await this.getListMembershipsQueryIds();

      const parseLists = (json: Record<string, unknown>): TwitterList[] | undefined => {
        const data = json.data as Record<string, unknown> | undefined;
        const user = data?.user as Record<string, unknown> | undefined;
        const result = user?.result as Record<string, unknown> | undefined;
        const timeline = result?.timeline as Record<string, unknown> | undefined;
        const tl = timeline?.timeline as Record<string, unknown> | undefined;
        const instructions = tl?.instructions as Array<Record<string, unknown>> | undefined;
        const lists = parseListsFromInstructions(instructions as Parameters<typeof parseListsFromInstructions>[0]);
        return lists; // empty array is a valid result
      };

      const result = await this.graphqlFetchWithRefresh<TwitterList[]>(
        {
          operationName: 'ListMemberships',
          queryIds,
          variables: {
            userId: userResult.user.id,
            count,
            isListMembershipShown: true,
            isListMemberTargetUserId: userResult.user.id,
          },
          features: buildListsFeatures(),
        },
        parseLists,
      );

      if (result.success) {
        return { success: true, lists: result.data };
      }
      return { success: false, error: result.error };
    }

    /**
     * Get tweets from a list timeline
     */
    async getListTimeline(listId: string, count = 20, options: TimelineFetchOptions = {}): Promise<SearchResult> {
      return this.getListTimelinePaged(listId, count, options);
    }

    /**
     * Get all tweets from a list timeline (paginated)
     */
    async getAllListTimeline(listId: string, options?: TimelinePaginationOptions): Promise<SearchResult> {
      return this.getListTimelinePaged(listId, Number.POSITIVE_INFINITY, options);
    }

    /**
     * Internal paginated list timeline fetcher
     */
    private async getListTimelinePaged(
      listId: string,
      limit: number,
      options: TimelinePaginationOptions = {},
    ): Promise<SearchResult> {
      const features = buildListsFeatures();
      const { includeRaw = false, maxPages } = options;

      const result = await paginateCursor<TweetData>({
        cursor: options.cursor,
        limit,
        maxPages,
        getKey: (tweet) => tweet.id,
        fetchPage: async (count, pageCursor) => {
          const queryIds = await this.getListTimelineQueryIds();

          const parseTimeline = (json: Record<string, unknown>) => {
            const data = json.data as Record<string, unknown> | undefined;
            const list = data?.list as Record<string, unknown> | undefined;
            const tweetsTimeline = list?.tweets_timeline as Record<string, unknown> | undefined;
            const timeline = tweetsTimeline?.timeline as Record<string, unknown> | undefined;
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

          const gqlResult = await this.graphqlFetchWithRefresh(
            {
              operationName: 'ListLatestTweetsTimeline',
              queryIds,
              variables: { listId, count, ...(pageCursor ? { cursor: pageCursor } : {}) },
              features,
            },
            parseTimeline,
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

  return TwitterClientLists;
}
