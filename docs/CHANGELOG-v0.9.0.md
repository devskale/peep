# peep v0.8.3 → v0.9.0 Changelog

**Branch:** `feat/birdclaw-features`  
**Commits:** `91f2afb` (feat), `238520e` (lint fixes)  
**Inspired by:** [steipete/birdclaw](https://github.com/steipete/birdclaw)  

---

## Summary

This update adds a local SQLite cache layer, first-class bookmark management with personal metadata, AI-powered inbox scoring, Twitter/X archive import, local block/mute management, profile reply inspection, and a write-gating safety mechanism. All existing commands silently populate the cache for offline search and analysis. Write commands (`tweet`, `reply`, `follow`, `unfollow`, `unbookmark`) are **disabled by default**.

**2,975 lines added across 8 new files and 21 modified files. All 434 existing tests pass.**

---

## 1. Write-Gating: Commands Disabled by Default

Write commands are now gated behind an explicit opt-in. This prevents accidental mutations and makes peep safer for read-only workflows.

### How it works

Peep checks three sources (in order) for the `allowWrite` flag:

1. **CLI flag:** `--allow-write`
2. **Environment variable:** `PEEP_ALLOW_WRITE=1` (or `true`)
3. **Config file:** `allowWrite: true` in `~/.config/peep/config.json5`

If none are set, write commands exit with an error message.

### Gated commands

| Command | What it does |
|---------|-------------|
| `peep tweet` | Post a tweet |
| `peep reply` | Reply to a tweet |
| `peep follow` | Follow a user |
| `peep unfollow` | Unfollow a user |
| `peep unbookmark` | Remove a bookmark |

### Example

```bash
# This will fail:
peep tweet "hello world"
# → Write commands are disabled by default. Use --allow-write or set PEEP_ALLOW_WRITE=1 to enable.

# This works:
peep --allow-write tweet "hello world"

# Or export once:
export PEEP_ALLOW_WRITE=1
peep tweet "hello world"
```

### Config

```json5
// ~/.config/peep/config.json5
{
  allowWrite: true
}
```

### Files changed

- `src/cli/shared.ts` — Added `resolveAllowWrite()` to `CliContext`; reads from options, env, config
- `src/commands/post.ts` — Added `resolveAllowWrite()` guard before `tweet` and `reply`
- `src/commands/follow.ts` — Added guard before `follow` and `unfollow`
- `src/commands/unbookmark.ts` — Added guard before `unbookmark`
- `tests/commands.follow.test.ts` — Added `resolveAllowWrite: () => true` to test context

---

## 2. Local SQLite Cache

A persistent SQLite database at `~/.peep/cache.db` stores tweets, profiles, bookmarks, likes, blocks, mutes, AI scores, and sync cursors. The cache enables offline search, inbox scoring, and starred bookmark management.

### Technical details

- **Engine:** `better-sqlite3` with WAL journal mode and foreign keys
- **FTS5:** Full-text search virtual tables for `tweets` and `profiles`
- **Migrations:** Automatic schema creation on first use; incremental column migrations for existing databases
- **Location:** `~/.peep/cache.db` (override with `PEEP_CACHE_DIR`)
- **Singleton:** One DB connection per process via `getDb()`

### Schema (10 tables)

| Table | Purpose |
|-------|---------|
| `profiles` | User profiles (id, username, name, description, followers, verified, etc.) |
| `tweets` | Tweet data (id, text, author, timestamps, engagement counts, source) |
| `tweet_media` | Media attachments per tweet (type, URL, dimensions, video metadata) |
| `bookmarks` | Bookmark records with personal metadata (note, tags, folder, priority, read/unread, revisit) |
| `likes` | Like records (account_id, tweet_id) |
| `blocks` | Local blocklist entries |
| `mutes` | Local mutelist entries |
| `sync_cursors` | Pagination cursor persistence for incremental sync |
| `ai_scores` | AI scoring results (score, summary, reasoning, model) |
| FTS5: `tweets_fts` | Full-text index over tweet text + author username |
| FTS5: `profiles_fts` | Full-text index over profile names and descriptions |

### Cache helpers

`src/lib/cache-helpers.ts` provides two fire-and-forget functions:

- **`cacheTweets(tweets, source?)`** — Stores tweets in a transaction. Wrapped in try/catch — never fails a live command.
- **`cacheUsers(users)`** — Stores user profiles. Same safety wrapper.

### Commands that auto-populate the cache

Every existing read command now silently caches fetched data:

| Command | What it caches |
|---------|---------------|
| `peep home` | Timeline tweets |
| `peep search` | Search results |
| `peep bookmarks` | Bookmark tweets + bookmark records |
| `peep likes` | Liked tweets |
| `peep user-tweets` | User timeline tweets |
| `peep read` | Single tweet |
| `peep mentions` | Mention tweets |
| `peep following` / `peep followers` | User profiles |
| `peep user-tweets --json` | User timeline tweets |

### Dependency

```json
{
  "dependencies": {
    "better-sqlite3": "^12.9.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.13"
  },
  "pnpm": {
    "onlyBuiltDependencies": ["better-sqlite3"]
  }
}
```

### Files

- `src/lib/local-cache.ts` (949 lines) — Complete DB layer: schema, migrations, CRUD for all tables, FTS5 search, stats
- `src/lib/cache-helpers.ts` (37 lines) — `cacheTweets()`, `cacheUsers()` wrappers
- `package.json` — Added `better-sqlite3` dependency + `onlyBuiltDependencies` config

---

## 3. First-Class Starred Bookmarks (`peep starred`)

Bookmarks are promoted from simple API results to first-class items with personal metadata: notes, tags, folders, priority levels, read/unread state, and revisit flags. This is the core feature for treating bookmarks as "issues I care about."

### How it works

When you run `peep bookmarks`, the fetched tweets are stored in the local cache and bookmark IDs are recorded in the `bookmarks` table. You can then manage metadata with the `starred` subcommands.

### Commands

```
peep starred [options]              # List bookmarks with filters and sort
peep starred note <id> <text>       # Add/edit a note
peep starred tag <id> <tags>        # Set tags (comma-separated)
peep starred priority <id> <level>  # Set priority (low/normal/high/critical)
peep starred folder <id> <name>     # Assign to a folder
peep starred revisit <id>           # Toggle revisit flag
peep starred mark-read <id>         # Mark as read
peep starred unread <id>            # Mark as unread
peep starred tags [--json]          # List all tags in use
peep starred folders [--json]       # List all folders in use
peep starred stats [--json]         # Show priority distribution
```

### Filtering and sorting

```bash
# Show only unread items
peep starred --unread

# Show only items flagged for revisiting
peep starred --revisit

# Filter by tag
peep starred --tag "bug"

# Filter by folder
peep starred --folder "work"

# Filter by priority
peep starred --priority critical

# Filter by author
peep starred --author @steipete

# Search within bookmark text
peep starred --search "typescript"

# Sort by priority (critical first)
peep starred --sort priority

# Sort chronologically by tweet date
peep starred --sort tweet_created_at

# JSON output
peep starred --json
```

### Priority levels

| Level | Icon | Meaning |
|-------|------|---------|
| `critical` | 🔴 | Must deal with now |
| `high` | 🟠 | Important, handle soon |
| `normal` | 🟢 | Standard (default) |
| `low` | ⚪ | Low priority / reference |

### Display format

```
🔴 @steipete — 2025-01-15T10:30:00Z
  Just shipped the new SQLite cache for peep. Full FTS5 search...
  https://x.com/steipete/status/1234567890
  📝 follow up with benchmark results  🏷️ ship,sqlite  🔄 revisit  📁 projects
```

### Stats output

```
Bookmark stats:
  Total:      142
  🔴 Critical: 3
  🟠 High:     12
  🟢 Normal:   98
  ⚪ Low:      29
  📩 Unread:   45
  🔄 Revisit:  8
```

### Database columns

The `bookmarks` table has these personal metadata columns:

| Column | Type | Default | Description |
|--------|------|---------|-------------|
| `note` | TEXT | `''` | Free-text note |
| `tags` | TEXT | `''` | Comma-separated tags |
| `folder_name` | TEXT | `''` | Folder assignment |
| `is_read` | INTEGER | `0` | 0 = unread, 1 = read |
| `is_revisit` | INTEGER | `0` | 0 = normal, 1 = flagged for revisit |
| `priority` | TEXT | `'normal'` | `low`, `normal`, `high`, or `critical` |

### Files

- `src/commands/starred.ts` (275 lines) — 11 subcommands with Commander.js
- `src/lib/local-cache.ts` — `StoredBookmark` type, `recordBookmark()`, `recordBookmarks()`, `setBookmarkNote()`, `setBookmarkTags()`, `setBookmarkFolder()`, `markBookmarkRead()`, `markBookmarkUnread()`, `toggleBookmarkRevisit()`, `setBookmarkPriority()`, `listStoredBookmarks()`, `listBookmarkTags()`, `listBookmarkFolders()`, `getBookmarkPriorityCounts()`
- `src/commands/bookmarks.ts` — Modified to call `cacheTweets()` and `recordBookmarks()` after fetch

---

## 4. AI Inbox (`peep inbox`)

An AI-ranked inbox that triages mentions and DMs for actionability. Inspired by birdclaw's inbox scoring system.

### How it works

1. Builds an inbox from locally cached tweets (replies/mentions)
2. Scores each item using heuristic rules or OpenAI
3. Ranks by score (0–100) for triage

### Scoring modes

**Heuristic (default, no API key needed):**
- Base score: 44
- Influence: `log10(followers + 10) × 18`, capped at 32
- Specificity boost: +8 for questions (contains `?`)
- Length boost: +4 for substantive tweets (>100 chars)
- Range: 0–100

**OpenAI (requires `OPENAI_API_KEY`):**
- Sends entity context (text, influence, participant) to GPT-4o-mini
- Returns score, 18-word summary, 28-word reasoning
- Model configurable via `PEEP_OPENAI_MODEL` (default: `gpt-4o-mini`)
- Scores are persisted in `ai_scores` table

### Commands

```bash
# Show ranked inbox (heuristic scoring)
peep inbox

# Refresh with OpenAI scoring
peep inbox --score

# Hide low-signal items (score < 40)
peep inbox --hide-low-signal

# Set minimum score threshold
peep inbox --min-score 60

# Show only mentions
peep inbox --kind mentions

# Limit results
peep inbox -n 10

# JSON output
peep inbox --json
```

### Display format

```
██████████ 82/100 [openai]
  Mention from Jane Developer
  Hey, I found a bug in your library when using it with Bun...
  @janedev · 12400 followers
  High-signal bug report from active contributor.
  2025-01-15T10:30:00Z

██████░░░░ 62/100 [heuristic]
  Mention from Alex Smith
  Just tried your tool, looks great!
  @alexsmith · 850 followers
  2025-01-15T09:00:00Z

Showing 2 items (1 AI-scored, 1 heuristic)
```

### Environment variables

| Variable | Description |
|----------|-------------|
| `OPENAI_API_KEY` | Required for AI scoring |
| `PEEP_OPENAI_MODEL` | Model name (default: `gpt-4o-mini`) |

### Files

- `src/lib/ai-inbox.ts` (268 lines) — `buildInboxFromCache()`, `scoreWithOpenAI()`, `scoreInbox()`, heuristic scoring
- `src/commands/inbox.ts` (94 lines) — CLI command with `--score`, `--hide-low-signal`, `--min-score`, `--kind` options

---

## 5. Twitter/X Archive Import (`peep archive`)

Import your official Twitter/X data export into the local cache for offline search and analysis.

### How it works

1. Locates archive zip files (Downloads folder + Spotlight on macOS)
2. Unzips specific files using the `unzip` CLI tool
3. Parses the JavaScript variable assignment format (`window.YTD.tweets.part0 = [...]`)
4. Imports tweets, likes, followers, and following into SQLite

### Archive file paths

The importer looks for these files inside the zip:

| Path | Content |
|------|---------|
| `data/tweets.js` | Your tweets and timeline |
| `data/like.js` | Your liked tweets |
| `data/follower.js` | Your followers |
| `data/following.js` | Accounts you follow |

### Commands

```bash
# Find archive files on disk
peep archive find

# Import from a specific file
peep archive import ~/Downloads/twitter-2025.zip

# JSON output
peep archive find --json
peep archive import ~/Downloads/twitter-2025.zip --json
```

### Auto-discovery

On macOS, `findArchives()` checks:
1. `~/Downloads/` for files matching `twitter-*.zip`, `x-*.zip`, or `archive*.zip` (case-insensitive, >1MB)
2. Spotlight (`mdfind`) for the same patterns anywhere in `~`

### Import output

```
Archive imported successfully!
  Tweets:      12450
  Likes:       3200
  Followers:   890
  Following:   420
  Profiles:    5600

  Cache stats: 12450 tweets, 5600 profiles
```

### Requirements

- The `unzip` CLI tool must be available (standard on macOS/Linux)

### Files

- `src/lib/archive-import.ts` (359 lines) — `findArchives()`, `importArchive()`, parsers for tweets/likes/followers
- `src/commands/archive.ts` (75 lines) — `archive find` and `archive import` subcommands

---

## 6. Block/Mute Management (`peep blocks`, `peep mutes`)

Local-first blocklist and mutelist management. Entries are stored in the local cache and can optionally resolve profiles from X's API.

### Commands

```bash
# List blocks
peep blocks

# Block a user (resolves profile via API if credentials available)
peep blocks --add @username
peep ban @username

# Unblock
peep blocks --remove @username
peep unban @username

# Import from file (handles or URLs, one per line, # comments)
peep blocks --import-file blocklist.txt

# Same for mutes
peep mutes
peep mutes --add @username
peep mute @username
peep mutes --remove @username
peep unmute @username

# JSON output
peep blocks --json
peep mutes --json
```

### Profile resolution

When credentials are available, `ban`/`mute` resolve handles to user IDs via X's API. Falls back to storing the raw handle if resolution fails. Accepts handles (`@user`), numeric IDs, or profile URLs (`https://x.com/user`).

### Import file format

```
# Comments start with #
@spammer1
@bot2
https://x.com/suspicious_account
- @markdown_bullets_work_too
```

### Files

- `src/commands/blocks.ts` (277 lines) — `blocks`, `ban`, `unban`, `mutes`, `mute`, `unmute` commands
- `src/lib/local-cache.ts` — `addBlock()`, `removeBlock()`, `listBlocks()`, `addMute()`, `removeMute()`, `listMutes()`

---

## 7. Profile Reply Inspection (`peep profile replies`)

Scans a user's recent replies for bot/AI behavior patterns. A moderation and anti-bot tool.

### Commands

```bash
# Scan recent replies
peep profile replies @username

# Control scan size
peep profile replies @username -n 20

# JSON output
peep profile replies @username --json
```

### Bot detection hints

The command computes simple heuristics:

- **Average reply length** — Very short or very uniform lengths may indicate templating
- **Unique opening phrases** — Compares first 30 characters of each reply; low diversity suggests copy-paste behavior
- **Warning** — Flags when multiple replies share similar openings

### Display format

```
Found 8 replies (scanned 24 tweets):

@someuser → reply to 1234567890123456789
  Thanks for sharing! This is really interesting...
  ❤️ 0  💬 0  2025-01-14T08:00:00Z
──────────────────────────────────────────────────

Scan summary:
  Average reply length: 42 chars
  Unique opening phrases: 3/8
  ⚠️  5 replies share similar openings — possible templated behavior.
```

### Files

- `src/commands/profile.ts` (131 lines) — `profile replies` subcommand
- `src/lib/normalize-handle.ts` — Used for handle resolution

---

## 8. Local Full-Text Search (`peep local-search`)

Search over the locally cached tweets using SQLite FTS5. Works offline and is extremely fast.

### Commands

```bash
# Search cached tweets
peep local-search "typescript"

# Filter by author
peep local-search "bug" --author @steipete

# Date range
peep local-search "release" --since 2025-01-01 --until 2025-01-31

# Limit results
peep local-search "sqlite" -n 50

# JSON output
peep local-search "api" --json
```

### FTS5 query syntax

Supports standard FTS5 operators:

```bash
# Phrase search
peep local-search '"exact phrase"'

# AND
peep local-search "typescript AND sqlite"

# OR
peep local-search "bug OR error"

# NOT
peep local-search "release -beta"
```

### Files

- `src/commands/local-search.ts` (55 lines) — CLI command
- `src/lib/local-cache.ts` — `searchLocalTweets()` with FTS5 query building

---

## 9. Cache Stats (`peep cache`)

Inspect the local cache database and see what's stored.

### Commands

```bash
peep cache

# JSON output
peep cache --json
```

### Output format

```
Local cache: /Users/you/.peep/cache.db
  Tweets:     12450
  Profiles:   5600
  Bookmarks:  142
  Likes:      3200
  Blocks:     23
  Mutes:      8
  AI Scores:  45
```

### Files

- `src/commands/cache.ts` (34 lines) — CLI command
- `src/lib/local-cache.ts` — `getCacheStats()`

---

## Architecture Decisions

### SQLite over other databases

Chosen to match birdclaw's approach. Benefits: zero-config, single-file deployment, built-in FTS5, no server process, excellent for CLI tools.

### Cache is always optional

All cache operations (`cacheTweets()`, `cacheUsers()`) are wrapped in try/catch. If the DB is unavailable, corrupted, or `better-sqlite3` fails to load, the live command still works normally. The cache is a best-effort enhancement.

### WAL journal mode

Write-Ahead Logging provides better concurrent read performance and crash recovery compared to the default rollback journal.

### Incremental migrations

The `migrateAddColumns()` function checks `PRAGMA table_info()` and adds missing columns. This means existing databases are automatically upgraded without data loss.

### Commander subcommand structure

`starred` uses a single `new Command('starred')` with `.command()` children to avoid duplicate registration errors. Same pattern for `archive` and `profile`.

### Name conflicts avoided

| Potential name | Conflict | Solution |
|---------------|----------|----------|
| `peep starred read` | Top-level `peep read` | Used `peep starred mark-read` |
| `peep profile replies` | Top-level `peep replies` | Nested as subcommand |
| `peep archive find` | Commander `.option()` prefix rule | Used `.addCommand(new Command(...))` pattern |

---

## Dependency Changes

### Added

| Package | Version | Purpose |
|---------|---------|---------|
| `better-sqlite3` | `^12.9.0` | SQLite database engine |
| `@types/better-sqlite3` | `^7.6.13` | TypeScript type definitions |

### Build config

```json
{
  "pnpm": {
    "onlyBuiltDependencies": ["better-sqlite3"]
  }
}
```

This ensures `better-sqlite3`'s native compilation runs during `pnpm install` while other packages skip it.

---

## New Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/lib/local-cache.ts` | 949 | SQLite schema, migrations, all DB operations |
| `src/lib/cache-helpers.ts` | 37 | `cacheTweets()`, `cacheUsers()` wrappers |
| `src/lib/ai-inbox.ts` | 268 | AI inbox scoring (OpenAI + heuristic) |
| `src/lib/archive-import.ts` | 359 | Archive zip parsing and import |
| `src/commands/starred.ts` | 275 | First-class bookmark management |
| `src/commands/blocks.ts` | 277 | Block/mute management |
| `src/commands/inbox.ts` | 94 | AI inbox CLI |
| `src/commands/archive.ts` | 75 | Archive import CLI |
| `src/commands/profile.ts` | 131 | Profile reply inspection |
| `src/commands/local-search.ts` | 55 | Local FTS5 search CLI |
| `src/commands/cache.ts` | 34 | Cache stats CLI |

**Total: 2,554 lines of new code.**

## Modified Files

| File | Changes |
|------|---------|
| `src/cli/shared.ts` | Added `resolveAllowWrite()` to `CliContext` |
| `src/cli/program.ts` | Registered 6 new command groups + 16 new `KNOWN_COMMANDS` |
| `src/commands/post.ts` | Write gate on `tweet` and `reply` |
| `src/commands/follow.ts` | Write gate on `follow` and `unfollow` |
| `src/commands/unbookmark.ts` | Write gate on `unbookmark` |
| `src/commands/bookmarks.ts` | Auto-cache tweets + record bookmark IDs |
| `src/commands/home.ts` | Auto-cache timeline tweets |
| `src/commands/search.ts` | Auto-cache search results |
| `src/commands/read.ts` | Auto-cache read tweets |
| `src/commands/user-tweets.ts` | Auto-cache user timeline |
| `src/commands/users.ts` | Auto-cache user profiles + liked tweets |
| `src/lib/twitter-client-lists.ts` | Biome formatting only |
| `package.json` | Added `better-sqlite3`, `@types/better-sqlite3`, `onlyBuiltDependencies` |
| `.gitignore` | Added `birdclaw-ref/` |
| `README.md` | Added write-gating disclaimer |
| `tests/cli-shared.test.ts` | Import ordering (biome) |
| `tests/commands.follow.test.ts` | Added `resolveAllowWrite` to test context |

---

## Validation

| Check | Result |
|-------|--------|
| Unit tests (434) | ✅ All pass |
| Biome lint | ✅ 0 errors, 0 warnings |
| Oxlint | ✅ 0 errors (16 pre-existing warnings in original code) |
| Build (binary) | ✅ Compiles |
| New file warnings | ✅ None |

---

## Future Work

1. **Tests for new commands** — `starred`, `blocks`, `cache`, `local-search`, `archive`, `inbox`, `profile` all need unit/integration tests
2. **`peep starred export`** — Backup/portability for bookmark metadata
3. **Sync cursor persistence** — Make `peep bookmarks --all` incremental instead of re-fetching everything
4. **DM support** — birdclaw has this; peep does not yet
5. **Multi-account cache** — The schema supports `account_id` but the CLI always uses `'default'`
6. **Media caching** — Download and cache images/videos locally like birdclaw does
7. **`peep archive import --incremental`** — Skip already-imported tweets on re-import
8. **`peep starred search`** — Combine FTS5 search with bookmark metadata filters
9. **`peep cache clear`** — Purge specific tables or the entire cache
10. **`peep cache export`** — Export cached data as JSON for backup
