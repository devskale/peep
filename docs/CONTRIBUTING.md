# Contributing

## Development Setup

```bash
git clone https://github.com/devskale/peep.git
cd peep
pnpm install
pnpm run build
```

Build targets:
- `pnpm run build` — full build (dist/ + bun binary)
- `pnpm run build:dist` — dist/ only
- `pnpm run build:binary` — bun binary

Run from source:
```bash
pnpm run dev tweet "Test"
pnpm run dev -- --plain check
```

## Testing

### Unit Tests
```bash
pnpm test
```

### Live Tests (hits real X/Twitter endpoints)

Requires auth cookies set via environment:
- `AUTH_TOKEN` (or `TWITTER_AUTH_TOKEN`)
- `CT0` (or `TWITTER_CT0`)

```bash
pnpm test:live
```

Configuration:
| Variable | Default | Description |
|----------|---------|-------------|
| `PEEP_LIVE=1` | (set by test:live) | Enables live tests |
| `PEEP_LIVE_SEARCH_QUERY` | `from:steipete` | Search query for live tests |
| `PEEP_LIVE_FOLLOW_HANDLE` | — | Opt-in follow/unfollow handle |
| `PEEP_LIVE_TIMEOUT_MS` | — | Command timeout (ms) |
| `PEEP_LIVE_COOKIE_TIMEOUT_MS` | — | Cookie extraction timeout (ms) |
| `PEEP_LIVE_NODE_ENV` | `production` | Spawned CLI NODE_ENV |
| `PEEP_LIVE_TWEET_ID` | — | Known tweet ID for read/replies/thread |
| `PEEP_LIVE_LONGFORM_TWEET_ID` | — | Article tweet ID for long-form coverage |
| `PEEP_LIVE_BOOKMARK_FOLDER_ID` | — | Folder ID for bookmark folder tests |
| `PEEP_LIVE_QUERY_IDS_FRESH=1` | — | Enable query-ids --fresh live test |

### Linting
```bash
pnpm run lint
```

## Releasing

### Checklist (npm + GitHub)

1. **Version bump** — Update `package.json` `version` (semver) and `CHANGELOG.md`
2. **Build & test** — `pnpm install && pnpm test && pnpm run build`
3. **Publish to npm** — `npm publish --access public` (scoped as `@devskale/peep`)
4. **Git tag & GitHub release** — `git tag v<version> && git push origin v<version>`

### Optional: Homebrew Binary

1. Build: `pnpm run binary` (produces `./peep`)
2. Package: `tar -czf peep-macos-universal-v<version>.tar.gz peep`
3. SHA: `shasum -a 256 peep-macos-universal-v<version>.tar.gz`
4. Update formula in `devskale/homebrew-tap` with new URL/SHA/version

### Release Order

1. Merge to `main` and tag
2. Publish npm
3. Build binary, upload to GitHub release
4. Update Homebrew tap

## Architecture

See [Architecture](ARCHITECTURE.md) for internal details.

## Refactoring History

Historical refactoring writeups are archived in [history/](history/).
