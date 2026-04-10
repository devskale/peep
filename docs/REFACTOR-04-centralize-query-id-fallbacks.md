# REFACTOR-04: Centralize Query ID Fallback Boilerplate

**Branch**: `refactor/centralize-features` (continuation)
**Date**: 2026-04-10
**Status**: ✅ Complete

## Problem

15 `getXxxQueryIds()` methods across 7 mixin files all followed the exact
same pattern:

```typescript
private async getXxxQueryIds(): Promise<string[]> {
  const primary = await this.getQueryId('OpName');
  return Array.from(new Set([primary, 'fallback1', 'fallback2']));
}
```

Only 5 of 15 operations actually had *extra* fallbacks beyond the primary
baked-in ID in `FALLBACK_QUERY_IDS`. The other 10 were pure boilerplate.

## Solution

1. **Added `EXTRA_QUERY_ID_FALLBACKS`** to `twitter-client-constants.ts`:
   a map of operation name → additional fallback query IDs beyond the
   primary `FALLBACK_QUERY_IDS` entry.

2. **Added `getQueryIdsWithFallbacks()`** to `TwitterClientBase`:
   gets the runtime/baked-in query ID, appends any extras from the map,
   deduplicates, and returns the ordered list.

3. **Replaced all 15 methods** with single-line delegations:
   ```typescript
   private async getUserTweetsQueryIds(): Promise<string[]> {
     return this.getQueryIdsWithFallbacks('UserTweets');
   }
   ```

## Operations with Extra Fallbacks

| Operation | Extra Fallbacks |
|-----------|----------------|
| TweetDetail | 1 extra |
| SearchTimeline | 2 extra |
| Bookmarks | 1 extra |
| CreateFriendship | 1 extra |
| DestroyFriendship | 1 extra |

## Results

- **Files changed**: 9 (constants, base, 7 mixins)
- **Net change**: +41 / -33 lines
- **Tests**: All 434 pass
- **Build**: ✅
- **Lint**: ✅ (only pre-existing `cli-shared.test.ts` issue)
- **`peep whoami`**: ✅ Verified working
