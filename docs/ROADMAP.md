# Feature Roadmap — Untapped GraphQL Endpoints

Based on [TwitterInternalAPIDocument](https://github.com/fa0311/TwitterInternalAPIDocument), X's internal GraphQL API exposes ~200+ operations. peep currently uses ~20. Here's what's available to add.

## Current Coverage

peep currently implements these GraphQL operations:

| Operation | Command |
|-----------|---------|
| `TweetDetail` | `peep read`, `peep thread`, `peep replies` |
| `UserTweets` | `peep user-tweets` |
| `UserByScreenName` | user lookup (internal) |
| `SearchTimeline` | `peep search` |
| `Likes` | `peep likes` |
| `Bookmarks` / `BookmarkFolderTimeline` | `peep bookmarks` |
| `DeleteBookmark` | `peep unbookmark` |
| `Followers` / `Following` | `peep followers`, `peep following` |
| `CreateFriendship` / `DestroyFriendship` | `peep follow`, `peep unfollow` |
| `CreateTweet` | `peep tweet`, `peep reply` |
| `CreateRetweet` | retweet (internal) |
| `ListOwnerships` / `ListMemberships` | `peep lists` |
| `ListLatestTweetsTimeline` | `peep list-timeline` |
| `HomeTimeline` / `HomeLatestTimeline` | `peep home` |
| `ExplorePage` / `ExploreSidebar` | `peep news`, `peep trending` |
| `AboutAccountQuery` | `peep about` |
| `UserArticlesTweets` | user articles (internal) |
| `GenericTimelineById` | generic timeline (internal) |
| `TrendHistory` | trend history (internal) |

## High Priority — Missing Basics

These are features users expect in a Twitter CLI:

| Command | API Endpoint | Description |
|---------|-------------|-------------|
| `peep retweeters <id>` | `Retweeters` | Who retweeted a tweet |
| `peep favoriters <id>` | `Favoriters` | Who liked a specific tweet |
| `peep notifications` | `NotificationsTimeline` | Notification feed |
| `peep delete-tweet <id>` | `DeleteTweet` | Delete your own tweet |
| `peep delete-rt <id>` | `DeleteRetweet` | Undo a retweet |
| `peep pin-tweet <id>` | `PinTweet` | Pin a tweet on your profile |
| `peep unpin-tweet` | `UnpinTweet` | Unpin your pinned tweet |
| `peep rt <id>` | `CreateRetweet` | Explicit retweet command |
| `peep user-media @handle` | `UserMedia` | User's media-only timeline |
| `peep user-replies @handle` | `UserTweetsAndReplies` | User's tweets + replies combined |
| `peep note-tweet "text"` | `CreateNoteTweet` | Post a long-form tweet (>280 chars) |
| `peep edit-tweet <id> "text"` | tweet edit API | Edit a posted tweet |
| `peep remove-follower <user>` | `RemoveFollower` | Remove a follower without blocking |

## Account Management

| Command | API Endpoint | Description |
|---------|-------------|-------------|
| `peep block <user>` | `BlockedAccountsAll` + block mutation | Block a user |
| `peep unblock <user>` | unblock mutation | Unblock a user |
| `peep blocks` | `BlockedAccountsAll` | List blocked accounts |
| `peep mute <user>` | `MutedAccounts` + mute mutation | Mute a user |
| `peep unmute <user>` | unmute mutation | Unmute a user |
| `peep mutes` | `MutedAccounts` | List muted accounts |
| `peep preferences` | `UserPreferences` | View account settings |
| `peep conversation-control <id>` | `ConversationControlChange` | Limit who can reply to your tweet |

## Content Creation

| Command | API Endpoint | Description |
|---------|-------------|-------------|
| `peep draft <text>` | `CreateDraftTweet` | Save a draft tweet |
| `peep drafts` | `FetchDraftTweets` | List saved drafts |
| `peep edit-draft <id> "text"` | `EditDraftTweet` | Edit a saved draft |
| `peep schedule-tweet <text> --at <time>` | `CreateScheduledTweet` | Schedule a tweet for later |
| `peep scheduled` | `FetchScheduledTweets` | View scheduled tweets |

## Search & Discovery

| Command | API Endpoint | Description |
|---------|-------------|-------------|
| `peep users <query>` | `UsersByScreenNames` | Lookup users by handle(s) |
| `peep similar <id>` | `SimilarPosts` | Find tweets similar to a given tweet |
| `peep trend-history <name>` | `TrendHistory` | Historical trend data |
| `peep bookmark-search <query>` | `BookmarkSearchTimeline` | Search within your bookmarks |

## Communities

X's Communities feature (group feeds) has a full CRUD API:

| Command | API Endpoint | Description |
|---------|-------------|-------------|
| `peep communities` | `CommunitiesMembershipsSlice` | List your communities |
| `peep community <id>` | `CommunityByRestId` | Community info & settings |
| `peep community-tweets <id>` | `CommunityTweetsTimeline` | Community tweet feed |
| `peep community-search <query>` | `CommunitiesDiscoveryTimeline` | Discover communities |
| `peep join-community <id>` | `JoinCommunity` | Join a community |
| `peep leave-community <id>` | `LeaveCommunity` | Leave a community |

## Grok (X's AI)

If the authenticated account has Grok access:

| Command | API Endpoint | Description |
|---------|-------------|-------------|
| `peep grok <query>` | `CreateGrokConversation` + `GrokConversationItemsByRestId` | Chat with Grok |
| `peep grok-history` | `GrokHistory` | Past Grok conversations |
| `peep grok-image <prompt>` | Grok imagine endpoints | Generate images with Grok |

## Articles

X's Medium-like long-form articles:

| Command | API Endpoint | Description |
|---------|-------------|-------------|
| `peep article <id>` | `ArticleEntityResultByRestId` | Read a full X article |
| `peep articles @handle` | `UserArticlesTweets` | List a user's articles |

## Spaces (Live Audio)

| Command | API Endpoint | Description |
|---------|-------------|-------------|
| `peep spaces` | `AudioSpaceSearch` | Find live Spaces |
| `peep space <id>` | `AudioSpaceById` | Get Space details and participants |

## Lists — Missing Operations

peep supports list timelines and listing owned/member-of lists, but not:

| Command | API Endpoint | Description |
|---------|-------------|-------------|
| `peep list-members <id>` | `ListMembers` | Members of a list |
| `peep list-subscribers <id>` | `ListSubscribers` | Subscribers of a list |
| `peep list-add <list-id> <user>` | `ListAddMember` | Add member to list |
| `peep list-remove <list-id> <user>` | `ListRemoveMember` | Remove member from list |
| `peep list-subscribe <id>` | `ListSubscribe` | Subscribe to a list |
| `peep list-unsubscribe <id>` | `ListUnsubscribe` | Unsubscribe from a list |
| `peep list-create <name>` | `CreateList` | Create a new list |
| `peep list-delete <id>` | `DeleteList` | Delete a list |
| `peep list-update <id>` | `UpdateList` | Update list name/description |
| `peep list-search <query>` | `ListSearchTimeline` | Search for lists |
| `peep list-mute <id>` / `peep list-unmute <id>` | `MuteList` / `UnmuteList` | Mute/unmute a list |

## Reference

- [TwitterInternalAPIDocument — GraphQL.md](https://github.com/fa0311/TwitterInternalAPIDocument/blob/master/docs/markdown/GraphQL.md) — Full list of ~200+ operations with parameters and feature flags
- [AwesomeTwitterUndocumentedAPI](https://github.com/fa0311/AwesomeTwitterUndocumentedAPI) — Curated list of libraries and tools for the internal API
- [twitter-openapi](https://github.com/fa0311/twitter-openapi) — OpenAPI/Swagger spec of the internal API
