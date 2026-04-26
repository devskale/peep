import { extractEntities, type RawLegacyEntities } from './tweet-render.js';
import { extractArticleMetadata, extractMedia, extractTweetText } from './twitter-client-content-state.js';
import type { GraphqlTweetResult, TweetData, TwitterUser } from './twitter-client-types.js';

export function unwrapTweetResult(result: GraphqlTweetResult | undefined): GraphqlTweetResult | undefined {
  if (!result) {
    return undefined;
  }
  if (result.tweet) {
    return result.tweet;
  }
  return result;
}

export interface MapTweetResultOptions {
  quoteDepth: number;
  includeRaw?: boolean;
}

export function mapTweetResult(
  result: GraphqlTweetResult | undefined,
  quoteDepthOrOptions: number | MapTweetResultOptions,
): TweetData | undefined {
  const options: MapTweetResultOptions =
    typeof quoteDepthOrOptions === 'number' ? { quoteDepth: quoteDepthOrOptions } : quoteDepthOrOptions;
  const { quoteDepth, includeRaw = false } = options;

  const userResult = result?.core?.user_results?.result;
  const userLegacy = userResult?.legacy;
  const userCore = userResult?.core;
  const username = userLegacy?.screen_name ?? userCore?.screen_name;
  const name = userLegacy?.name ?? userCore?.name ?? username;
  const userId = userResult?.rest_id;
  if (!result?.rest_id || !username) {
    return undefined;
  }

  const text = extractTweetText(result);
  if (!text) {
    return undefined;
  }

  let quotedTweet: TweetData | undefined;
  if (quoteDepth > 0) {
    const quotedResult = unwrapTweetResult(result.quoted_status_result?.result);
    if (quotedResult) {
      quotedTweet = mapTweetResult(quotedResult, { quoteDepth: quoteDepth - 1, includeRaw });
    }
  }

  const media = extractMedia(result);
  const article = extractArticleMetadata(result);
  const entities = extractEntities(result.legacy?.entities as RawLegacyEntities | undefined);

  const tweetData: TweetData = {
    id: result.rest_id,
    text,
    createdAt: result.legacy?.created_at,
    replyCount: result.legacy?.reply_count,
    retweetCount: result.legacy?.retweet_count,
    likeCount: result.legacy?.favorite_count,
    conversationId: result.legacy?.conversation_id_str,
    inReplyToStatusId: result.legacy?.in_reply_to_status_id_str ?? undefined,
    author: {
      username,
      name: name || username,
    },
    authorId: userId,
    quotedTweet,
    media,
    article,
    entities,
  };

  if (includeRaw) {
    (tweetData as TweetData & { _raw: GraphqlTweetResult })._raw = result;
  }

  return tweetData;
}

export function findTweetInInstructions(
  instructions:
    | Array<{
        entries?: Array<{
          content?: {
            itemContent?: {
              tweet_results?: {
                result?: GraphqlTweetResult;
              };
            };
          };
        }>;
      }>
    | undefined,
  tweetId: string,
): GraphqlTweetResult | undefined {
  if (!instructions) {
    return undefined;
  }

  for (const instruction of instructions) {
    for (const entry of instruction.entries || []) {
      const result = entry.content?.itemContent?.tweet_results?.result;
      if (result?.rest_id === tweetId) {
        return result;
      }
    }
  }

  return undefined;
}

export function collectTweetResultsFromEntry(entry: {
  content?: {
    itemContent?: {
      tweet_results?: {
        result?: GraphqlTweetResult;
      };
    };
    item?: {
      itemContent?: {
        tweet_results?: {
          result?: GraphqlTweetResult;
        };
      };
    };
    items?: Array<{
      item?: {
        itemContent?: {
          tweet_results?: {
            result?: GraphqlTweetResult;
          };
        };
      };
      itemContent?: {
        tweet_results?: {
          result?: GraphqlTweetResult;
        };
      };
      content?: {
        itemContent?: {
          tweet_results?: {
            result?: GraphqlTweetResult;
          };
        };
      };
    }>;
  };
}): GraphqlTweetResult[] {
  const results: GraphqlTweetResult[] = [];
  const pushResult = (result?: GraphqlTweetResult) => {
    if (result?.rest_id) {
      results.push(result);
    }
  };

  const content = entry.content;
  pushResult(content?.itemContent?.tweet_results?.result);
  pushResult(content?.item?.itemContent?.tweet_results?.result);

  for (const item of content?.items ?? []) {
    pushResult(item?.item?.itemContent?.tweet_results?.result);
    pushResult(item?.itemContent?.tweet_results?.result);
    pushResult(item?.content?.itemContent?.tweet_results?.result);
  }

  return results;
}

export interface ParseTweetsOptions {
  quoteDepth: number;
  includeRaw?: boolean;
}

export function parseTweetsFromInstructions(
  instructions:
    | Array<{
        entries?: Array<{
          content?: {
            itemContent?: {
              tweet_results?: {
                result?: GraphqlTweetResult;
              };
            };
            item?: {
              itemContent?: {
                tweet_results?: {
                  result?: GraphqlTweetResult;
                };
              };
            };
            items?: Array<{
              item?: {
                itemContent?: {
                  tweet_results?: {
                    result?: GraphqlTweetResult;
                  };
                };
              };
              itemContent?: {
                tweet_results?: {
                  result?: GraphqlTweetResult;
                };
              };
              content?: {
                itemContent?: {
                  tweet_results?: {
                    result?: GraphqlTweetResult;
                  };
                };
              };
            }>;
          };
        }>;
      }>
    | undefined,
  quoteDepthOrOptions: number | ParseTweetsOptions,
): TweetData[] {
  const options: ParseTweetsOptions =
    typeof quoteDepthOrOptions === 'number' ? { quoteDepth: quoteDepthOrOptions } : quoteDepthOrOptions;
  const { quoteDepth, includeRaw = false } = options;

  const tweets: TweetData[] = [];
  const seen = new Set<string>();

  for (const instruction of instructions ?? []) {
    for (const entry of instruction.entries ?? []) {
      const results = collectTweetResultsFromEntry(entry);
      for (const result of results) {
        const mapped = mapTweetResult(result, { quoteDepth, includeRaw });
        if (!mapped || seen.has(mapped.id)) {
          continue;
        }
        seen.add(mapped.id);
        tweets.push(mapped);
      }
    }
  }

  return tweets;
}

export function extractCursorFromInstructions(
  instructions:
    | Array<{
        entries?: Array<{
          content?: unknown;
        }>;
      }>
    | undefined,
  cursorType = 'Bottom',
): string | undefined {
  for (const instruction of instructions ?? []) {
    for (const entry of instruction.entries ?? []) {
      const content = entry.content as { cursorType?: unknown; value?: unknown } | undefined;
      if (content?.cursorType === cursorType && typeof content.value === 'string' && content.value.length > 0) {
        return content.value;
      }
    }
  }
  return undefined;
}

export function parseUsersFromInstructions(
  instructions: Array<{ type?: string; entries?: Array<unknown> }> | undefined,
): TwitterUser[] {
  if (!instructions) {
    return [];
  }

  const users: TwitterUser[] = [];

  for (const instruction of instructions) {
    if (!instruction.entries) {
      continue;
    }

    for (const entry of instruction.entries) {
      const content = (entry as { content?: { itemContent?: { user_results?: { result?: unknown } } } })?.content;
      const rawUserResult = content?.itemContent?.user_results?.result as
        | {
            __typename?: string;
            rest_id?: string;
            is_blue_verified?: boolean;
            user?: unknown;
            legacy?: {
              screen_name?: string;
              name?: string;
              description?: string;
              followers_count?: number;
              friends_count?: number;
              profile_image_url_https?: string;
              created_at?: string;
            };
            core?: {
              screen_name?: string;
              name?: string;
              created_at?: string;
            };
            avatar?: {
              image_url?: string;
            };
          }
        | undefined;

      const userResult =
        rawUserResult?.__typename === 'UserWithVisibilityResults' && rawUserResult.user
          ? (rawUserResult.user as typeof rawUserResult)
          : rawUserResult;

      if (!userResult || userResult.__typename !== 'User') {
        continue;
      }

      const legacy = userResult.legacy;
      const core = userResult.core;
      const username = legacy?.screen_name ?? core?.screen_name;
      if (!userResult.rest_id || !username) {
        continue;
      }

      users.push({
        id: userResult.rest_id,
        username,
        name: legacy?.name ?? core?.name ?? username,
        description: legacy?.description,
        followersCount: legacy?.followers_count,
        followingCount: legacy?.friends_count,
        isBlueVerified: userResult.is_blue_verified,
        profileImageUrl: legacy?.profile_image_url_https ?? userResult.avatar?.image_url,
        createdAt: legacy?.created_at ?? core?.created_at,
      });
    }
  }

  return users;
}
