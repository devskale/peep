# REFACTOR-03: Centralize Feature Flags

**Branch**: `refactor/centralize-features`
**Date**: 2026-04-10
**Status**: ✅ Complete

## Problem

`twitter-client-features.ts` contained 14 `build*Features()` functions, each
repeating 30–40 feature flags with only 2–5 differences between them. The file
was 359 lines, with massive duplication making it error-prone to update flags
across all builders.

## Solution

Extracted three layered base objects that builders spread from:

| Layer | Flags | Purpose |
|-------|-------|---------|
| `CORE_FEATURES` | 21 | Universal defaults (same value in ALL builders) |
| `STANDARD_FEATURES` | 37 | CORE + content/Grok/media cluster |
| `TIMELINE_FEATURES` | 45 | STANDARD + timeline-specific flags |

Each builder now spreads the nearest base and lists only its overrides:

| Builder | Base | Overrides |
|---------|------|-----------|
| `buildArticleFeatures` | `STANDARD` | 0 (pure base) |
| `buildSearchFeatures` | `STANDARD` | +1 flag |
| `buildTweetCreateFeatures` | `STANDARD` | 1 override |
| `buildTimelineFeatures` | `TIMELINE` | 0 (pure base) |
| `buildLikesFeatures` | `TIMELINE` | 0 (pure base) |
| `buildHomeTimelineFeatures` | `TIMELINE` | 0 (pure base) |
| `buildBookmarksFeatures` | `TIMELINE` | +1 flag |
| `buildListsFeatures` | `STANDARD` | +5 flags |
| `buildUserTweetsFeatures` | `STANDARD` | 4 overrides |
| `buildExploreFeatures` | `STANDARD` | 6 overrides |
| `buildFollowingFeatures` | `CORE` | 17 flags (very different from standard) |
| `buildTweetDetailFeatures` | `STANDARD` | +11 flags |

## Key Decisions

- **`following` uses CORE, not STANDARD**: Following has 17 differences from
  STANDARD (e.g., `premium_content_api_read_enabled: true`,
  `responsive_web_jetfuel_frame: false`). Spreading STANDARD and overriding
  17 flags would be worse than the current approach.

- **`lists` uses STANDARD, not TIMELINE**: Lists has `blue_business: false`,
  `vibe_api: false`, `interactive_text: false` — opposite of TIMELINE. And it
  lacks `longform_notetweets_richtext_consumption_enabled` and
  `responsive_web_media_download_video_enabled` that TIMELINE includes.

- **Verified identical output**: A test script compared every builder's output
  against the original flag sets — all 14 produce byte-identical results.

## Results

- **Lines**: 359 → 198 (**161 lines removed**, 55% reduction)
- **Files changed**: 1 (`twitter-client-features.ts`)
- **Tests**: All 434 pass
- **Build**: ✅
- **Lint**: ✅ (only pre-existing `cli-shared.test.ts` issue)
- **`peep whoami`**: ✅ Verified working

## Verification

```bash
npx tsx tmp-verify.ts  # Compares original vs refactored output for all 14 builders
npm run build && npm test && ./peep whoami
```
