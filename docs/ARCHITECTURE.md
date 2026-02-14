# peep Architecture

This document explains how peep works internally to interact with X/Twitter's undocumented GraphQL API.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        CLI Layer                             │
│  src/cli.ts → program.ts → commands/*.ts                    │
│  (Commander.js, arg parsing, output formatting)             │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                   TwitterClient (src/lib/)                   │
│  Modular mixin-based class with capability groups:          │
│  - twitter-client-tweet-detail.ts (read/replies/thread)     │
│  - twitter-client-search.ts (search/mentions)               │
│  - twitter-client-bookmarks.ts (bookmarks)                  │
│  - twitter-client-posting.ts (tweet/reply)                  │
│  - twitter-client-news.ts (trending/news)                   │
│  - ...etc (follow, lists, home, media, users)               │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                  Authentication Layer                        │
│  cookies.ts + @steipete/sweet-cookie                        │
│  Resolves: CLI args → env vars → browser cookies            │
│  (Safari, Chrome, Firefox)                                  │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                  GraphQL API Layer                           │
│  runtime-query-ids.ts (dynamic query ID discovery)          │
│  - Scrapes x.com JS bundles to find operation→queryId maps  │
│  - Caches to ~/.config/peep/query-ids-cache.json (24h TTL)  │
│  - Auto-refreshes on 404 errors                             │
└─────────────────────────────────────────────────────────────┘
```

## Key Components

### 1. CLI Entry (`src/cli.ts` → `src/cli/program.ts`)

- Uses Commander.js for argument parsing
- Registers all commands from `src/commands/`
- Handles global options (--auth-token, --cookie-source, --json, etc.)

### 2. TwitterClient (Mixin Architecture)

The TwitterClient is built using TypeScript mixins for modularity:

```typescript
// src/lib/twitter-client.ts
const MixedTwitterClient = withNews(
  withUserTweets(
    withUserLookup(
      withUsers(
        withLists(...withTweetDetails(...withPosting(...withEngagement(...))))
      )
    )
  )
);

export class TwitterClient extends MixedTwitterClient {}
```

- Base class (`twitter-client-base.ts`) handles HTTP headers, auth, timeouts
- Each mixin adds a capability domain (bookmarks, posting, search, etc.)
- Keeps code modular while presenting a unified client API

### 3. Authentication (`cookies.ts`)

Cookie-based authentication that reuses your browser session:

```typescript
// Priority order for credential resolution:
1. CLI flags: --auth-token, --ct0
2. Environment variables: AUTH_TOKEN, CT0
3. Browser cookies via @steipete/sweet-cookie
```

Browser cookie sources:
- **Safari**: `~/Library/Cookies/Cookies.binarycookies` (encrypted, requires keychain)
- **Chrome**: `~/Library/Application Support/Google/Chrome/<Profile>/Cookies` (SQLite, encrypted)
- **Firefox**: `~/Library/Application Support/Firefox/Profiles/<profile>/cookies.sqlite`

### 4. GraphQL Query IDs (`runtime-query-ids.ts`)

X's GraphQL endpoints require rotating "query IDs" that change frequently. See the [Query ID Discovery](#query-id-discovery) section below for details.

---

## The Sophisticated Parts

What makes peep actually work against X's undocumented, hostile API:

### 1. Rotating Query ID Discovery

X's GraphQL endpoints require a "query ID" that changes frequently. These IDs are baked into X's frontend JS bundles:

```typescript
// X's API URL pattern:
https://x.com/i/api/graphql/{queryId}/TweetDetail

// queryId rotates, e.g.:
// 97JF30KziU00483E_8elBA → TweetDetail
// BOD2Gi-Kdq4xQ0RjG9WUdA → SearchTimeline
```

**How peep solves it:**

1. Scrapes x.com HTML pages to find `<script src="...client-web-*.js">` bundle URLs
2. Downloads multiple JS bundles concurrently
3. Uses regex patterns to extract `{queryId, operationName}` pairs:

   ```typescript
   // From runtime-query-ids.ts
   const OPERATION_PATTERNS = [
     { regex: /e\.exports=\{queryId\s*:\s*["']([^"']+)["']\s*,\s*operationName\s*:\s*["']([^"']+)["']/gs },
     { regex: /e\.exports=\{operationName\s*:\s*["']([^"']+)["']\s*,\s*queryId\s*:\s*["']([^"']+)["']/gs },
     // ... more patterns
   ];
   ```

4. Caches to `~/.config/peep/query-ids-cache.json` with 24h TTL
5. On 404 error, auto-refreshes and retries

### 2. Massive Feature Flags

Every GraphQL request requires ~50+ feature flags that X's frontend sends. Wrong flags = broken response:

```typescript
// Example from twitter-client-features.ts
{
  responsive_web_graphql_timeline_navigation_enabled: true,
  longform_notetweets_consumption_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  articles_preview_enabled: true,
  // ... 50+ more flags
}
```

Different endpoints need different flag sets. peep has dedicated builders:
- `buildTweetDetailFeatures()` - for reading tweets
- `buildSearchFeatures()` - for search
- `buildTweetCreateFeatures()` - for posting
- `buildTimelineFeatures()` - for timelines
- `buildBookmarksFeatures()` - for bookmarks
- etc.

### 3. Browser-Like Request Headers

X detects bots via header fingerprinting. peep replicates browser headers exactly:

```typescript
// From twitter-client-base.ts
protected getBaseHeaders(): Record<string, string> {
  return {
    authorization: 'Bearer AAAAAAAAAAAAAAAAAAAAANRILg...',  // Public bearer token
    'x-csrf-token': this.ct0,
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-active-user': 'yes',
    'x-twitter-client-language': 'en',
    'x-client-uuid': this.clientUuid,              // Unique per session
    'x-twitter-client-deviceid': this.clientDeviceId,
    'x-client-transaction-id': this.createTransactionId(),  // Per-request!    cookie: this.cookieHeader,
    'user-agent': this.userAgent,
    origin: 'https://x.com',
    referer: 'https://x.com/',
  };
}

protected createTransactionId(): string {
  return randomBytes(16).toString('hex');
}
```

The `x-client-transaction-id` must be unique per request or X rejects it.

### 4. Cookie Extraction from Browsers

No API keys required - peep extracts cookies from your logged-in browser session:

- Uses `@steipete/sweet-cookie` package
- Requires OS keychain access on macOS to decrypt cookies
- Falls back through multiple browser sources

### 5. Fallback Chain for Query IDs

When the primary query ID fails, peep tries multiple fallbacks:

```typescript
// From twitter-client-base.ts
protected async getTweetDetailQueryIds(): Promise<string[]> {
  const primary = await this.getQueryId('TweetDetail');
  return Array.from(new Set([
    primary,
    '97JF30KziU00483E_8elBA',  // known fallback
    'aFvUsJm2c-oDkJV75blV6g'   // another fallback
  ]));
}
```

### 6. Draft.js Content State Parser

X Articles use Draft.js format with blocks and entities. peep renders this to readable text:

```typescript
// Raw Draft.js from API:
{
  blocks: [
    { type: 'header-one', text: 'Title' },
    { type: 'unordered-list-item', text: 'Item' }
  ],
  entityMap: [...]
}

// Rendered output by renderContentState():
// # Title
//
// - Item
```

The parser handles:
- Headers (h1, h2, h3)
- Lists (ordered, unordered)
- Blockquotes
- Code blocks (MARKDOWN entities)
- Embedded tweets
- Links
- Dividers

### 7. 404 Auto-Recovery Pattern

```typescript
// From twitter-client-base.ts
protected async withRefreshedQueryIdsOn404<T extends { success: boolean; had404?: boolean }>(
  attempt: () => Promise<T>,
): Promise<{ result: T; refreshed: boolean }> {
  const firstAttempt = await attempt();
  if (firstAttempt.success || !firstAttempt.had404) {
    return { result: firstAttempt, refreshed: false };
  }

  await this.refreshQueryIds();  // Scrape new IDs from x.com
  const secondAttempt = await attempt();
  return { result: secondAttempt, refreshed: true };
}
```

### 8. Deep Response Unwrapping

X's GraphQL responses are deeply nested with various wrapper types:

```typescript
// Actual response structure from API:
result.tweet_results.result.tweet.core.user_results.result.legacy.screen_name
result.quoted_status_result.result.tweet.rest_id
result.article.article_results.result.content_state

// peep unwraps all these layers:
function unwrapTweetResult(result: GraphqlTweetResult): GraphqlTweetResult | undefined {
  if (!result) return undefined;
  if (result.tweet) return result.tweet;  // unwrap one level
  return result;
}
```

---

## Request Flow Example

Here's what happens when you run `peep read 123456789`:

```
peep read 123456789│
    ↓
┌─────────────────────────────────────────┐
│ commands/read.ts                         │
│ - Parse args, resolve credentials       │
│ - Create TwitterClient                   │
└────────────────┬────────────────────────┘↓
┌─────────────────────────────────────────┐
│ TwitterClient.getTweet(tweetId)          │
│ - twitter-client-tweet-detail.ts        │
└────────────────┬────────────────────────┘↓
┌─────────────────────────────────────────┐
│ fetchTweetDetail()                       │
│ - Build variables, features, fieldToggles│
│ - Get query IDs (with fallbacks)        │
│ - Make HTTP request                      │
└────────────────┬────────────────────────┘↓
┌─────────────────────────────────────────┐
│ GET https://x.com/i/api/graphql/{id}/TweetDetail
│ Headers: auth_token, ct0, x-csrf-token, │
│          x-client-transaction-id, etc.  │
└────────────────┬────────────────────────┘↓
┌─────────────────────────────────────────┐
│ Response Processing                      │
│ - Parse JSON                             │
│ - Unwrap nested structures              │
│ - mapTweetResult() → TweetData          │
│ - Extract article/note text if present  │
└────────────────┬────────────────────────┘↓
┌─────────────────────────────────────────┐
│ Output                                   │
│ - Format for terminal (with colors)     │
│ - Or output JSON if --json flag         │
└─────────────────────────────────────────┘
```

---

## File Structure

```
src/
├── cli.ts                    # Entry point
├── index.ts                  # Library exports
├── cli/
│   ├── program.ts            # Commander.js setup, command registration
│   ├── shared.ts             # CLI context, credential resolution
│   └── pagination.ts         # Pagination flag parsing
├── commands/
│   ├── read.ts               # read, replies, thread commands
│   ├── search.ts             # search, mentions commands
│   ├── post.ts               # tweet, reply commands
│   ├── bookmarks.ts          # bookmarks command
│   ├── news.ts               # news/trending commands
│   └── ...                   # other commands
└── lib/
    ├── twitter-client.ts     # Main client (mixin composition)
    ├── twitter-client-base.ts# Base class with HTTP/auth
    ├── twitter-client-*.ts   # Mixin modules for each domain
    ├── cookies.ts            # Browser cookie extraction
    ├── runtime-query-ids.ts  # Dynamic query ID discovery
    ├── runtime-features.ts   # Feature flag overrides
    ├── twitter-client-features.ts    # Feature flag builders
    ├── twitter-client-constants.ts   # API URLs, query IDs
    ├── twitter-client-types.ts       # TypeScript types
    └── twitter-client-utils.ts       # Response parsing, Draft.js renderer
```

---

## Summary

The sophistication isn't in any single technique - it's the combination of:

1. **Reverse-engineering** X's undocumented GraphQL schema
2. **Mimicking** browser requests exactly (headers, IDs, cookies)
3. **Self-healing** when query IDs rotate (runtime discovery)
4. **Parsing** complex nested responses (Draft.js, wrapped types)
5. **Extracting** cookies from encrypted browser storage

All of these must work together, or nothing works. X's API is intentionally hostile to automation, and peep navigates this by faithfully replicating what the official web client does.
