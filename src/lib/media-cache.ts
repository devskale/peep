/**
 * Media caching for peep starred bookmarks.
 *
 * Downloads image media from starred bookmarks to a local directory
 * with a FIFO eviction policy capped at a configurable max size (default 100MB).
 * Videos are intentionally excluded.
 *
 * Storage layout:
 *   ~/.peep/media/             — media root
 *     metadata.db              — SQLite DB tracking files, sizes, eviction order
 *     <tweet_id>/              — one dir per tweet
 *       <media_index>.jpg|png  — cached image files
 *
 * FIFO eviction: when total size exceeds the cap, oldest files (by first
 * cached_at) are deleted until we're under budget.
 */

import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { isCacheAvailable } from './local-cache.js';

// ---------------------------------------------------------------------------
// Lazy native module loading
// ---------------------------------------------------------------------------

const _nativeRequire = createRequire(import.meta.url);
const _BetterSqlite3: ((path: string) => Database.Database) | null = null;

function ensureMediaLoaded(): (path: string) => Database.Database {
  if (_BetterSqlite3) {
    return _BetterSqlite3;
  }
  if (!isCacheAvailable()) {
    throw new Error('Media cache requires better-sqlite3. Run: pnpm install');
  }
  return _BetterSqlite3 as unknown as (path: string) => Database.Database;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_MAX_CACHE_BYTES = 100 * 1024 * 1024; // 100 MB

function getMediaDir(): string {
  const dir = process.env.PEEP_CACHE_DIR ?? join(homedir(), '.peep');
  return join(dir, 'media');
}

function getMaxCacheBytes(): number {
  const env = process.env.PEEP_MEDIA_CACHE_MAX_MB;
  if (env) {
    const mb = Number.parseFloat(env);
    if (Number.isFinite(mb) && mb > 0) {
      return Math.round(mb * 1024 * 1024);
    }
  }
  return DEFAULT_MAX_CACHE_BYTES;
}

// ---------------------------------------------------------------------------
// Media DB (separate from main cache.db for simplicity)
// ---------------------------------------------------------------------------

let mediaDbInstance: Database.Database | null = null;

function getMediaDb(): Database.Database {
  if (mediaDbInstance) {
    return mediaDbInstance;
  }

  const mediaDir = getMediaDir();
  if (!existsSync(mediaDir)) {
    mkdirSync(mediaDir, { recursive: true });
  }

  const dbPath = join(mediaDir, 'metadata.db');
  const BetterSqlite3 = ensureMediaLoaded();
  const db = BetterSqlite3(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS media_files (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      tweet_id    TEXT NOT NULL,
      media_index INTEGER NOT NULL,
      original_url TEXT NOT NULL,
      file_path   TEXT NOT NULL,
      file_size   INTEGER NOT NULL,
      mime_type   TEXT NOT NULL DEFAULT 'image/jpeg',
      cached_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_media_tweet ON media_files(tweet_id);
    CREATE INDEX IF NOT EXISTS idx_media_eviction ON media_files(cached_at ASC);
  `);

  mediaDbInstance = db;
  return db;
}

export function closeMediaDb(): void {
  if (mediaDbInstance) {
    mediaDbInstance.close();
    mediaDbInstance = null;
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CachedMedia {
  id: number;
  tweetId: string;
  mediaIndex: number;
  originalUrl: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  cachedAt: string;
}

export interface MediaCacheStats {
  totalFiles: number;
  totalBytes: number;
  maxBytes: number;
  usedPercent: number;
  tweetsWithMedia: number;
}

export interface DownloadResult {
  tweetId: string;
  mediaIndex: number;
  originalUrl: string;
  filePath: string;
  fileSize: number;
  success: boolean;
  error?: string;
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/** Get total cached size in bytes. */
function getTotalSize(db: Database.Database): number {
  const row = db.prepare('SELECT COALESCE(SUM(file_size), 0) as total FROM media_files').get() as {
    total: number;
  };
  return row.total;
}

/**
 * Evict oldest files (FIFO) until total size is under budget.
 * Returns number of files evicted.
 */
function evictIfNeeded(db: Database.Database, maxBytes: number): number {
  let total = getTotalSize(db);
  let evicted = 0;

  while (total > maxBytes) {
    const oldest = db
      .prepare('SELECT id, file_path, file_size FROM media_files ORDER BY cached_at ASC LIMIT 1')
      .get() as { id: number; file_path: string; file_size: number } | undefined;

    if (!oldest) {
      break;
    }

    // Delete the file
    try {
      if (existsSync(oldest.file_path)) {
        rmSync(oldest.file_path);
      }
    } catch {
      // File may already be gone — continue eviction
    }

    // Delete the row
    db.prepare('DELETE FROM media_files WHERE id = ?').run(oldest.id);

    total -= oldest.file_size;
    evicted++;
  }

  return evicted;
}

/**
 * Derive a file extension from the URL or content-type.
 */
function getExtension(url: string, contentType = ''): string {
  // Check content-type first
  if (contentType.includes('png')) {
    return 'png';
  }
  if (contentType.includes('webp')) {
    return 'webp';
  }
  if (contentType.includes('gif')) {
    return 'gif';
  }

  // Fall back to URL path
  try {
    const pathname = new URL(url).pathname;
    if (pathname.endsWith('.png')) {
      return 'png';
    }
    if (pathname.endsWith('.webp')) {
      return 'webp';
    }
    if (pathname.endsWith('.gif')) {
      return 'gif';
    }
  } catch {
    // Not a valid URL
  }

  // Default to jpg (Twitter's most common format)
  return 'jpg';
}

/**
 * Download a single image with authentication headers.
 */
async function downloadImage(
  url: string,
  destPath: string,
  cookieHeader: string,
): Promise<{ size: number; mimeType: string }> {
  const response = await fetch(url, {
    headers: {
      cookie: cookieHeader,
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      referer: 'https://x.com/',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Ensure parent dir exists
  const parentDir = join(destPath, '..');
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  writeFileSync(destPath, buffer);

  return {
    size: buffer.length,
    mimeType: contentType.split(';')[0]?.trim() ?? 'image/jpeg',
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Download images for a single starred tweet.
 * Skips videos and animated_gifs (images only).
 * Respects FIFO eviction — may evict older files to stay under cap.
 */
export async function cacheStarredMedia(
  tweetId: string,
  media: Array<{ type: string; url: string }>,
  cookieHeader: string,
): Promise<DownloadResult[]> {
  const db = getMediaDb();
  const maxBytes = getMaxCacheBytes();
  const mediaDir = getMediaDir();
  const results: DownloadResult[] = [];

  // Filter to images only
  const imageMedia = media.filter((m) => m.type === 'photo' && m.url).map((m, idx) => ({ ...m, originalIndex: idx }));

  if (imageMedia.length === 0) {
    return results;
  }

  const tweetDir = join(mediaDir, tweetId);
  if (!existsSync(tweetDir)) {
    mkdirSync(tweetDir, { recursive: true });
  }

  for (const m of imageMedia) {
    // Skip if already cached
    const existing = db
      .prepare('SELECT id, file_path FROM media_files WHERE tweet_id = ? AND media_index = ?')
      .get(tweetId, m.originalIndex) as { id: number; file_path: string } | undefined;

    if (existing && existsSync(existing.file_path)) {
      results.push({
        tweetId,
        mediaIndex: m.originalIndex,
        originalUrl: m.url,
        filePath: existing.file_path,
        fileSize: statSync(existing.file_path).size,
        success: true,
      });
      continue;
    }

    try {
      // Get the highest quality version: replace ?format=...&name=... with ?format=jpg&name=large
      let downloadUrl = m.url;
      try {
        const parsed = new URL(downloadUrl);
        parsed.searchParams.set('format', 'jpg');
        parsed.searchParams.set('name', 'large');
        downloadUrl = parsed.toString();
      } catch {
        // Use URL as-is
      }

      const ext = getExtension(downloadUrl);
      const filePath = join(tweetDir, `${m.originalIndex}.${ext}`);

      const { size, mimeType } = await downloadImage(downloadUrl, filePath, cookieHeader);

      // Insert into DB (delete old entry first if exists)
      db.prepare('DELETE FROM media_files WHERE tweet_id = ? AND media_index = ?').run(tweetId, m.originalIndex);
      db.prepare(
        `INSERT INTO media_files (tweet_id, media_index, original_url, file_path, file_size, mime_type)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(tweetId, m.originalIndex, m.url, filePath, size, mimeType);

      results.push({
        tweetId,
        mediaIndex: m.originalIndex,
        originalUrl: m.url,
        filePath,
        fileSize: size,
        success: true,
      });
    } catch (err) {
      results.push({
        tweetId,
        mediaIndex: m.originalIndex,
        originalUrl: m.url,
        filePath: '',
        fileSize: 0,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Evict if over budget
  const evicted = evictIfNeeded(db, maxBytes);
  if (evicted > 0) {
    // Clean up empty tweet directories after eviction
    if (existsSync(mediaDir)) {
      for (const entry of readdirSync(mediaDir)) {
        const entryPath = join(mediaDir, entry);
        try {
          if (statSync(entryPath).isDirectory()) {
            const remaining = readdirSync(entryPath);
            if (remaining.length === 0) {
              rmSync(entryPath, { recursive: true });
            }
          }
        } catch {
          // Ignore
        }
      }
    }
  }

  return results;
}

/**
 * Download images for all starred bookmarks that have image media.
 * Requires main cache DB to look up tweet media URLs.
 */
export async function cacheAllStarredMedia(
  mainDb: Database.Database,
  cookieHeader: string,
): Promise<{ downloaded: number; skipped: number; errors: number; evicted: number }> {
  const mediaDb = getMediaDb();
  const maxBytes = getMaxCacheBytes();

  // Get all starred tweets with their media
  const rows = mainDb
    .prepare(
      `SELECT DISTINCT b.tweet_id, m.type, m.url, m.sort_order
       FROM bookmarks b
       JOIN tweet_media m ON m.tweet_id = b.tweet_id
       WHERE m.type = 'photo' AND m.url IS NOT NULL AND m.url != ''
       ORDER BY b.bookmarked_at DESC`,
    )
    .all() as Array<{ tweet_id: string; type: string; url: string; sort_order: number }>;

  // Group by tweet
  const byTweet = new Map<string, Array<{ type: string; url: string }>>();
  for (const row of rows) {
    const list = byTweet.get(row.tweet_id) ?? [];
    list.push({ type: row.type, url: row.url });
    byTweet.set(row.tweet_id, list);
  }

  let downloaded = 0;
  const skipped = 0;
  let errors = 0;

  for (const [tweetId, media] of byTweet) {
    const results = await cacheStarredMedia(tweetId, media, cookieHeader);
    for (const r of results) {
      if (r.success) {
        downloaded++;
      } else {
        errors++;
      }
    }
  }

  // Evict if needed
  const evicted = evictIfNeeded(mediaDb, maxBytes);

  return { downloaded, skipped, errors, evicted };
}

function toCachedMedia(row: Record<string, unknown>): CachedMedia {
  return {
    id: Number(row.id),
    tweetId: String(row.tweet_id),
    mediaIndex: Number(row.media_index),
    originalUrl: String(row.original_url),
    filePath: String(row.file_path),
    fileSize: Number(row.file_size),
    mimeType: String(row.mime_type),
    cachedAt: String(row.cached_at),
  };
}

/** Get all cached media files for a tweet. */
export function getCachedMediaForTweet(tweetId: string): CachedMedia[] {
  const db = getMediaDb();
  const rows = db
    .prepare('SELECT * FROM media_files WHERE tweet_id = ? ORDER BY media_index ASC')
    .all(tweetId) as Array<Record<string, unknown>>;
  return rows.map(toCachedMedia);
}

/** Get media cache statistics. */
export function getMediaCacheStats(): MediaCacheStats {
  const db = getMediaDb();
  const maxBytes = getMaxCacheBytes();

  const totalRow = db
    .prepare('SELECT COUNT(*) as files, COALESCE(SUM(file_size), 0) as bytes FROM media_files')
    .get() as { files: number; bytes: number };

  const tweetsRow = db.prepare('SELECT COUNT(DISTINCT tweet_id) as tweets FROM media_files').get() as {
    tweets: number;
  };

  return {
    totalFiles: totalRow.files,
    totalBytes: totalRow.bytes,
    maxBytes,
    usedPercent: maxBytes > 0 ? Math.round((totalRow.bytes / maxBytes) * 100) : 0,
    tweetsWithMedia: tweetsRow.tweets,
  };
}

/** Clear all cached media files and the metadata DB. */
export function clearMediaCache(): { deletedFiles: number; deletedRows: number } {
  const db = getMediaDb();
  const mediaDir = getMediaDir();

  const countRow = db.prepare('SELECT COUNT(*) as count FROM media_files').get() as { count: number };

  // Delete all files on disk
  let deletedFiles = 0;
  if (existsSync(mediaDir)) {
    for (const entry of readdirSync(mediaDir)) {
      const entryPath = join(mediaDir, entry);
      try {
        if (statSync(entryPath).isDirectory()) {
          for (const file of readdirSync(entryPath)) {
            rmSync(join(entryPath, file));
            deletedFiles++;
          }
          rmSync(entryPath, { recursive: true });
        } else if (entry !== 'metadata.db' && entry !== 'metadata.db-wal' && entry !== 'metadata.db-shm') {
          rmSync(entryPath);
          deletedFiles++;
        }
      } catch {
        // Ignore
      }
    }
  }

  // Delete all DB rows
  db.prepare('DELETE FROM media_files').run();

  return { deletedFiles, deletedRows: countRow.count };
}

/**
 * List cached media files, optionally filtered by tweet ID.
 * Returns paths suitable for display.
 */
export function listCachedMedia(tweetId?: string): CachedMedia[] {
  const db = getMediaDb();

  if (tweetId) {
    const rows = db
      .prepare('SELECT * FROM media_files WHERE tweet_id = ? ORDER BY cached_at DESC')
      .all(tweetId) as Array<Record<string, unknown>>;
    return rows.map(toCachedMedia);
  }

  const rows = db.prepare('SELECT * FROM media_files ORDER BY cached_at DESC').all() as Array<Record<string, unknown>>;
  return rows.map(toCachedMedia);
}

/**
 * Delete cached media for a specific tweet.
 */
export function deleteCachedMediaForTweet(tweetId: string): number {
  const db = getMediaDb();
  const files = db.prepare('SELECT file_path FROM media_files WHERE tweet_id = ?').all(tweetId) as Array<{
    file_path: string;
  }>;

  for (const f of files) {
    try {
      if (existsSync(f.file_path)) {
        rmSync(f.file_path);
      }
    } catch {
      // Ignore
    }
  }

  // Clean up empty tweet directory
  const tweetDir = join(getMediaDir(), tweetId);
  try {
    if (existsSync(tweetDir) && readdirSync(tweetDir).length === 0) {
      rmSync(tweetDir, { recursive: true });
    }
  } catch {
    // Ignore
  }

  const result = db.prepare('DELETE FROM media_files WHERE tweet_id = ?').run(tweetId);
  return Number(result.changes);
}
