/**
 * Cache-aware helpers for commands.
 *
 * Provides thin wrappers that store fetched tweets in the local SQLite cache
 * after a successful API call, so subsequent local-search and inbox commands
 * can work offline.
 */

import { getDb, storeTweets, storeUser } from './local-cache.js';
import type { TweetData, TwitterUser } from './twitter-client-types.js';

/**
 * Store tweets from an API result into the local cache.
 * Safe to call — silently no-ops if the DB is unavailable.
 */
export function cacheTweets(tweets: TweetData[], source = 'live'): void {
  try {
    const db = getDb();
    storeTweets(db, tweets, source);
  } catch {
    // cache is optional — never fail a live command because of it
  }
}

/**
 * Store users from an API result into the local cache.
 */
export function cacheUsers(users: TwitterUser[]): void {
  try {
    const db = getDb();
    for (const u of users) {
      storeUser(db, u);
    }
  } catch {
    // cache is optional
  }
}

/**
 * Download images for tweets with photo media.
 * Safe to call — silently no-ops if the DB or media cache is unavailable.
 * Runs asynchronously and does not block the caller.
 */
export function cacheTweetMedia(tweets: TweetData[], cookieHeader: string): void {
  // Fire and forget — don't block the command output
  (async () => {
    try {
      const { cacheStarredMedia } = await import('./media-cache.js');
      for (const tweet of tweets) {
        if (!tweet.media || tweet.media.length === 0) {
          continue;
        }
        const photoMedia = tweet.media
          .filter((m) => m.type === 'photo' && m.url)
          .map((m) => ({ type: m.type, url: m.url }));
        if (photoMedia.length === 0) {
          continue;
        }
        await cacheStarredMedia(tweet.id, photoMedia, cookieHeader);
      }
    } catch {
      // media cache is optional
    }
  })();
}
