# Refactor #2: Centralize Tweet Pagination Loop

**Branch:** `refactor/centralize-pagination`
**Status:** ✅ Complete

## Problem

The tweet pagination loop is copy-pasted across **8 methods in 5 files**.
Every one does: `pageSize=20` → `seen` set → `while (limit)` → `fetchPage(count, cursor)`
→ dedup by id → check cursor repeat/empty → check maxPages → accumulate.

An existing `paginateCursor()` utility handled cursor-based pagination for
`tweet-detail.ts` but lacked a `limit` cap and `pageCount` parameter.

## Checklist

### Phase 1: Extend `paginateCursor` ✅

- [x] Add optional `limit` and `pageSize` fields to options
- [x] When `limit` is set, `fetchPage` receives `(count, cursor)` instead of `(cursor)`
- [x] Loop stops when `items.length >= limit`
- [x] Stops on empty pages or all-duplicate pages (for limited pagination)
- [x] Unlimited pagination preserves old behavior (backward-compatible)
- [x] TypeScript discriminated union for clean type narrowing

### Phase 2: Migrate 8 methods ✅

- [x] `timelines.ts` — getLikesPaged, getBookmarksPaged, getBookmarkFolderTimelinePaged
- [x] `search.ts` — searchPaged
- [x] `home.ts` — fetchHomeTimeline
- [x] `user-tweets.ts` — getUserTweetsPaged
- [x] `lists.ts` — getListTimelinePaged
- [x] `tweet-detail.ts` — already used paginateCursor (unchanged)

### Phase 3: Cleanup ✅

- [x] All 434 tests pass
- [x] Build succeeds, `peep whoami` works
- [x] Lint clean

## Results

**~240 lines removed** across 5 files (686 removed, 447 added).
Combined with Refactor #1: **435 net lines removed** across 22 files.
