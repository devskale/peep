/**
 * Local SQLite cache for peep.
 *
 * Stores fetched tweets, bookmarks, likes, mentions, and profiles in a local
 * SQLite database at `~/.peep/cache.db`. Enables offline access and fast
 * full-text search without hitting X's API on every call.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import BetterSqlite3 from 'better-sqlite3';
import type { TweetData, TwitterUser } from './twitter-client-types.js';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const DEFAULT_CACHE_DIR = join(homedir(), '.peep');
const DEFAULT_DB_NAME = 'cache.db';

export function getCacheDir(env?: NodeJS.ProcessEnv): string {
  return env?.PEEP_CACHE_DIR ?? DEFAULT_CACHE_DIR;
}

export function getCacheDbPath(env?: NodeJS.ProcessEnv): string {
  return join(getCacheDir(env), DEFAULT_DB_NAME);
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// DB singleton
// ---------------------------------------------------------------------------

let dbInstance: Database.Database | null = null;

export function getDb(env?: NodeJS.ProcessEnv): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = getCacheDbPath(env);
  ensureDir(getCacheDir(env));
  const db = BetterSqlite3(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  dbInstance = db;
  return db;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

// ---------------------------------------------------------------------------
// Schema / migrations
// ---------------------------------------------------------------------------

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
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

    CREATE TABLE IF NOT EXISTS tweets (
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

    CREATE TABLE IF NOT EXISTS tweet_media (
      tweet_id    TEXT NOT NULL REFERENCES tweets(id) ON DELETE CASCADE,
      type        TEXT NOT NULL,
      url         TEXT NOT NULL,
      width       INTEGER,
      height      INTEGER,
      video_url   TEXT,
      duration_ms INTEGER,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (tweet_id, sort_order)
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      account_id  TEXT NOT NULL DEFAULT 'default',
      tweet_id    TEXT NOT NULL REFERENCES tweets(id) ON DELETE CASCADE,
      bookmarked_at TEXT NOT NULL DEFAULT (datetime('now')),
      note        TEXT NOT NULL DEFAULT '',
      tags        TEXT NOT NULL DEFAULT '',
      folder_name TEXT NOT NULL DEFAULT '',
      is_read     INTEGER NOT NULL DEFAULT 0,
      is_revisit  INTEGER NOT NULL DEFAULT 0,
      priority    TEXT NOT NULL DEFAULT 'normal',
      PRIMARY KEY (account_id, tweet_id)
    );

    CREATE TABLE IF NOT EXISTS likes (
      account_id  TEXT NOT NULL DEFAULT 'default',
      tweet_id    TEXT NOT NULL REFERENCES tweets(id) ON DELETE CASCADE,
      liked_at    TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (account_id, tweet_id)
    );

    CREATE TABLE IF NOT EXISTS blocks (
      account_id  TEXT NOT NULL DEFAULT 'default',
      profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      source      TEXT NOT NULL DEFAULT 'local',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (account_id, profile_id)
    );

    CREATE TABLE IF NOT EXISTS mutes (
      account_id  TEXT NOT NULL DEFAULT 'default',
      profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      source      TEXT NOT NULL DEFAULT 'local',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (account_id, profile_id)
    );

    CREATE TABLE IF NOT EXISTS sync_cursors (
      account_id  TEXT NOT NULL DEFAULT 'default',
      stream      TEXT NOT NULL,
      cursor      TEXT,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (account_id, stream)
    );

    CREATE TABLE IF NOT EXISTS ai_scores (
      entity_kind TEXT NOT NULL,
      entity_id   TEXT NOT NULL,
      model       TEXT NOT NULL DEFAULT '',
      score       REAL NOT NULL DEFAULT 0,
      summary     TEXT NOT NULL DEFAULT '',
      reasoning   TEXT NOT NULL DEFAULT '',
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (entity_kind, entity_id)
    );

    -- FTS5 virtual tables
    CREATE VIRTUAL TABLE IF NOT EXISTS tweets_fts USING fts5(
      id UNINDEXED,
      text,
      username,
      content='tweets',
      content_rowid='rowid'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS profiles_fts USING fts5(
      id UNINDEXED,
      username,
      name,
      description,
      content='profiles',
      content_rowid='rowid'
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_tweets_author ON tweets(author_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tweets_created ON tweets(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tweets_conversation ON tweets(conversation_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_account ON bookmarks(account_id, bookmarked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_likes_account ON likes(account_id, liked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_priority ON bookmarks(account_id, priority, bookmarked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_revisit ON bookmarks(account_id, is_revisit, bookmarked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_bookmarks_tags ON bookmarks(account_id, tags);
  `);

  // --- Incremental migrations for existing databases ---
  migrateAddColumns(db);
}

/** Add new columns that were added after the initial schema. */
function migrateAddColumns(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info('bookmarks')").all() as Array<{ name: string }>;

  // ---------------------------------------------------------------------------
  // Tweet → DB helpers
  // ---------------------------------------------------------------------------

  const existing = new Set(columns.map((c) => c.name));

  const migrations: Array<{ col: string; def: string }> = [
    { col: 'note', def: "TEXT NOT NULL DEFAULT ''" },
    { col: 'tags', def: "TEXT NOT NULL DEFAULT ''" },
    { col: 'folder_name', def: "TEXT NOT NULL DEFAULT ''" },
    { col: 'is_read', def: 'INTEGER NOT NULL DEFAULT 0' },
    { col: 'is_revisit', def: 'INTEGER NOT NULL DEFAULT 0' },
    { col: 'priority', def: "TEXT NOT NULL DEFAULT 'normal'" },
  ];

  for (const { col, def } of migrations) {
    if (!existing.has(col)) {
      try {
        db.exec(`ALTER TABLE bookmarks ADD COLUMN ${col} ${def}`);
      } catch {
        // Column may already exist in some edge case
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Tweet → DB helpers
// ---------------------------------------------------------------------------

const AT_PREFIX_REGEX = /^@/;

function profileKey(tweet: TweetData): string {
  return tweet.authorId ?? `@${tweet.author.username}`;
}

/** Upsert a profile. Returns the profile ID used. */
export function upsertProfile(db: Database.Database, tweet: TweetData): string {
  const id = profileKey(tweet);
  db.prepare(`
    INSERT INTO profiles (id, username, name, description, followers_count, following_count, is_blue_verified, profile_image_url)
    VALUES (?, ?, ?, ?, 0, 0, 0, NULL)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      name     = excluded.name,
      fetched_at = datetime('now')
  `).run(id, tweet.author.username, tweet.author.name);
  return id;
}

/** Upsert a tweet + its profile + media. Idempotent. */
export function storeTweet(db: Database.Database, tweet: TweetData, source = 'live'): void {
  const authorId = upsertProfile(db, tweet);

  db.prepare(`
    INSERT INTO tweets (id, text, author_id, created_at, reply_count, retweet_count, like_count, conversation_id, in_reply_to_id, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      text            = excluded.text,
      reply_count     = excluded.reply_count,
      retweet_count   = excluded.retweet_count,
      like_count      = excluded.like_count,
      fetched_at      = datetime('now'),
      source          = excluded.source
  `).run(
    tweet.id,
    tweet.text,
    authorId,
    tweet.createdAt ?? null,
    tweet.replyCount ?? 0,
    tweet.retweetCount ?? 0,
    tweet.likeCount ?? 0,
    tweet.conversationId ?? null,
    tweet.inReplyToStatusId ?? null,
    source,
  );

  // Store media
  if (tweet.media && tweet.media.length > 0) {
    const delMedia = db.prepare('DELETE FROM tweet_media WHERE tweet_id = ?');
    const insMedia = db.prepare(
      `INSERT INTO tweet_media (tweet_id, type, url, width, height, video_url, duration_ms, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    delMedia.run(tweet.id);
    for (let i = 0; i < tweet.media.length; i++) {
      const m = tweet.media[i];
      insMedia.run(
        tweet.id,
        m.type,
        m.url,
        m.width ?? null,
        m.height ?? null,
        m.videoUrl ?? null,
        m.durationMs ?? null,
        i,
      );
    }
  }

  // Store quoted tweet recursively
  if (tweet.quotedTweet) {
    storeTweet(db, tweet.quotedTweet, source);
  }

  // Update FTS
  db.prepare('INSERT INTO tweets_fts(id, text, username) VALUES (?, ?, ?)').run(
    tweet.id,
    tweet.text,
    tweet.author.username,
  );
}

/** Store many tweets in a transaction. */
export function storeTweets(db: Database.Database, tweets: TweetData[], source = 'live'): void {
  const tx = db.transaction((items: TweetData[]) => {
    for (const t of items) {
      storeTweet(db, t, source);
    }
  });
  tx(tweets);
}

// ---------------------------------------------------------------------------
// User → DB helpers
// ---------------------------------------------------------------------------

export function storeUser(db: Database.Database, user: TwitterUser): void {
  db.prepare(`
    INSERT INTO profiles (id, username, name, description, followers_count, following_count, is_blue_verified, profile_image_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      username         = excluded.username,
      name             = excluded.name,
      description      = excluded.description,
      followers_count  = excluded.followers_count,
      following_count  = excluded.following_count,
      is_blue_verified = excluded.is_blue_verified,
      profile_image_url = excluded.profile_image_url,
      fetched_at       = datetime('now')
  `).run(
    user.id,
    user.username,
    user.name,
    user.description ?? '',
    user.followersCount ?? 0,
    user.followingCount ?? 0,
    user.isBlueVerified ? 1 : 0,
    user.profileImageUrl ?? null,
    user.createdAt ?? null,
  );

  db.prepare('INSERT OR IGNORE INTO profiles_fts(id, username, name, description) VALUES (?, ?, ?, ?)').run(
    user.id,
    user.username,
    user.name,
    user.description ?? '',
  );
}

// ---------------------------------------------------------------------------
// Row → TweetData conversion
// ---------------------------------------------------------------------------

interface TweetRow {
  id: string;
  text: string;
  author_id: string;
  username: string;
  author_name: string;
  created_at: string | null;
  reply_count: number;
  retweet_count: number;
  like_count: number;
  conversation_id: string | null;
  in_reply_to_id: string | null;
  media_type: string | null;
  media_url: string | null;
  media_width: number | null;
  media_height: number | null;
  media_video_url: string | null;
  media_duration_ms: number | null;
}

export function rowToTweet(row: TweetRow): TweetData {
  return {
    id: row.id,
    text: row.text,
    author: { username: row.username, name: row.author_name },
    authorId: row.author_id,
    createdAt: row.created_at ?? undefined,
    replyCount: row.reply_count,
    retweetCount: row.retweet_count,
    likeCount: row.like_count,
    conversationId: row.conversation_id ?? undefined,
    inReplyToStatusId: row.in_reply_to_id ?? undefined,
    ...(row.media_url
      ? {
          media: [
            {
              type: (row.media_type as 'photo' | 'video' | 'animated_gif') ?? 'photo',
              url: row.media_url,
              width: row.media_width ?? undefined,
              height: row.media_height ?? undefined,
              videoUrl: row.media_video_url ?? undefined,
              durationMs: row.media_duration_ms ?? undefined,
            },
          ],
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

export interface LocalSearchParams {
  query: string;
  author?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}

/** Full-text search over locally cached tweets. */
export function searchLocalTweets(db: Database.Database, params: LocalSearchParams): TweetData[] {
  const limit = Math.min(params.limit ?? 20, 200);
  const offset = params.offset ?? 0;

  let sql = `
    SELECT t.id, t.text, t.author_id, p.username, p.name as author_name,
           t.created_at, t.reply_count, t.retweet_count, t.like_count,
           t.conversation_id, t.in_reply_to_id,
           m.type as media_type, m.url as media_url, m.width as media_width,
           m.height as media_height, m.video_url as media_video_url, m.duration_ms as media_duration_ms
    FROM tweets t
    JOIN profiles p ON t.author_id = p.id
    LEFT JOIN tweet_media m ON m.tweet_id = t.id AND m.sort_order = 0
  `;

  const conditions: string[] = [];
  const values: unknown[] = [];

  if (params.query) {
    // Use FTS5 for text search
    sql = `
      SELECT t.id, t.text, t.author_id, p.username, p.name as author_name,
             t.created_at, t.reply_count, t.retweet_count, t.like_count,
             t.conversation_id, t.in_reply_to_id,
             m.type as media_type, m.url as media_url, m.width as media_width,
             m.height as media_height, m.video_url as media_video_url, m.duration_ms as media_duration_ms
      FROM tweets_fts fts
      JOIN tweets t ON t.id = fts.id
      JOIN profiles p ON t.author_id = p.id
      LEFT JOIN tweet_media m ON m.tweet_id = t.id AND m.sort_order = 0
    `;
    conditions.push('tweets_fts MATCH ?');
    // FTS5 query: wrap in quotes for phrase search, or use AND/OR syntax
    values.push(params.query);
  }

  if (params.author) {
    conditions.push('p.username LIKE ?');
    values.push(`${params.author.replace(AT_PREFIX_REGEX, '')}%`);
  }

  if (params.since) {
    conditions.push('t.created_at >= ?');
    values.push(params.since);
  }

  if (params.until) {
    conditions.push('t.created_at <= ?');
    values.push(params.until);
  }

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }

  sql += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
  values.push(limit, offset);

  return (db.prepare(sql).all(...values) as TweetRow[]).map(rowToTweet);
}

/** Get cached tweet by ID. */
export function getCachedTweet(db: Database.Database, tweetId: string): TweetData | null {
  const row = db
    .prepare(`
    SELECT t.id, t.text, t.author_id, p.username, p.name as author_name,
           t.created_at, t.reply_count, t.retweet_count, t.like_count,
           t.conversation_id, t.in_reply_to_id,
           m.type as media_type, m.url as media_url, m.width as media_width,
           m.height as media_height, m.video_url as media_video_url, m.duration_ms as media_duration_ms
    FROM tweets t
    JOIN profiles p ON t.author_id = p.id
    LEFT JOIN tweet_media m ON m.tweet_id = t.id AND m.sort_order = 0
    WHERE t.id = ?
  `)
    .get(tweetId) as TweetRow | undefined;

  return row ? rowToTweet(row) : null;
}

/** Get tweets from a conversation/thread. */
export function getCachedThread(db: Database.Database, conversationId: string): TweetData[] {
  const rows = db
    .prepare(`
    SELECT t.id, t.text, t.author_id, p.username, p.name as author_name,
           t.created_at, t.reply_count, t.retweet_count, t.like_count,
           t.conversation_id, t.in_reply_to_id,
           m.type as media_type, m.url as media_url, m.width as media_width,
           m.height as media_height, m.video_url as media_video_url, m.duration_ms as media_duration_ms
    FROM tweets t
    JOIN profiles p ON t.author_id = p.id
    LEFT JOIN tweet_media m ON m.tweet_id = t.id AND m.sort_order = 0
    WHERE t.conversation_id = ?
    ORDER BY t.created_at ASC
  `)
    .all(conversationId) as TweetRow[];

  return rows.map(rowToTweet);
}

// ---------------------------------------------------------------------------
// Sync cursors
// ---------------------------------------------------------------------------

export function getSyncCursor(db: Database.Database, stream: string, accountId = 'default'): string | null {
  const row = db
    .prepare('SELECT cursor FROM sync_cursors WHERE account_id = ? AND stream = ?')
    .get(accountId, stream) as { cursor: string } | undefined;
  return row?.cursor ?? null;
}

export function setSyncCursor(db: Database.Database, stream: string, cursor: string, accountId = 'default'): void {
  db.prepare(`
    INSERT INTO sync_cursors (account_id, stream, cursor, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(account_id, stream) DO UPDATE SET
      cursor = excluded.cursor,
      updated_at = datetime('now')
  `).run(accountId, stream, cursor);
}

// ---------------------------------------------------------------------------
// Blocks & Mutes
// ---------------------------------------------------------------------------

export function addBlock(db: Database.Database, profileId: string, accountId = 'default', source = 'local'): void {
  db.prepare(`
    INSERT OR IGNORE INTO blocks (account_id, profile_id, source) VALUES (?, ?, ?)
  `).run(accountId, profileId, source);
}

export function removeBlock(db: Database.Database, profileId: string, accountId = 'default'): void {
  db.prepare('DELETE FROM blocks WHERE account_id = ? AND profile_id = ?').run(accountId, profileId);
}

export function listBlocks(
  db: Database.Database,
  accountId = 'default',
): Array<{ profileId: string; username: string; name: string; source: string; createdAt: string }> {
  return db
    .prepare(`
    SELECT b.profile_id, p.username, p.name, b.source, b.created_at
    FROM blocks b
    JOIN profiles p ON b.profile_id = p.id
    WHERE b.account_id = ?
    ORDER BY b.created_at DESC
  `)
    .all(accountId) as Array<{ profileId: string; username: string; name: string; source: string; createdAt: string }>;
}

export function addMute(db: Database.Database, profileId: string, accountId = 'default', source = 'local'): void {
  db.prepare(`
    INSERT OR IGNORE INTO mutes (account_id, profile_id, source) VALUES (?, ?, ?)
  `).run(accountId, profileId, source);
}

export function removeMute(db: Database.Database, profileId: string, accountId = 'default'): void {
  db.prepare('DELETE FROM mutes WHERE account_id = ? AND profile_id = ?').run(accountId, profileId);
}

export function listMutes(
  db: Database.Database,
  accountId = 'default',
): Array<{ profileId: string; username: string; name: string; source: string; createdAt: string }> {
  return db
    .prepare(`
    SELECT m.profile_id, p.username, p.name, m.source, m.created_at
    FROM mutes m
    JOIN profiles p ON m.profile_id = p.id
    WHERE m.account_id = ?
    ORDER BY m.created_at DESC
  `)
    .all(accountId) as Array<{ profileId: string; username: string; name: string; source: string; createdAt: string }>;
}

// ---------------------------------------------------------------------------
// AI scores
// ---------------------------------------------------------------------------

export function getAiScore(
  db: Database.Database,
  entityKind: string,
  entityId: string,
): { score: number; summary: string; reasoning: string; model: string } | null {
  const row = db
    .prepare('SELECT score, summary, reasoning, model FROM ai_scores WHERE entity_kind = ? AND entity_id = ?')
    .get(entityKind, entityId) as { score: number; summary: string; reasoning: string; model: string } | undefined;
  return row ?? null;
}

export function setAiScore(
  db: Database.Database,
  entityKind: string,
  entityId: string,
  score: number,
  summary: string,
  reasoning: string,
  model: string,
): void {
  db.prepare(`
    INSERT INTO ai_scores (entity_kind, entity_id, model, score, summary, reasoning, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(entity_kind, entity_id) DO UPDATE SET
      model = excluded.model,
      score = excluded.score,
      summary = excluded.summary,
      reasoning = excluded.reasoning,
      updated_at = datetime('now')
  `).run(entityKind, entityId, model, score, summary, reasoning);
}

// ---------------------------------------------------------------------------
// First-class Bookmarks (starred items)
// ---------------------------------------------------------------------------

export interface StoredBookmark {
  tweetId: string;
  accountId: string;
  bookmarkedAt: string;
  note: string;
  tags: string;
  folderName: string;
  isRead: number;
  isRevisit: number;
  priority: string;
  // Joined tweet data
  tweetText: string;
  tweetCreatedAt: string | null;
  authorUsername: string;
  authorName: string;
}

/** Record a bookmark in the local cache. Called after fetching from API. */
export function recordBookmark(db: Database.Database, tweetId: string, accountId = 'default'): void {
  db.prepare(`
    INSERT OR IGNORE INTO bookmarks (account_id, tweet_id) VALUES (?, ?)
  `).run(accountId, tweetId);
}

/** Record multiple bookmarks in a transaction. */
export function recordBookmarks(db: Database.Database, tweetIds: string[], accountId = 'default'): void {
  const tx = db.transaction((ids: string[]) => {
    for (const id of ids) {
      recordBookmark(db, id, accountId);
    }
  });
  tx(tweetIds);
}

/** Update note on a bookmark. */
export function setBookmarkNote(db: Database.Database, tweetId: string, note: string, accountId = 'default'): boolean {
  const result = db
    .prepare(`
    UPDATE bookmarks SET note = ? WHERE account_id = ? AND tweet_id = ?
  `)
    .run(note, accountId, tweetId);
  return result.changes > 0;
}

/** Set tags on a bookmark (comma-separated). */
export function setBookmarkTags(db: Database.Database, tweetId: string, tags: string, accountId = 'default'): boolean {
  const result = db
    .prepare(`
    UPDATE bookmarks SET tags = ? WHERE account_id = ? AND tweet_id = ?
  `)
    .run(tags, accountId, tweetId);
  return result.changes > 0;
}

/** Set folder name on a bookmark. */
export function setBookmarkFolder(
  db: Database.Database,
  tweetId: string,
  folderName: string,
  accountId = 'default',
): boolean {
  const result = db
    .prepare(`
    UPDATE bookmarks SET folder_name = ? WHERE account_id = ? AND tweet_id = ?
  `)
    .run(folderName, accountId, tweetId);
  return result.changes > 0;
}

/** Mark a bookmark as read. */
export function markBookmarkRead(db: Database.Database, tweetId: string, accountId = 'default'): boolean {
  const result = db
    .prepare(`
    UPDATE bookmarks SET is_read = 1 WHERE account_id = ? AND tweet_id = ?
  `)
    .run(accountId, tweetId);
  return result.changes > 0;
}

/** Mark a bookmark as unread. */
export function markBookmarkUnread(db: Database.Database, tweetId: string, accountId = 'default'): boolean {
  const result = db
    .prepare(`
    UPDATE bookmarks SET is_read = 0 WHERE account_id = ? AND tweet_id = ?
  `)
    .run(accountId, tweetId);
  return result.changes > 0;
}

/** Toggle the revisit flag on a bookmark (things you want to come back to). */
export function toggleBookmarkRevisit(db: Database.Database, tweetId: string, accountId = 'default'): boolean | null {
  const row = db
    .prepare(`
    SELECT is_revisit FROM bookmarks WHERE account_id = ? AND tweet_id = ?
  `)
    .get(accountId, tweetId) as { is_revisit: number } | undefined;
  if (!row) {
    return null;
  }
  const newVal = row.is_revisit ? 0 : 1;
  db.prepare(`
    UPDATE bookmarks SET is_revisit = ? WHERE account_id = ? AND tweet_id = ?
  `).run(newVal, accountId, tweetId);
  return newVal === 1;
}

/** Set priority on a bookmark: low, normal, high, critical. */
export function setBookmarkPriority(
  db: Database.Database,
  tweetId: string,
  priority: string,
  accountId = 'default',
): boolean {
  const valid = ['low', 'normal', 'high', 'critical'];
  if (!valid.includes(priority)) {
    return false;
  }
  const result = db
    .prepare(`
    UPDATE bookmarks SET priority = ? WHERE account_id = ? AND tweet_id = ?
  `)
    .run(priority, accountId, tweetId);
  return result.changes > 0;
}

/** List stored bookmarks with tweet data. */
export function listStoredBookmarks(
  db: Database.Database,
  options: {
    accountId?: string;
    unreadOnly?: boolean;
    revisitOnly?: boolean;
    tag?: string;
    folder?: string;
    priority?: string;
    author?: string;
    searchQuery?: string;
    sortBy?: 'bookmarked_at' | 'priority' | 'tweet_created_at';
    sortOrder?: 'DESC' | 'ASC';
    limit?: number;
    offset?: number;
  } = {},
): StoredBookmark[] {
  const {
    accountId = 'default',
    unreadOnly = false,
    revisitOnly = false,
    tag,
    folder,
    priority,
    author,
    searchQuery,
    sortBy = 'bookmarked_at',
    sortOrder = 'DESC',
    limit = 20,
    offset = 0,
  } = options;

  const conditions: string[] = ['1=1'];
  const values: unknown[] = [];

  conditions.push('b.account_id = ?');
  values.push(accountId);

  if (unreadOnly) {
    conditions.push('b.is_read = 0');
  }
  if (revisitOnly) {
    conditions.push('b.is_revisit = 1');
  }
  if (tag) {
    conditions.push('(b.tags = ? OR b.tags LIKE ? OR b.tags LIKE ? OR b.tags LIKE ?)');
    values.push(tag, `${tag},%`, `%,${tag}`, `%,${tag},%`);
  }
  if (folder) {
    conditions.push('b.folder_name = ?');
    values.push(folder);
  }
  if (priority) {
    conditions.push('b.priority = ?');
    values.push(priority);
  }
  if (author) {
    conditions.push('p.username LIKE ?');
    values.push(`${author.replace(AT_PREFIX_REGEX, '')}%`);
  }
  if (searchQuery) {
    conditions.push('t.text LIKE ?');
    values.push(`%${searchQuery}%`);
  }

  const validSortColumns: Record<string, string> = {
    bookmarked_at: 'b.bookmarked_at',
    priority:
      "CASE b.priority WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'normal' THEN 2 WHEN 'low' THEN 1 ELSE 0 END",
    tweet_created_at: 't.created_at',
  };
  const sortCol = validSortColumns[sortBy] ?? 'b.bookmarked_at';
  const order = sortOrder === 'ASC' ? 'ASC' : 'DESC';

  const sql = `
    SELECT b.tweet_id, b.account_id, b.bookmarked_at, b.note, b.tags, b.folder_name,
           b.is_read, b.is_revisit, b.priority,
           t.text as tweet_text, t.created_at as tweet_created_at,
           p.username as author_username, p.name as author_name
    FROM bookmarks b
    JOIN tweets t ON b.tweet_id = t.id
    JOIN profiles p ON t.author_id = p.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY ${sortCol} ${order}
    LIMIT ? OFFSET ?
  `;

  return db.prepare(sql).all(...values, limit, offset) as StoredBookmark[];
}

/** Get all distinct tags used on bookmarks. */
export function listBookmarkTags(db: Database.Database, accountId = 'default'): string[] {
  const rows = db
    .prepare(`
    SELECT DISTINCT tags FROM bookmarks WHERE account_id = ? AND tags != ''
  `)
    .all(accountId) as Array<{ tags: string }>;
  const tagSet = new Set<string>();
  for (const row of rows) {
    for (const tag of row.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)) {
      tagSet.add(tag);
    }
  }
  return [...tagSet].sort();
}

/** Get all distinct folder names used on bookmarks. */
export function listBookmarkFolders(db: Database.Database, accountId = 'default'): string[] {
  const rows = db
    .prepare(`
    SELECT DISTINCT folder_name FROM bookmarks WHERE account_id = ? AND folder_name != ''
  `)
    .all(accountId) as Array<{ folder_name: string }>;
  return rows.map((r) => r.folder_name).sort();
}

/** Get bookmark counts by priority. */
export function getBookmarkPriorityCounts(
  db: Database.Database,
  accountId = 'default',
): { total: number; critical: number; high: number; normal: number; low: number; unread: number; revisit: number } {
  const all = (db.prepare('SELECT COUNT(*) as c FROM bookmarks WHERE account_id = ?').get(accountId) as { c: number })
    .c;
  const critical = (
    db.prepare("SELECT COUNT(*) as c FROM bookmarks WHERE account_id = ? AND priority = 'critical'").get(accountId) as {
      c: number;
    }
  ).c;
  const high = (
    db.prepare("SELECT COUNT(*) as c FROM bookmarks WHERE account_id = ? AND priority = 'high'").get(accountId) as {
      c: number;
    }
  ).c;
  const normal = (
    db.prepare("SELECT COUNT(*) as c FROM bookmarks WHERE account_id = ? AND priority = 'normal'").get(accountId) as {
      c: number;
    }
  ).c;
  const low = (
    db.prepare("SELECT COUNT(*) as c FROM bookmarks WHERE account_id = ? AND priority = 'low'").get(accountId) as {
      c: number;
    }
  ).c;
  const unread = (
    db.prepare('SELECT COUNT(*) as c FROM bookmarks WHERE account_id = ? AND is_read = 0').get(accountId) as {
      c: number;
    }
  ).c;
  const revisit = (
    db.prepare('SELECT COUNT(*) as c FROM bookmarks WHERE account_id = ? AND is_revisit = 1').get(accountId) as {
      c: number;
    }
  ).c;
  return { total: all, critical, high, normal, low, unread, revisit };
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export function getCacheStats(db: Database.Database): {
  tweets: number;
  profiles: number;
  bookmarks: number;
  likes: number;
  blocks: number;
  mutes: number;
  aiScores: number;
} {
  const tweets = (db.prepare('SELECT COUNT(*) as c FROM tweets').get() as { c: number }).c;
  const profiles = (db.prepare('SELECT COUNT(*) as c FROM profiles').get() as { c: number }).c;
  const bookmarks = (db.prepare('SELECT COUNT(*) as c FROM bookmarks').get() as { c: number }).c;
  const likes = (db.prepare('SELECT COUNT(*) as c FROM likes').get() as { c: number }).c;
  const blocks = (db.prepare('SELECT COUNT(*) as c FROM blocks').get() as { c: number }).c;
  const mutes = (db.prepare('SELECT COUNT(*) as c FROM mutes').get() as { c: number }).c;
  const aiScores = (db.prepare('SELECT COUNT(*) as c FROM ai_scores').get() as { c: number }).c;
  return { tweets, profiles, bookmarks, likes, blocks, mutes, aiScores };
}
