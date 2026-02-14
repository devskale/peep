---
name: peep
description: X/Twitter CLI for reading, searching, posting, and engagement via cookies.
homepage: https://github.com/devskale/peep
metadata:
  {
    "clawdbot":
      {
        "emoji": "🐦",
        "requires": { "bins": ["peep"] },
        "install":
          [
            {
              "id": "pnpm",
              "kind": "node",
              "package": "@devskale/peep",
              "bins": ["peep"],
              "label": "Install peep (pnpm)",
            }
          ]
      },
  }
---

# peep 🐦

Fast X/Twitter CLI using GraphQL + cookie auth.

## Install

```bash
# pnpm/npm/bun
pnpm install -g @devskale/peep

# From source (clone and build locally)
git clone https://github.com/devskale/peep.git
cd peep
pnpm install -g .

# One-shot (no install)
bunx @devskale/peep whoami
```

## Authentication

`peep` uses cookie-based auth.

Use `--auth-token` / `--ct0` to pass cookies directly, or `--cookie-source` for browser cookies.

Run `peep check` to see which source is active. For Arc/Brave, use `--chrome-profile-dir <path>`.

## Commands

### Account & Auth

```bash
peep whoami                    # Show logged-in account
peep check                     # Show credential sources
peep query-ids --fresh         # Refresh GraphQL query ID cache
```

### Reading Tweets

```bash
peep read <url-or-id>          # Read a single tweet
peep <url-or-id>               # Shorthand for read
peep thread <url-or-id>        # Full conversation thread
peep replies <url-or-id>       # List replies to a tweet
```

### Timelines

```bash
peep home                      # Home timeline (For You)
peep home --following          # Following timeline
peep user-tweets @handle -n 20 # User's profile timeline
peep mentions                  # Tweets mentioning you
peep mentions --user @handle   # Mentions of another user
```

### Search

```bash
peep search "query" -n 10
peep search "from:devskale" --all --max-pages 3
```

### News & Trending

```bash
peep news -n 10                # AI-curated from Explore tabs
peep news --ai-only            # Filter to AI-curated only
peep news --sports             # Sports tab
peep news --with-tweets        # Include related tweets
peep trending                  # Alias for news
```

### Lists

```bash
peep lists                     # Your lists
peep lists --member-of         # Lists you're a member of
peep list-timeline <id> -n 20  # Tweets from a list
```

### Bookmarks & Likes

```bash
peep bookmarks -n 10
peep bookmarks --folder-id <id>           # Specific folder
peep bookmarks --include-parent           # Include parent tweet
peep bookmarks --author-chain             # Author's self-reply chain
peep bookmarks --full-chain-only          # Full reply chain
peep unbookmark <url-or-id>
peep likes -n 10
```

### Social Graph

```bash
peep following -n 20           # Users you follow
peep followers -n 20           # Users following you
peep following --user <id>     # Another user's following
peep about @handle             # Account origin/location info
```

### Engagement Actions

```bash
peep follow @handle            # Follow a user
peep unfollow @handle          # Unfollow a user
```

### Posting

```bash
peep tweet "hello world"
peep reply <url-or-id> "nice thread!"
peep tweet "check this out" --media image.png --alt "description"
```

**⚠️ Posting risks**: Posting is more likely to be rate limited; if blocked, use the browser tool instead.

## Media Uploads

```bash
peep tweet "hi" --media img.png --alt "description"
peep tweet "pics" --media a.jpg --media b.jpg  # Up to 4 images
peep tweet "video" --media clip.mp4            # Or 1 video
```

## Pagination

Commands supporting pagination: `replies`, `thread`, `search`, `bookmarks`, `likes`, `list-timeline`, `following`, `followers`, `user-tweets`

```bash
peep bookmarks --all                    # Fetch all pages
peep bookmarks --max-pages 3            # Limit pages
peep bookmarks --cursor <cursor>        # Resume from cursor
peep replies <id> --all --delay 1000    # Delay between pages (ms)
```

## Output Options

```bash
--json          # JSON output
--json-full     # JSON with raw API response
--plain         # No emoji, no color (script-friendly)
--no-emoji      # Disable emoji
--no-color      # Disable ANSI colors (or set NO_COLOR=1)
--quote-depth n # Max quoted tweet depth in JSON (default: 1)
```

## Global Options

```bash
--auth-token <token>       # Set auth_token cookie
--ct0 <token>              # Set ct0 cookie
--cookie-source <source>   # Cookie source for browser cookies (repeatable)
--chrome-profile <name>    # Chrome profile name
--chrome-profile-dir <path> # Chrome/Chromium profile dir or cookie DB path
--firefox-profile <name>   # Firefox profile
--timeout <ms>             # Request timeout
--cookie-timeout <ms>      # Cookie extraction timeout
```

## Config File

`~/.config/peep/config.json5` (global) or `./.peeprc.json5` (project):

```json5
{
  cookieSource: ["chrome"],
  chromeProfileDir: "/path/to/Arc/Profile",
  timeoutMs: 20000,
  quoteDepth: 1,
}
```

Environment variables: `PEEP_TIMEOUT_MS`, `PEEP_COOKIE_TIMEOUT_MS`, `PEEP_QUOTE_DEPTH`

## Troubleshooting

### Query IDs stale (404 errors)

```bash
peep query-ids --fresh
```

### Cookie extraction fails

- Check browser is logged into X
- Try different `--cookie-source`
- For Arc/Brave: use `--chrome-profile-dir`

---

**TL;DR**: Read/search/engage with CLI. Post carefully or use browser. 🐦
