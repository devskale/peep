/**
 * Twitter/X archive import for peep.
 *
 * Parses the official Twitter/X data export zip and imports tweets, likes,
 * bookmarks, profiles, and DMs into the local SQLite cache.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type Database from 'better-sqlite3';
import { storeTweet, storeUser } from './local-cache.js';
import type { TweetData } from './twitter-client-types.js';

const execFileAsync = promisify(execFile);

const ARCHIVE_NAME_PATTERNS = [/^twitter-.*\.zip$/i, /^x-.*\.zip$/i, /archive.*\.zip$/i];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ArchiveTweet {
  tweetId: string;
  fullText: string;
  createdAt: string;
  inReplyToTweetId: string | null;
  inReplyToUserId: string | null;
  conversationId: string | null;
  replyCount: number;
  retweetCount: number;
  likeCount: number;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
}

interface ArchiveLike {
  tweetId: string;
  fullText: string;
  createdAt: string;
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
}

interface ArchiveFollower {
  userId: string;
  username: string;
  displayName: string;
}

export interface ArchiveImportResult {
  ok: true;
  tweets: number;
  likes: number;
  followers: number;
  following: number;
  profiles: number;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const ARCHIVE_JSON_PAYLOAD = /=\s*(\[[\s\S]*\]|\{[\s\S]*\})/s;

function extractArchiveJson(content: string): unknown {
  const match = ARCHIVE_JSON_PAYLOAD.exec(content);
  if (!match) {
    return [];
  }
  try {
    return JSON.parse(match[1]);
  } catch {
    return [];
  }
}

function parseArchiveArray(content: string): Record<string, unknown>[] {
  const parsed = extractArchiveJson(content);
  return Array.isArray(parsed) ? parsed.filter((item): item is Record<string, unknown> => Boolean(item)) : [];
}

function parseTweet(row: Record<string, unknown>): ArchiveTweet | null {
  const tweet = row.tweet as Record<string, unknown> | undefined;
  if (!tweet) {
    return null;
  }

  const id = tweet.id_str as string | undefined;
  const fullText = tweet.full_text as string | undefined;
  if (!id || !fullText) {
    return null;
  }

  const user = row.user as Record<string, unknown> | undefined;
  const inReply = tweet.in_reply_to_status_id_str as string | undefined;
  const inReplyUser = tweet.in_reply_to_user_id_str as string | undefined;
  const convId = (tweet.conversation_id_str as string | undefined) ?? id;

  return {
    tweetId: id,
    fullText,
    createdAt: (tweet.created_at as string) ?? '',
    inReplyToTweetId: inReply ?? null,
    inReplyToUserId: inReplyUser ?? null,
    conversationId: convId,
    replyCount: Number(tweet.reply_count ?? 0),
    retweetCount: Number(tweet.retweet_count ?? 0),
    likeCount: Number(tweet.favorite_count ?? 0),
    authorId: (user?.id_str as string) ?? '',
    authorUsername: (user?.screen_name as string) ?? '',
    authorDisplayName: (user?.name as string) ?? '',
  };
}

function parseLike(row: Record<string, unknown>): ArchiveLike | null {
  const tweetId = row.tweetId as string | undefined;
  const fullText = row.fullText as string | undefined;
  if (!tweetId) {
    return null;
  }

  const _expanded = row.expandedUrl as string | undefined;
  const user = row.user as Record<string, unknown> | undefined;

  return {
    tweetId,
    fullText: fullText ?? '',
    createdAt: (row.date as string) ?? '',
    authorId: (user?.id_str as string) ?? '',
    authorUsername: (user?.screen_name as string) ?? '',
    authorDisplayName: (user?.name as string) ?? '',
  };
}

function parseFollower(row: Record<string, unknown>): ArchiveFollower | null {
  const userId = row.userId as string | undefined;
  const username = row.userName as string | undefined;
  if (!userId || !username) {
    return null;
  }

  return {
    userId,
    username,
    displayName: (row.titleName as string) ?? '',
  };
}

// ---------------------------------------------------------------------------
// Archive file discovery
// ---------------------------------------------------------------------------

export async function findArchives(): Promise<Array<{ path: string; size: number }>> {
  const { exec } = await import('node:child_process');
  const { promisify: p } = await import('node:util');
  const execAsync = p(exec);
  const candidates: Map<string, { path: string; size: number }> = new Map();

  // Try common download locations
  const { readdirSync, statSync } = await import('node:fs');

  const dirs = [`${process.env.HOME ?? '/tmp'}/Downloads`];

  for (const dir of dirs) {
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        if (ARCHIVE_NAME_PATTERNS.some((pat) => pat.test(entry))) {
          const fullPath = `${dir}/${entry}`;
          try {
            const stat = statSync(fullPath);
            if (stat.isFile() && stat.size > 1024 * 1024) {
              candidates.set(fullPath, { path: fullPath, size: stat.size });
            }
          } catch {
            // skip
          }
        }
      }
    } catch {
      // skip
    }
  }

  // Try Spotlight on macOS
  if (process.platform === 'darwin') {
    const queries = ['kMDItemDisplayName == "twitter-*.zip"', 'kMDItemDisplayName == "x-*.zip"'];
    for (const query of queries) {
      try {
        const { stdout } = await execAsync(`mdfind -onlyin ~ '${query}'`, { timeout: 5000 });
        for (const p of stdout.split('\n').filter(Boolean)) {
          if (!candidates.has(p)) {
            try {
              const stat = statSync(p);
              if (stat.isFile() && stat.size > 1024 * 1024) {
                candidates.set(p, { path: p, size: stat.size });
              }
            } catch {
              // skip
            }
          }
        }
      } catch {
        // best-effort
      }
    }
  }

  return [...candidates.values()];
}

// ---------------------------------------------------------------------------
// Import pipeline
// ---------------------------------------------------------------------------

function readJsFileFromArchive(archivePath: string, relativePath: string): Promise<string> {
  return execFileAsync('unzip', ['-p', archivePath, relativePath], { maxBuffer: 512 * 1024 * 1024 }).then(
    (r) => r.stdout,
  );
}

function fileExistsInArchive(archivePath: string, relativePath: string): Promise<boolean> {
  return execFileAsync('unzip', ['-l', archivePath, relativePath], { maxBuffer: 1024 * 1024 })
    .then(() => true)
    .catch(() => false);
}

export async function importArchive(db: Database.Database, archivePath: string): Promise<ArchiveImportResult> {
  let tweetCount = 0;
  let likeCount = 0;
  let followerCount = 0;
  let followingCount = 0;
  const profileIds = new Set<string>();

  const importTweets = async (path: string) => {
    if (!(await fileExistsInArchive(archivePath, path))) {
      return;
    }
    const content = await readJsFileFromArchive(archivePath, path);
    const rows = parseArchiveArray(content);
    const tx = db.transaction(() => {
      for (const row of rows) {
        const parsed = parseTweet(row);
        if (!parsed) {
          continue;
        }

        // Store profile
        storeUser(db, {
          id: parsed.authorId,
          username: parsed.authorUsername,
          name: parsed.authorDisplayName,
        });
        profileIds.add(parsed.authorId);

        // Store tweet
        const tweet: TweetData = {
          id: parsed.tweetId,
          text: parsed.fullText,
          author: { username: parsed.authorUsername, name: parsed.authorDisplayName },
          authorId: parsed.authorId,
          createdAt: parsed.createdAt,
          replyCount: parsed.replyCount,
          retweetCount: parsed.retweetCount,
          likeCount: parsed.likeCount,
          conversationId: parsed.conversationId ?? undefined,
          inReplyToStatusId: parsed.inReplyToTweetId ?? undefined,
        };
        storeTweet(db, tweet, 'archive');
        tweetCount++;
      }
    });
    tx();
  };

  const importLikes = async (path: string) => {
    if (!(await fileExistsInArchive(archivePath, path))) {
      return;
    }
    const content = await readJsFileFromArchive(archivePath, path);
    const rows = parseArchiveArray(content);
    const tx = db.transaction(() => {
      for (const row of rows) {
        const parsed = parseLike(row);
        if (!parsed) {
          continue;
        }

        storeUser(db, {
          id: parsed.authorId,
          username: parsed.authorUsername,
          name: parsed.authorDisplayName,
        });
        profileIds.add(parsed.authorId);

        const tweet: TweetData = {
          id: parsed.tweetId,
          text: parsed.fullText,
          author: { username: parsed.authorUsername, name: parsed.authorDisplayName },
          authorId: parsed.authorId,
          createdAt: parsed.createdAt,
        };
        storeTweet(db, tweet, 'archive');

        // Record as liked
        db.prepare('INSERT OR IGNORE INTO likes (account_id, tweet_id) VALUES (?, ?)').run('default', parsed.tweetId);
        likeCount++;
      }
    });
    tx();
  };

  const importFollowers = async (path: string, isFollowing: boolean) => {
    if (!(await fileExistsInArchive(archivePath, path))) {
      return;
    }
    const content = await readJsFileFromArchive(archivePath, path);
    const rows = parseArchiveArray(content);
    const tx = db.transaction(() => {
      for (const row of rows) {
        const parsed = parseFollower(row);
        if (!parsed) {
          continue;
        }

        storeUser(db, {
          id: parsed.userId,
          username: parsed.username,
          name: parsed.displayName,
        });
        profileIds.add(parsed.userId);

        if (isFollowing) {
          followingCount++;
        } else {
          followerCount++;
        }
      }
    });
    tx();
  };

  // Import tweets (both your tweets and the timeline)
  await importTweets('data/tweets.js');
  await importLikes('data/like.js');
  await importFollowers('data/follower.js', false);
  await importFollowers('data/following.js', true);

  return {
    ok: true,
    tweets: tweetCount,
    likes: likeCount,
    followers: followerCount,
    following: followingCount,
    profiles: profileIds.size,
  };
}
