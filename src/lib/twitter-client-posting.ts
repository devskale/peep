import type { AbstractConstructor, Mixin, TwitterClientBase } from './twitter-client-base.js';
import { TWITTER_STATUS_UPDATE_URL } from './twitter-client-constants.js';
import { buildTweetCreateFeatures } from './twitter-client-features.js';
import type { CreateTweetResponse, TweetResult } from './twitter-client-types.js';

export interface TwitterClientPostingMethods {
  tweet(text: string, mediaIds?: string[]): Promise<TweetResult>;
  reply(text: string, replyToTweetId: string, mediaIds?: string[]): Promise<TweetResult>;
}

export function withPosting<TBase extends AbstractConstructor<TwitterClientBase>>(
  Base: TBase,
): Mixin<TBase, TwitterClientPostingMethods> {
  abstract class TwitterClientPosting extends Base {
    // biome-ignore lint/complexity/noUselessConstructor lint/suspicious/noExplicitAny: TS mixin constructor requirement.
    constructor(...args: any[]) {
      super(...args);
    }

    /**
     * Post a new tweet
     */
    async tweet(text: string, mediaIds?: string[]): Promise<TweetResult> {
      const variables = {
        tweet_text: text,
        dark_request: false,
        media: {
          media_entities: (mediaIds ?? []).map((id) => ({ media_id: id, tagged_users: [] })),
          possibly_sensitive: false,
        },
        semantic_annotation_ids: [],
      };

      return this.createTweet(variables);
    }

    /**
     * Reply to an existing tweet
     */
    async reply(text: string, replyToTweetId: string, mediaIds?: string[]): Promise<TweetResult> {
      const variables = {
        tweet_text: text,
        reply: {
          in_reply_to_tweet_id: replyToTweetId,
          exclude_reply_user_ids: [],
        },
        dark_request: false,
        media: {
          media_entities: (mediaIds ?? []).map((id) => ({ media_id: id, tagged_users: [] })),
          possibly_sensitive: false,
        },
        semantic_annotation_ids: [],
      };

      return this.createTweet(variables);
    }

    private async createTweet(variables: Record<string, unknown>): Promise<TweetResult> {
      await this.ensureClientUserId();
      const queryIds = await this.getQueryId('CreateTweet');
      const features = buildTweetCreateFeatures();

      const parseTweetId = (json: Record<string, unknown>): string | undefined => {
        const data = json.data as Record<string, unknown> | undefined;
        const createTweet = data?.create_tweet as Record<string, unknown> | undefined;
        const tweetResults = createTweet?.tweet_results as Record<string, unknown> | undefined;
        const result = tweetResults?.result as Record<string, unknown> | undefined;
        if (typeof result?.rest_id === 'string') return result.rest_id;
        // If data exists but has no rest_id, throw a specific error
        if (data?.create_tweet) throw new Error('Tweet created but no ID returned');
        return undefined;
      };

      const checkErrors = (json: Record<string, unknown>): string | undefined => {
        const errors = json.errors as Array<{ message: string; code?: number }> | undefined;
        if (!errors || errors.length === 0) return undefined;
        return errors.map((e) => (typeof e.code === 'number' ? `${e.message} (${e.code})` : e.message)).join(', ');
      };

      const result = await this.graphqlMutationWithRetry<string>(
        {
          operationName: 'CreateTweet',
          queryIds: [queryIds],
          variables,
          features,
          method: 'POST',
          extraHeaders: { referer: 'https://x.com/compose/post' },
        },
        parseTweetId,
        checkErrors,
      );

      if (result.success) {
        return { success: true, tweetId: result.data };
      }

      // Error 226 = "automated request" → try legacy status/update fallback
      if (result.error.includes('(226)')) {
        const fallback = await this.tryStatusUpdateFallback(variables);
        if (fallback) {
          if (fallback.success) return fallback;
          // Surface fallback error alongside original 226 error
          return { success: false, error: `${result.error}, fallback: ${fallback.error}` };
        }
      }

      return { success: false, error: result.error };
    }

    private statusUpdateInputFromCreateTweetVariables(variables: Record<string, unknown>): {
      text: string;
      inReplyToTweetId?: string;
      mediaIds?: string[];
    } | null {
      const text = typeof variables.tweet_text === 'string' ? variables.tweet_text : null;
      if (!text) {
        return null;
      }

      const reply = variables.reply;
      const inReplyToTweetId =
        reply &&
        typeof reply === 'object' &&
        typeof (reply as { in_reply_to_tweet_id?: unknown }).in_reply_to_tweet_id === 'string'
          ? (reply as { in_reply_to_tweet_id: string }).in_reply_to_tweet_id
          : undefined;

      const media = variables.media;
      const mediaEntities =
        media && typeof media === 'object' ? (media as { media_entities?: unknown }).media_entities : undefined;

      const mediaIds = Array.isArray(mediaEntities)
        ? mediaEntities
            .map((entity) =>
              entity && typeof entity === 'object' && 'media_id' in (entity as Record<string, unknown>)
                ? (entity as { media_id?: unknown }).media_id
                : undefined,
            )
            .filter((value): value is string | number => typeof value === 'string' || typeof value === 'number')
            .map((value) => String(value))
        : undefined;

      return { text, inReplyToTweetId, mediaIds: mediaIds && mediaIds.length > 0 ? mediaIds : undefined };
    }

    private async postStatusUpdate(input: {
      text: string;
      inReplyToTweetId?: string;
      mediaIds?: string[];
    }): Promise<TweetResult> {
      const params = new URLSearchParams();
      params.set('status', input.text);
      if (input.inReplyToTweetId) {
        params.set('in_reply_to_status_id', input.inReplyToTweetId);
        params.set('auto_populate_reply_metadata', 'true');
      }
      if (input.mediaIds && input.mediaIds.length > 0) {
        params.set('media_ids', input.mediaIds.join(','));
      }

      try {
        const response = await this.fetchWithTimeout(TWITTER_STATUS_UPDATE_URL, {
          method: 'POST',
          headers: {
            ...this.getBaseHeaders(),
            'content-type': 'application/x-www-form-urlencoded',
            referer: 'https://x.com/compose/post',
          },
          body: params.toString(),
        });

        if (!response.ok) {
          const text = await response.text();
          return { success: false, error: `HTTP ${response.status}: ${text.slice(0, 200)}` };
        }

        const data = (await response.json()) as {
          id_str?: string;
          id?: string | number;
          errors?: Array<{ message: string; code?: number }>;
        };

        if (data.errors && data.errors.length > 0) {
          return { success: false, error: this.formatErrors(data.errors) };
        }

        const tweetId =
          typeof data.id_str === 'string' ? data.id_str : data.id !== undefined ? String(data.id) : undefined;

        if (tweetId) {
          return { success: true, tweetId };
        }
        return { success: false, error: 'Tweet created but no ID returned' };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    private async tryStatusUpdateFallback(variables: Record<string, unknown>): Promise<TweetResult | null> {
      const input = this.statusUpdateInputFromCreateTweetVariables(variables);
      if (!input) {
        return null;
      }

      return this.postStatusUpdate(input);
    }

    private formatErrors(errors: Array<{ message: string; code?: number }>): string {
      return errors
        .map((error) => (typeof error.code === 'number' ? `${error.message} (${error.code})` : error.message))
        .join(', ');
    }
  }

  return TwitterClientPosting;
}
