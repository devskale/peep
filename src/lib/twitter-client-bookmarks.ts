import type { AbstractConstructor, Mixin, TwitterClientBase } from './twitter-client-base.js';
import type { BookmarkMutationResult } from './twitter-client-types.js';

export interface TwitterClientBookmarkMethods {
  unbookmark(tweetId: string): Promise<BookmarkMutationResult>;
}

export function withBookmarks<TBase extends AbstractConstructor<TwitterClientBase>>(
  Base: TBase,
): Mixin<TBase, TwitterClientBookmarkMethods> {
  abstract class TwitterClientBookmarks extends Base {
    // biome-ignore lint/complexity/noUselessConstructor lint/suspicious/noExplicitAny: TS mixin constructor requirement.
    constructor(...args: any[]) {
      super(...args);
    }

    async unbookmark(tweetId: string): Promise<BookmarkMutationResult> {
      const queryIds = await this.getQueryId('DeleteBookmark');

      const result = await this.graphqlMutationWithRetry<{ _sentinel?: true }>(
        {
          operationName: 'DeleteBookmark',
          queryIds: [queryIds],
          variables: { tweet_id: tweetId },
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
  }

  return TwitterClientBookmarks;
}
