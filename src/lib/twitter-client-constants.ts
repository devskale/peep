// biome-ignore lint/correctness/useImportExtensions: JSON module import doesn't use .js extension.
import queryIds from './query-ids.json' with { type: 'json' };

export const TWITTER_API_BASE = 'https://x.com/i/api/graphql';
export const TWITTER_UPLOAD_URL = 'https://upload.twitter.com/i/media/upload.json';
export const TWITTER_MEDIA_METADATA_URL = 'https://x.com/i/api/1.1/media/metadata/create.json';
export const TWITTER_STATUS_UPDATE_URL = 'https://x.com/i/api/1.1/statuses/update.json';
export const SETTINGS_SCREEN_NAME_REGEX = /"screen_name":"([^"]+)"/;
export const SETTINGS_USER_ID_REGEX = /"user_id"\s*:\s*"(\d+)"/;
export const SETTINGS_NAME_REGEX = /"name":"([^"\\]*(?:\\.[^"\\]*)*)"/;

// Query IDs rotate frequently; the values in query-ids.json are refreshed by
// scripts/update-query-ids.ts. The fallback values keep the client usable if
// the file is missing or incomplete.
export const FALLBACK_QUERY_IDS = {
  CreateTweet: 'TAJw1rBsjAtdNgTdlo2oeg',
  CreateRetweet: 'ojPdsZsimiJrUGLR1sjUtA',
  DeleteRetweet: 'iQtK4dl5hBmXewYZuEOKVw',
  CreateFriendship: '8h9JVdV8dlSyqyRDJEPCsA',
  DestroyFriendship: 'ppXWuagMNXgvzx6WoXBW0Q',
  FavoriteTweet: 'lI07N6Otwv1PhnEgXILM7A',
  UnfavoriteTweet: 'ZYKSe-w7KEslx3JhSIk5LA',
  CreateBookmark: 'aoDbu3RHznuiSkQ9aNM67Q',
  DeleteBookmark: 'Wlmlj2-xzyS1GN3a6cj-mQ',
  TweetDetail: '97JF30KziU00483E_8elBA',
  SearchTimeline: 'M1jEez78PEfVfbQLvlWMvQ',
  UserArticlesTweets: '8zBy9h4L90aDL02RsBcCFg',
  UserTweets: 'Wms1GvIiHXAPBaCr9KblaA',
  Bookmarks: 'RV1g3b8n_SGOHwkqKYSCFw',
  Following: 'BEkNpEt5pNETESoqMsTEGA',
  Followers: 'kuFUYP9eV1FPoEy4N-pi7w',
  Likes: 'JR2gceKucIKcVNB_9JkhsA',
  BookmarkFolderTimeline: 'KJIQpsvxrTfRIlbaRIySHQ',
  ListOwnerships: 'BBLgNbbUu6HXAX11lV_1Qw',
  ListMemberships: 'en6N7nVkbafxIMQa8ef2DA',
  ListLatestTweetsTimeline: 'fb_6wmHD2dk9D-xYXOQlgw',
  ListByRestId: 't9AbdyHaJVfjL9jsODwgpQ',
  HomeTimeline: 'edseUwk9sP5Phz__9TIRnA',
  HomeLatestTimeline: 'iOEZpOdfekFsxSlPQCQtPg',
  ExploreSidebar: 'lpSN4M6qpimkF4nRFPE3nQ',
  ExplorePage: 'kheAINB_4pzRDqkzG3K-ng',
  GenericTimelineById: 'uGSr7alSjR9v6QJAIaqSKQ',
  TrendHistory: 'Sj4T-jSB9pr0Mxtsc1UKZQ',
  AboutAccountQuery: 'zs_jFPFT78rBpXv9Z3U2YQ',
} as const;

export type OperationName = keyof typeof FALLBACK_QUERY_IDS;

export const QUERY_IDS: Record<OperationName, string> = {
  ...FALLBACK_QUERY_IDS,
  ...(queryIds as Partial<Record<OperationName, string>>),
};

export const TARGET_QUERY_ID_OPERATIONS = Object.keys(FALLBACK_QUERY_IDS) as Array<OperationName>;

/**
 * Additional fallback query IDs beyond the primary FALLBACK_QUERY_IDS.
 * These provide extra resilience when the primary and baked-in fallback
 * both return 404. The helper `getQueryIdsWithFallbacks()` merges
 * the runtime/baked-in ID with these extras.
 */
export const EXTRA_QUERY_ID_FALLBACKS: Partial<Record<OperationName, string[]>> = {
  TweetDetail: ['aFvUsJm2c-oDkJV75blV6g'],
  SearchTimeline: ['5h0kNbk3ii97rmfY6CdgAA', 'Tp1sewRU1AsZpBWhqCZicQ'],
  Bookmarks: ['tmd4ifV8RHltzn8ymGg1aw'],
  CreateFriendship: ['OPwKc1HXnBT_bWXfAlo-9g'],
  DestroyFriendship: ['8h9JVdV8dlSyqyRDJEPCsA'],
};
