# Refactor #2: Centralize Tweet Pagination Loop

**Branch:** `refactor/centralize-pagination`
**Status:** 🟡 In Progress

## Problem

The tweet pagination loop is copy-pasted across **8 methods in 5 files**.
Every one does: `pageSize=20` → `seen` set → `while (limit)` → `fetchPage(count, cursor)`
→ dedup by id → check cursor repeat/empty → check maxPages → accumulate.

An existing `paginateCursor()` utility in `src/lib/paginate-cursor.ts` handles
cursor-based pagination but lacks:
- A `limit` cap (stop after N items collected)
- Passing `pageCount` to `fetchPage` (some APIs need the count as a variable)
- Stopping on empty pages or pages with only duplicates

### Duplication inventory

| File | Method | Has limit? | Has pageDelay? | Has maxPages? |
|------|--------|-----------|----------------|---------------|
| `timelines.ts` | `getLikesPaged` | ✅ | ❌ | ✅ |
| `timelines.ts` | `getBookmarksPaged` | ✅ | ❌ | ✅ |
| `timelines.ts` | `getBookmarkFolderTimelinePaged` | ✅ | ❌ | ✅ |
| `search.ts` | `searchPaged` | ✅ | ❌ | ✅ |
| `home.ts` | `fetchHomeTimeline` | ✅ | ❌ | ❌ |
| `user-tweets.ts` | `getUserTweetsPaged` | ✅ | ✅ | ✅ |
| `lists.ts` | `getListTimelinePaged` | ✅ | ❌ | ✅ |
| `tweet-detail.ts` | `getRepliesPaged` | ❌ | ✅ | ✅ |
| `tweet-detail.ts` | `getThreadPaged` | ❌ | ✅ | ✅ |

### Differences from existing `paginateCursor`

1. **`limit`** — stops when items collected >= limit
2. **`pageCount`** — fetchPage receives `(count, cursor)` not just `(cursor)`
3. **Empty page stop** — stops when `page.items.length === 0` or all duplicates
4. **`tweet-detail.ts`** uses `paginateCursor` already (no limit, just cursor-based)

## Plan

### Phase 1: Extend `paginateCursor` to support `limit` and `pageCount`

Add optional `limit` and `pageSize` fields. When set:
- `fetchPage` signature becomes `(count: number, cursor?: string) => CursorPage<T>`
- Loop stops when `items.length >= limit`
- Each page's count = `min(pageSize, limit - items.length)`

Backward-compatible: existing callers without `limit`/`pageSize` work unchanged.

### Phase 2: Migrate 8 methods to use extended `paginateCursor`

Replace inline loops in:
1. `timelines.ts` — 3 methods (likes, bookmarks, bookmark-folder)
2. `search.ts` — 1 method
3. `home.ts` — 1 method
4. `user-tweets.ts` — 1 method
5. `lists.ts` — 1 method

### Phase 3: Cleanup

- Remove any dead code
- Update tests
- Run linter

## Estimated line reduction

~150-200 lines removed across 5 files.
