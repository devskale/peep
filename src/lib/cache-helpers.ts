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
