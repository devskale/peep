import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeDb,
  getDb,
  type LocalSearchParams,
  sanitizeFtsMatchQuery,
  searchLocalTweets,
  storeTweet,
} from '../src/lib/local-cache.js';
import type { TweetData } from '../src/lib/twitter-client-types.js';

const LEGACY_FTS_CONTENT_REGEX = /content\s*=/;

let cacheDir: string;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'peep-cache-test-'));
});

afterEach(() => {
  closeDb();
  rmSync(cacheDir, { recursive: true, force: true });
});

function makeTweet(id: string, text: string, username = 'alice'): TweetData {
  return {
    id,
    text,
    author: { username, name: `Display ${username}` },
    authorId: `100${id}`,
    createdAt: 'Wed Feb 05 10:00:00 +0000 2025',
  };
}

describe('sanitizeFtsMatchQuery', () => {
  it('wraps each token in a quoted phrase', () => {
    expect(sanitizeFtsMatchQuery('hello world')).toBe('"hello" "world"');
  });

  it('escapes embedded double quotes', () => {
    expect(sanitizeFtsMatchQuery('say "hi" now')).toBe('"say" """hi""" "now"');
  });

  it('collapses whitespace and ignores empty tokens', () => {
    expect(sanitizeFtsMatchQuery('  a   b ')).toBe('"a" "b"');
    expect(sanitizeFtsMatchQuery('   ')).toBe('');
  });
});

describe('local-cache FTS behavior', () => {
  it('finds tweets when the query contains FTS syntax characters', () => {
    const db = getDb({ PEEP_CACHE_DIR: cacheDir });
    storeTweet(db, makeTweet('1', 'bug; ("drop table") fix it'));

    const results = searchLocalTweets(db, { query: 'bug; ("drop' } as LocalSearchParams);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('1');
  });

  it('does not duplicate results when a tweet is stored twice', () => {
    const db = getDb({ PEEP_CACHE_DIR: cacheDir });
    storeTweet(db, makeTweet('1', 'hello world'));
    storeTweet(db, makeTweet('1', 'hello world'));

    const results = searchLocalTweets(db, { query: 'hello' });
    expect(results).toHaveLength(1);
  });

  it('re-indexes updated text instead of keeping stale rows', () => {
    const db = getDb({ PEEP_CACHE_DIR: cacheDir });
    storeTweet(db, makeTweet('1', 'original text'));
    storeTweet(db, makeTweet('1', 'replacement text'));

    expect(searchLocalTweets(db, { query: 'replacement' })).toHaveLength(1);
    expect(searchLocalTweets(db, { query: 'original' })).toHaveLength(0);
  });
});

describe('legacy external-content FTS migration', () => {
  function createLegacyDb(dir: string): void {
    const db = new Database(join(dir, 'cache.db'));
    db.exec(`
      CREATE TABLE profiles (
        id          TEXT PRIMARY KEY,
        username    TEXT NOT NULL,
        name        TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        followers_count INTEGER NOT NULL DEFAULT 0,
        following_count INTEGER NOT NULL DEFAULT 0,
        is_blue_verified INTEGER NOT NULL DEFAULT 0,
        profile_image_url TEXT,
        created_at  TEXT,
        fetched_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE tweets (
        id                  TEXT PRIMARY KEY,
        text                TEXT NOT NULL,
        author_id           TEXT NOT NULL REFERENCES profiles(id),
        created_at          TEXT,
        reply_count         INTEGER NOT NULL DEFAULT 0,
        retweet_count       INTEGER NOT NULL DEFAULT 0,
        like_count          INTEGER NOT NULL DEFAULT 0,
        conversation_id     TEXT,
        in_reply_to_id      TEXT,
        source              TEXT NOT NULL DEFAULT 'live',
        fetched_at          TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE VIRTUAL TABLE tweets_fts USING fts5(
        id UNINDEXED,
        text,
        username,
        content='tweets',
        content_rowid='rowid'
      );
    `);
    db.prepare("INSERT INTO profiles (id, username, name) VALUES ('1001', 'alice', 'Display alice')").run();
    db.prepare("INSERT INTO tweets (id, text, author_id) VALUES ('1', 'legacy hello world', '1001')").run();
    // Simulate the legacy bug: the same tweet indexed twice.
    db.prepare('INSERT INTO tweets_fts(id, text, username) VALUES (?, ?, ?)').run('1', 'legacy hello world', 'alice');
    db.prepare('INSERT INTO tweets_fts(id, text, username) VALUES (?, ?, ?)').run('1', 'legacy hello world', 'alice');
    db.close();
  }

  it('rebuilds legacy FTS tables and removes duplicate index rows', () => {
    createLegacyDb(cacheDir);

    const db = getDb({ PEEP_CACHE_DIR: cacheDir });
    const results = searchLocalTweets(db, { query: 'legacy' });
    expect(results).toHaveLength(1);
    expect(results[0].text).toBe('legacy hello world');

    // Schema is now standalone (no content= config).
    const sql = (
      db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'tweets_fts'").get() as {
        sql: string;
      }
    ).sql;
    expect(sql).not.toMatch(LEGACY_FTS_CONTENT_REGEX);
  });
});
