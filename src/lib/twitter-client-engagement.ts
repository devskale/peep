import type { AbstractConstructor, Mixin, TwitterClientBase } from './twitter-client-base.js';
import type { OperationName } from './twitter-client-constants.js';
import type { BookmarkMutationResult } from './twitter-client-types.js';

export interface TwitterClientEngagementMethods {
  /** Like a tweet. */
  like(tweetId: string): Promise<BookmarkMutationResult>;
  /** Remove a like from a tweet. */
  unlike(tweetId: string): Promise<BookmarkMutationResult>;
  /** Retweet a tweet. */
  retweet(tweetId: string): Promise<BookmarkMutationResult>;
  /** Remove a retweet. */
  unretweet(tweetId: string): Promise<BookmarkMutationResult>;
  /** Bookmark a tweet. */
  bookmark(tweetId: string): Promise<BookmarkMutationResult>;
}

export function withEngagement<TBase extends AbstractConstructor<TwitterClientBase>>(
  Base: TBase,
): Mixin<TBase, TwitterClientEngagementMethods> {
  abstract class TwitterClientEngagement extends Base {
    // biome-ignore lint/complexity/noUselessConstructor lint/suspicious/noExplicitAny: TS mixin constructor requirement.
    constructor(...args: any[]) {
      super(...args);
    }

    private async performEngagementMutation(
      operationName: OperationName,
      tweetId: string,
    ): Promise<BookmarkMutationResult> {
      await this.ensureClientUserId();
      const variables =
        operationName === 'DeleteRetweet' ? { tweet_id: tweetId, source_tweet_id: tweetId } : { tweet_id: tweetId };
      const queryIds = await this.getQueryId(operationName);

      const result = await this.graphqlMutationWithRetry<{ _sentinel?: true }>(
        {
          operationName,
          queryIds: [queryIds],
          variables,
          method: 'POST',
          extraHeaders: { referer: `https://x.com/i/status/${tweetId}` },
        },
        () => ({ _sentinel: true }),
      );

      if (result.success) {
        return { success: true };
      }
      return { success: false, error: result.error };
    }

    /** Like a tweet. */
    async like(tweetId: string): Promise<BookmarkMutationResult> {
      return this.performEngagementMutation('FavoriteTweet', tweetId);
    }

    /** Remove a like from a tweet. */
    async unlike(tweetId: string): Promise<BookmarkMutationResult> {
      return this.performEngagementMutation('UnfavoriteTweet', tweetId);
    }

    /** Retweet a tweet. */
    async retweet(tweetId: string): Promise<BookmarkMutationResult> {
      return this.performEngagementMutation('CreateRetweet', tweetId);
    }

    /** Remove a retweet. */
    async unretweet(tweetId: string): Promise<BookmarkMutationResult> {
      return this.performEngagementMutation('DeleteRetweet', tweetId);
    }

    /** Bookmark a tweet. */
    async bookmark(tweetId: string): Promise<BookmarkMutationResult> {
      return this.performEngagementMutation('CreateBookmark', tweetId);
    }
  }

  return TwitterClientEngagement;
}
