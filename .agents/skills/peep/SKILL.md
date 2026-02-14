---
name: peep
description: X/Twitter CLI for reading, searching, and posting via cookie auth.
---

# peep

X/Twitter CLI for tweeting, replying, reading, searching, and managing your Twitter/X account via the GraphQL API.

## Install

```bash
git clone https://github.com/devskale/peep.git
cd peep
pnpm install
pnpm run build
```

## Quick Start

```bash
peep whoami          # Check logged-in account
peep read <url/id>   # Read a tweet
peep 1234567890      # Shorthand for read
peep home            # Home timeline
peep search "query"  # Search tweets
peep mentions        # Your mentions
peep user-tweets @x  # User's tweets
peep bookmarks       # Your bookmarks
peep tweet "hello"   # Post a tweet (confirm first!)
```

## Commands

| Command | Description |
|---------|-------------|
| `peep whoami` | Show logged-in account |
| `peep check` | Check credential availability |
| `peep read <url/id>` | Fetch a tweet |
| `peep thread <url/id>` | Full conversation thread |
| `peep replies <url/id>` | Replies to a tweet |
| `peep home` | Home timeline (For You) |
| `peep home --following` | Following feed |
| `peep search <query>` | Search tweets |
| `peep mentions` | Your mentions |
| `peep user-tweets <handle>` | User's profile timeline |
| `peep following [user]` | Who you/they follow |
| `peep followers [user]` | Who follows you/them |
| `peep likes` | Your liked tweets |
| `peep bookmarks` | Your bookmarks |
| `peep unbookmark <id...>` | Remove bookmarks |
| `peep lists` | Your Twitter lists |
| `peep list-timeline <id>` | Tweets from a list |
| `peep news` / `peep trending` | AI-curated news |
| `peep about <user>` | Account origin/location info |
| `peep tweet "text"` | Post a tweet |
| `peep reply <id> "text"` | Reply to a tweet |
| `peep follow <user>` | Follow a user |
| `peep unfollow <user>` | Unfollow a user |

## Common Options

| Flag | Description |
|------|-------------|
| `--json` | JSON output |
| `--json-full` | JSON with raw API response |
| `--plain` | Plain output (no emoji/color) |
| `--timeout <ms>` | Request timeout |
| `--quote-depth <n>` | Max quoted tweet depth |

## Pagination

Use `--all`, `--max-pages <n>`, `--cursor <string>`, `--delay <ms>` for paginated commands.

## Auth

- Browser: `--firefox-profile`, `--chrome-profile`, `--chrome-profile-dir`, `--cookie-source`
- Manual: `--auth-token`, `--ct0`

## Config & Env

- Config: `~/.config/peep/config.json5` or `./peeprc.json5`
- Env: `PEEP_TIMEOUT_MS`, `PEEP_COOKIE_TIMEOUT_MS`, `PEEP_QUOTE_DEPTH`

## Extended Docs

- [Auth Details](references/auth.md) - Cookie sources, browser profiles, manual tokens
- [Pagination](references/pagination.md) - All pagination options explained
- [Bookmarks](references/bookmarks.md) - Folder support, thread expansion options
- [News & Trending](references/news.md) - Explore tabs, filters, AI-curated content
- [Media](references/media.md) - Image/video uploads, supported formats
- [JSON Output](references/json.md) - Schema, fields, pagination format
