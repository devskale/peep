import { normalizeHandle } from './normalize-handle.js';
import type { AbstractConstructor, Mixin, TwitterClientBase } from './twitter-client-base.js';
import type { AboutAccountResult } from './twitter-client-types.js';

/** Result of username to userId lookup */
export interface UserLookupResult {
  success: boolean;
  userId?: string;
  username?: string;
  name?: string;
  error?: string;
}

export interface TwitterClientUserLookupMethods {
  getUserIdByUsername(username: string): Promise<UserLookupResult>;
  getUserAboutAccount(username: string): Promise<AboutAccountResult>;
}

export function withUserLookup<TBase extends AbstractConstructor<TwitterClientBase>>(
  Base: TBase,
): Mixin<TBase, TwitterClientUserLookupMethods> {
  abstract class TwitterClientUserLookup extends Base {
    // biome-ignore lint/complexity/noUselessConstructor lint/suspicious/noExplicitAny: TS mixin constructor requirement.
    constructor(...args: any[]) {
      super(...args);
    }

    private async getUserByScreenNameGraphQL(screenName: string): Promise<UserLookupResult> {
      const queryIds = ['xc8f1g7BYqr6VTzTbvNlGw', 'qW5u-DAuXpMEG0zA1F7UGQ', 'sLVLhk0bGj3MVFEKTdax1w'];

      const variables = {
        screen_name: screenName,
        withSafetyModeUserFields: true,
      };

      const features = {
        hidden_profile_subscriptions_enabled: true,
        hidden_profile_likes_enabled: true,
        rweb_tipjar_consumption_enabled: true,
        responsive_web_graphql_exclude_directive_enabled: true,
        verified_phone_label_enabled: false,
        subscriptions_verification_info_is_identity_verified_enabled: true,
        subscriptions_verification_info_verified_since_enabled: true,
        highlights_tweets_tab_ui_enabled: true,
        responsive_web_twitter_article_notes_tab_enabled: true,
        subscriptions_feature_can_gift_premium: true,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        responsive_web_graphql_timeline_navigation_enabled: true,
        blue_business_profile_image_shape_enabled: true,
      };

      const fieldToggles = {
        withAuxiliaryUserLabels: false,
      };

      type UserData = { userId: string; username: string; name: string };

      const parseUser = (json: Record<string, unknown>): UserData | undefined => {
        const data = json.data as Record<string, unknown> | undefined;
        const user = data?.user as Record<string, unknown> | undefined;
        const result = user?.result as Record<string, unknown> | undefined;

        if (result?.__typename === 'UserUnavailable') {
          // Signal via a special marker that the user is gone — handled via undefined + special error below
          return undefined;
        }

        const restId = typeof result?.rest_id === 'string' ? result.rest_id : undefined;
        const legacy = result?.legacy as Record<string, unknown> | undefined;
        const core = result?.core as Record<string, unknown> | undefined;
        const username = typeof legacy?.screen_name === 'string' ? legacy.screen_name : typeof core?.screen_name === 'string' ? core.screen_name : undefined;
        const name = typeof legacy?.name === 'string' ? legacy.name : typeof core?.name === 'string' ? core.name : username;

        if (restId && username) {
          return { userId: restId, username, name: name || username };
        }
        return undefined;
      };

      // Custom error checker: detect UserUnavailable before falling through to default errors
      const checkErrors = (json: Record<string, unknown>): string | undefined => {
        const data = json.data as Record<string, unknown> | undefined;
        const user = data?.user as Record<string, unknown> | undefined;
        const result = user?.result as Record<string, unknown> | undefined;
        if (result?.__typename === 'UserUnavailable') {
          return `__user_unavailable__`;
        }
        // Fall back to default GraphQL error checking
        const errors = json.errors as Array<{ message: string }> | undefined;
        if (errors && errors.length > 0) {
          return errors.map((e) => e.message).join(', ');
        }
        return undefined;
      };

      const result = await this.graphqlFetchWithRefresh<UserData>(
        { operationName: 'UserByScreenName', queryIds, variables, features, fieldToggles },
        parseUser,
        checkErrors,
      );

      if (result.success) {
        return { success: true, userId: result.data.userId, username: result.data.username, name: result.data.name };
      }

      if (result.error === '__user_unavailable__') {
        return { success: false, error: `User @${screenName} not found or unavailable` };
      }

      return { success: false, error: result.error };
    }

    /**
     * Look up a user's ID by their username/handle.
     * Uses GraphQL UserByScreenName first, then falls back to REST on transient failures.
     */
    async getUserIdByUsername(username: string): Promise<UserLookupResult> {
      const cleanUsername = normalizeHandle(username);
      if (!cleanUsername) {
        return { success: false, error: `Invalid username: ${username}` };
      }

      const graphqlResult = await this.getUserByScreenNameGraphQL(cleanUsername);
      if (graphqlResult.success) {
        return graphqlResult;
      }

      // If GraphQL definitively says user is unavailable, don't retry with REST
      if (graphqlResult.error?.includes('not found or unavailable')) {
        return graphqlResult;
      }

      // Fallback to REST API for transient GraphQL errors
      const urls = [
        `https://x.com/i/api/1.1/users/show.json?screen_name=${encodeURIComponent(cleanUsername)}`,
        `https://api.twitter.com/1.1/users/show.json?screen_name=${encodeURIComponent(cleanUsername)}`,
      ];

      let lastError: string | undefined = graphqlResult.error;

      for (const url of urls) {
        try {
          const response = await this.fetchWithTimeout(url, {
            method: 'GET',
            headers: this.getHeaders(),
          });

          if (!response.ok) {
            const text = await response.text();
            if (response.status === 404) {
              return { success: false, error: `User @${cleanUsername} not found` };
            }
            lastError = `HTTP ${response.status}: ${text.slice(0, 200)}`;
            continue;
          }

          const data = (await response.json()) as {
            id_str?: string;
            id?: number;
            screen_name?: string;
            name?: string;
          };

          const userId = data.id_str ?? (data.id ? String(data.id) : null);
          if (!userId) {
            lastError = 'Could not parse user ID from response';
            continue;
          }

          return {
            success: true,
            userId,
            username: data.screen_name ?? cleanUsername,
            name: data.name,
          };
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      return { success: false, error: lastError ?? 'Unknown error looking up user' };
    }

    private async getAboutAccountQueryIds(): Promise<string[]> {
      const primary = await this.getQueryId('AboutAccountQuery');
      return Array.from(new Set([primary, 'zs_jFPFT78rBpXv9Z3U2YQ']));
    }

    /**
     * Get account origin and location information for a user.
     * Returns data from Twitter's "About this account" feature.
     */
    async getUserAboutAccount(username: string): Promise<AboutAccountResult> {
      const cleanUsername = normalizeHandle(username);
      if (!cleanUsername) {
        return { success: false, error: `Invalid username: ${username}` };
      }

      const queryIds = await this.getAboutAccountQueryIds();
      const variables = { screenName: cleanUsername };

      type AboutData = {
        accountBasedIn?: string;
        source?: string;
        createdCountryAccurate?: boolean;
        locationAccurate?: boolean;
        learnMoreUrl?: string;
      };

      const parseAbout = (json: Record<string, unknown>): AboutData | undefined => {
        const data = json.data as Record<string, unknown> | undefined;
        const userResult = data?.user_result_by_screen_name as Record<string, unknown> | undefined;
        const result = userResult?.result as Record<string, unknown> | undefined;
        const about = result?.about_profile as Record<string, unknown> | undefined;
        if (!about) throw new Error('Missing about_profile');
        return {
          accountBasedIn: typeof about.account_based_in === 'string' ? about.account_based_in : undefined,
          source: typeof about.source === 'string' ? about.source : undefined,
          createdCountryAccurate: typeof about.created_country_accurate === 'boolean' ? about.created_country_accurate : undefined,
          locationAccurate: typeof about.location_accurate === 'boolean' ? about.location_accurate : undefined,
          learnMoreUrl: typeof about.learn_more_url === 'string' ? about.learn_more_url : undefined,
        };
      };

      const result = await this.graphqlFetchWithRefresh<AboutData>(
        { operationName: 'AboutAccountQuery', queryIds, variables },
        parseAbout,
      );

      if (result.success) {
        return { success: true, aboutProfile: result.data };
      }
      return { success: false, error: result.error };
    }
  }

  return TwitterClientUserLookup;
}
