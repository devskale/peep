# Refactor #1: Centralize 404-Retry + Query ID Fallback Pattern

**Branch:** `refactor/centralize-404-retry`
**Status:** 🟢 Complete — Phases 1–2 done, Phase 3 in progress

## Problem

The "try query IDs → 404? → refresh → retry → generic POST fallback" pattern is
copy-pasted across **14 methods in 11 files**. The base class already has a
`withRefreshedQueryIdsOn404()` helper, but only 3 methods use it. The rest
re-implement the same logic inline.

### Variants identified

| Variant | Files | Pattern |
|---------|-------|---------|
| **A: tryOnce + manual refresh** | `lists.ts` (×3), `follow.ts`, `tweet-detail.ts` | Inline `tryOnce()` → `if (had404) refreshQueryIds()` → `tryOnce()` again |
| **B: fetchPage + fetchWithRefresh** | `search.ts`, `home.ts`, `user-tweets.ts`, `timelines.ts` (×3), `lists.ts` (timeline) | Same as A but named `fetchPage`/`fetchWithRefresh` with extra pagination wrapper |
| **C: mutation + generic POST fallback** | `posting.ts`, `engagement.ts`, `bookmarks.ts` | POST to operation URL → 404 → refresh → 404 again → POST to generic `TWITTER_GRAPHQL_POST_URL` |
| **D: already uses base helper** | `users.ts` (×2), `user-lookup.ts` | Uses `withRefreshedQueryIdsOn404(tryOnce)` — the **target pattern** |

## Goal

Reduce to **one canonical retry method** on `TwitterClientBase` that covers all
variants (A, B, C). Every mixin should call it instead of re-implementing.

## Checklist

### Phase 1: Extend base class helpers ✅

- [x] **1.1** Add `GqlFetchOptions` type for the unified fetch helper
- [x] **1.2** Add `GqlResult<T>` discriminated union type + `GqlResponseParser<T>` + `GqlErrorChecker` types
- [x] **1.3** Implement `graphqlFetchWithRetry()` on `TwitterClientBase`
  - Tries each query ID in order
  - On 404 for any ID → marks `had404`, tries next ID
  - Returns `{ success, data/had404 }` (no refresh yet — caller or wrapper handles it)
  - Supports `fallbackToGenericPost` option for mutation fallback
  - Supports `variablesInUrl` option for search's unusual POST pattern
- [x] **1.4** Implement `graphqlMutationWithRetry()` on `TwitterClientBase`
  - For write operations (tweet, reply, like, etc.)
  - Tries operation URL → generic POST fallback → 404 → refresh → retry both
  - Covers variant **C** (posting, engagement, bookmarks)
- [x] **1.5** Implement `graphqlFetchWithRefresh()` on `TwitterClientBase`
  - Wraps `graphqlFetchWithRetry` with automatic refresh on `had404`
  - Covers variants **A** and **B**
  - Signature: `graphqlFetchWithRefresh<T>(opts, parseResponse, checkError?) => Promise<GqlResult<T>>`

### Phase 2: Migrate each mixin ✅

- [x] **2.1** Migrate `twitter-client-engagement.ts`
  - Replaced `performEngagementMutation()` body with `graphqlMutationWithRetry()`
  - Simplest mutation — good first migration target

- [x] **2.2** Migrate `twitter-client-bookmarks.ts`
  - Replaced `unbookmark()` body with `graphqlMutationWithRetry()`

- [x] **2.3** Migrate `twitter-client-posting.ts`
  - Replaced `createTweet()` body with `graphqlMutationWithRetry()`
  - Kept error-226 legacy fallback (`tryStatusUpdateFallback`) as a caller concern
  - Parser throws specific "Tweet created but no ID returned" error when rest_id is missing

- [x] **2.4** Migrate `twitter-client-follow.ts`
  - Replaced `followViaGraphQL()` with `graphqlFetchWithRefresh()`
  - Kept REST fallback (`followViaRest`) as caller concern

- [x] **2.5** Migrate `twitter-client-user-lookup.ts`
  - `getUserAboutAccount()` — switched to `graphqlFetchWithRefresh`
  - `getUserByScreenNameGraphQL()` — switched to `graphqlFetchWithRefresh`
  - Parser throws "Missing about_profile" error for missing data

- [x] **2.6** Migrate `twitter-client-users.ts`
  - `getFollowing()` / `getFollowers()` — switched to `graphqlFetchWithRefresh`

- [x] **2.7** Migrate `twitter-client-lists.ts`
  - `getOwnedLists()` — replaced inline tryOnce + manual refresh
  - `getListMemberships()` — same
  - `getListTimelinePaged()` — replaced `fetchPage` + `fetchWithRefresh` inner functions
  - Fixed: empty list arrays now returned as valid results (not parse errors)

- [x] **2.8** Migrate `twitter-client-tweet-detail.ts`
  - Replaced `fetchTweetDetail()` inner retry logic with `graphqlFetchWithRefresh()`

- [x] **2.9** Migrate `twitter-client-search.ts`
  - Replaced `fetchPage()` + `fetchWithRefresh()` with `graphqlFetchWithRefresh()`
  - Used `variablesInUrl: true` for search's unusual POST pattern (variables in URL params)
  - Kept `isQueryIdMismatch` detection via custom `checkErrors` callback

- [x] **2.10** Migrate `twitter-client-home.ts`
  - Replaced `fetchPage()` + `fetchWithRefresh()` with `graphqlFetchWithRefresh()`
  - Kept `QUERY_UNSPECIFIED_REGEX` detection via custom `checkErrors` callback

- [x] **2.11** Migrate `twitter-client-user-tweets.ts`
  - Replaced `fetchPage()` + `fetchWithRefresh()` with `graphqlFetchWithRefresh()`

- [x] **2.12** Migrate `twitter-client-timelines.ts`
  - `getLikesPaged()` — replaced `fetchPage` + `fetchWithRefresh`
  - `getBookmarksPaged()` — replaced `fetchPage` + `fetchWithRefresh`
  - `getBookmarkFolderTimelinePaged()` — replaced `fetchPage` + `fetchWithRefresh`
  - Kept per-method custom error checkers for non-fatal error tolerance

### Phase 3: Clean up

- [ ] **3.1** Remove any dead code / unused helper methods from mixins after migration
- [x] **3.2** Ensure all existing tests still pass (`pnpm test`) — 434 tests pass
- [x] **3.3** Add a focused unit test for the base class retry helpers (`tests/graphql-fetch-helpers.test.ts`)
  - ✅ Test: normal success (first query ID works)
  - ✅ Test: 404 on primary, success on fallback
  - ✅ Test: 404 on all IDs → had404=true
  - ✅ Test: non-404 error (no refresh, propagate error)
  - ✅ Test: GraphQL error from response body
  - ✅ Test: parser returns undefined → error
  - ✅ Test: mutation fallback to generic POST URL
  - ✅ Test: refresh not called on success
  - ✅ Test: refresh not called on non-404 error
  - ✅ Test: refresh called on 404, retry succeeds
  - ✅ Test: refresh + retry still fails
  - ✅ Test: mutation succeeds via generic POST without refresh
  - ✅ Test: mutation refreshes when both operation + generic POST 404
- [ ] **3.4** Run linter (`pnpm run lint`)
- [ ] **3.5** Verify live tests still pass (`pnpm run test:live`)

## Files touched

| File | Change |
|------|--------|
| `src/lib/twitter-client-base.ts` | Add `graphqlFetchWithRetry()`, `graphqlMutationWithRetry()`, `graphqlFetchWithRefresh()`, `variablesInUrl` option, types |
| `src/lib/twitter-client-engagement.ts` | Replace `performEngagementMutation()` |
| `src/lib/twitter-client-bookmarks.ts` | Replace `unbookmark()` |
| `src/lib/twitter-client-posting.ts` | Replace `createTweet()`, fix 226 fallback error propagation |
| `src/lib/twitter-client-follow.ts` | Replace `followViaGraphQL()` |
| `src/lib/twitter-client-user-lookup.ts` | Switch to new helpers, throw on missing about_profile |
| `src/lib/twitter-client-users.ts` | Switch to new helpers |
| `src/lib/twitter-client-lists.ts` | Replace 3 methods' retry logic, fix empty list handling |
| `src/lib/twitter-client-tweet-detail.ts` | Replace `fetchTweetDetail()` |
| `src/lib/twitter-client-search.ts` | Replace `fetchPage` + `fetchWithRefresh`, use `variablesInUrl` |
| `src/lib/twitter-client-home.ts` | Replace `fetchPage` + `fetchWithRefresh` |
| `src/lib/twitter-client-user-tweets.ts` | Replace `fetchPage` + `fetchWithRefresh` |
| `src/lib/twitter-client-timelines.ts` | Replace 3 methods' retry logic |
| `tests/` | Update tests for new error messages + base class retry tests |

## Results

**Net reduction: ~1,080 lines** (675 added, 1,755 removed across 17 files)
- All 12 mixin files migrated to use base class helpers
- All 434 tests pass (421 existing + 13 new)
- Caller-specific concerns preserved (226 fallback, REST fallback, query mismatch detection)
