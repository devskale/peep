# Refactor #1: Centralize 404-Retry + Query ID Fallback Pattern

**Branch:** `refactor/centralize-404-retry`
**Status:** 🟡 In Progress — Phase 1 complete, Phase 2 in progress

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
- [x] **1.4** Implement `graphqlMutationWithRetry()` on `TwitterClientBase`
  - For write operations (tweet, reply, like, etc.)
  - Tries operation URL → generic POST fallback → 404 → refresh → retry both
  - Covers variant **C** (posting, engagement, bookmarks)
- [x] **1.5** Implement `graphqlFetchWithRefresh()` on `TwitterClientBase`
  - Wraps `graphqlFetchWithRetry` with automatic refresh on `had404`
  - Covers variants **A** and **B**
  - Signature: `graphqlFetchWithRefresh<T>(opts, parseResponse, checkError?) => Promise<GqlResult<T>>`

### Phase 2: Migrate each mixin (one at a time)

- [ ] **2.1** Migrate `twitter-client-engagement.ts`
  - Replace `performEngagementMutation()` body with `graphqlMutationWithRetry()`
  - Simplest mutation — good first migration target

- [ ] **2.2** Migrate `twitter-client-bookmarks.ts`
  - Replace `unbookmark()` body with `graphqlMutationWithRetry()`

- [ ] **2.3** Migrate `twitter-client-posting.ts`
  - Replace `createTweet()` body with `graphqlMutationWithRetry()`
  - Keep the error-226 legacy fallback (`tryStatusUpdateFallback`) as a caller concern

- [ ] **2.4** Migrate `twitter-client-follow.ts`
  - Replace `followViaGraphQL()` with `graphqlFetchWithRefresh()`
  - Keep REST fallback (`followViaRest`) as caller concern

- [ ] **2.5** Migrate `twitter-client-user-lookup.ts`
  - `getUserAboutAccount()` — already uses `withRefreshedQueryIdsOn404`, just switch to `graphqlFetchWithRefresh`
  - `getUserByScreenNameGraphQL()` — switch to `graphqlFetchWithRefresh`

- [ ] **2.6** Migrate `twitter-client-users.ts`
  - `getFollowing()` / `getFollowers()` — already use `withRefreshedQueryIdsOn404`, switch to `graphqlFetchWithRefresh`

- [ ] **2.7** Migrate `twitter-client-lists.ts`
  - `getOwnedLists()` — replace inline tryOnce + manual refresh
  - `getListMemberships()` — same
  - `getListTimelinePaged()` — replace `fetchPage` + `fetchWithRefresh` inner functions

- [ ] **2.8** Migrate `twitter-client-tweet-detail.ts`
  - Replace `fetchTweetDetail()` inner retry logic with `graphqlFetchWithRefresh()`
  - Keep the POST fallback as an option on `GqlFetchOptions`

- [ ] **2.9** Migrate `twitter-client-search.ts`
  - Replace `fetchPage()` + `fetchWithRefresh()` with `graphqlFetchWithRefresh()`
  - Keep the `isQueryIdMismatch` detection (extend base helper to accept a `shouldRefresh` predicate)

- [ ] **2.10** Migrate `twitter-client-home.ts`
  - Replace `fetchPage()` + `fetchWithRefresh()` with `graphqlFetchWithRefresh()`

- [ ] **2.11** Migrate `twitter-client-user-tweets.ts`
  - Replace `fetchPage()` + `fetchWithRefresh()` with `graphqlFetchWithRefresh()`

- [ ] **2.12** Migrate `twitter-client-timelines.ts`
  - `getLikesPaged()` — replace `fetchPage` + `fetchWithRefresh`
  - `getBookmarksPaged()` — replace `fetchPage` + `fetchWithRefresh`
  - `getBookmarkFolderTimelinePaged()` — replace `fetchPage` + `fetchWithRefresh`
  - Keep `fetchWithRetry` (429/5xx backoff) as a separate concern or merge into base

### Phase 3: Clean up

- [ ] **3.1** Remove any dead code / unused helper methods from mixins after migration
- [ ] **3.2** Ensure all existing tests still pass (`pnpm test`)
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
| `src/lib/twitter-client-base.ts` | Add `graphqlFetchWithRetry()`, `graphqlMutationWithRetry()`, `graphqlFetchWithRefresh()`, types |
| `src/lib/twitter-client-engagement.ts` | Replace `performEngagementMutation()` |
| `src/lib/twitter-client-bookmarks.ts` | Replace `unbookmark()` |
| `src/lib/twitter-client-posting.ts` | Replace `createTweet()` |
| `src/lib/twitter-client-follow.ts` | Replace `followViaGraphQL()` |
| `src/lib/twitter-client-user-lookup.ts` | Switch to new helpers |
| `src/lib/twitter-client-users.ts` | Switch to new helpers |
| `src/lib/twitter-client-lists.ts` | Replace 3 methods' retry logic |
| `src/lib/twitter-client-tweet-detail.ts` | Replace `fetchTweetDetail()` |
| `src/lib/twitter-client-search.ts` | Replace `fetchPage` + `fetchWithRefresh` |
| `src/lib/twitter-client-home.ts` | Replace `fetchPage` + `fetchWithRefresh` |
| `src/lib/twitter-client-user-tweets.ts` | Replace `fetchPage` + `fetchWithRefresh` |
| `src/lib/twitter-client-timelines.ts` | Replace 3 methods' retry logic |
| `tests/` | Add base class retry tests |

## Estimated line reduction

~400–500 lines removed across mixins (replaced by ~80–100 lines in base class).
