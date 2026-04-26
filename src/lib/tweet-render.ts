/**
 * Tweet rendering for peep.
 *
 * Renders tweet text to plain text or markdown with proper entity handling
 * for mentions, URLs, hashtags, and media. Extracts entities from raw
 * GraphQL responses and attaches them to TweetData.
 *
 * Inspired by birdclaw's tweet-render.ts.
 */

// ---------------------------------------------------------------------------
// Entity types
// ---------------------------------------------------------------------------

export interface TweetMentionEntity {
  id: string;
  username: string;
  name: string;
  start: number;
  end: number;
}

export interface TweetUrlEntity {
  url: string;
  expandedUrl: string;
  displayUrl: string;
  start: number;
  end: number;
}

export interface TweetHashtagEntity {
  tag: string;
  start: number;
  end: number;
}

export interface TweetEntities {
  mentions?: TweetMentionEntity[];
  urls?: TweetUrlEntity[];
  hashtags?: TweetHashtagEntity[];
}

// ---------------------------------------------------------------------------
// Entity extraction from raw GraphQL
// ---------------------------------------------------------------------------

export interface RawLegacyEntities {
  user_mentions?: Array<{
    id_str?: string;
    screen_name?: string;
    name?: string;
    indices?: [number, number];
  }>;
  urls?: Array<{
    url?: string;
    expanded_url?: string;
    display_url?: string;
    indices?: [number, number];
  }>;
  hashtags?: Array<{
    text?: string;
    indices?: [number, number];
  }>;
  media?: Array<{
    url?: string;
    indices?: [number, number];
  }>;
}

/**
 * Extract structured entities from the raw GraphQL legacy entities object.
 * Filters out media URLs (handled separately by TweetData.media).
 */
export function extractEntities(rawEntities?: RawLegacyEntities): TweetEntities | undefined {
  if (!rawEntities) {
    return undefined;
  }

  const mentions = (rawEntities.user_mentions ?? [])
    .filter((m): m is typeof m & { id_str: string; screen_name: string; indices: [number, number] } =>
      Boolean(m.id_str && m.screen_name && m.indices && m.indices.length === 2),
    )
    .map((m) => ({
      id: m.id_str,
      username: m.screen_name,
      name: m.name ?? m.screen_name,
      start: m.indices[0],
      end: m.indices[1],
    }));

  // Filter out media URLs — they point to t.co links for media already in TweetData.media
  const mediaUrls = new Set((rawEntities.media ?? []).map((m) => m.url).filter(Boolean) as string[]);

  const urls = (rawEntities.urls ?? [])
    .filter((u): u is typeof u & { url: string; indices: [number, number] } =>
      Boolean(u.indices && u.indices.length === 2 && u.url && !mediaUrls.has(u.url)),
    )
    .map((u) => ({
      url: u.url,
      expandedUrl: u.expanded_url ?? u.url,
      displayUrl: u.display_url ?? u.url,
      start: u.indices[0],
      end: u.indices[1],
    }));

  const hashtags = (rawEntities.hashtags ?? [])
    .filter((h): h is typeof h & { text: string; indices: [number, number] } =>
      Boolean(h.text && h.indices && h.indices.length === 2),
    )
    .map((h) => ({
      tag: h.text,
      start: h.indices[0],
      end: h.indices[1],
    }));

  if (mentions.length === 0 && urls.length === 0 && hashtags.length === 0) {
    return undefined;
  }

  return { mentions, urls, hashtags };
}

// ---------------------------------------------------------------------------
// Segment collection
// ---------------------------------------------------------------------------

type TweetSegment =
  | ({ kind: 'mention' } & TweetMentionEntity)
  | ({ kind: 'url' } & TweetUrlEntity)
  | ({ kind: 'hashtag' } & TweetHashtagEntity);

function collectSegments(entities: TweetEntities): TweetSegment[] {
  return [
    ...(entities.mentions ?? []).map((m) => ({ ...m, kind: 'mention' as const })),
    ...(entities.urls ?? []).map((u) => ({ ...u, kind: 'url' as const })),
    ...(entities.hashtags ?? []).map((h) => ({ ...h, kind: 'hashtag' as const })),
  ].sort((a, b) => a.start - b.start);
}

// ---------------------------------------------------------------------------
// Plain text rendering
// ---------------------------------------------------------------------------

/**
 * Render tweet text as plain text with expanded URLs and clean mentions.
 * Replaces t.co URLs with expanded URLs, keeps @mentions and #hashtags as-is.
 */
export function renderPlainText(text: string, entities?: TweetEntities): string {
  if (!entities) {
    return text;
  }

  const segments = collectSegments(entities);
  let cursor = 0;
  let output = '';

  for (const segment of segments) {
    if (segment.start < cursor || segment.end <= segment.start || segment.end > text.length) {
      continue;
    }

    output += text.slice(cursor, segment.start);

    if (segment.kind === 'url') {
      output += segment.expandedUrl;
    } else if (segment.kind === 'mention') {
      output += `@${segment.username}`;
    } else if (segment.kind === 'hashtag') {
      output += `#${segment.tag}`;
    } else {
      output += text.slice((segment as { start: number }).start, (segment as { end: number }).end);
    }

    cursor = segment.end;
  }

  output += text.slice(cursor);
  return output;
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

const MARKDOWN_ESCAPE = new Set(['\\', '`', '*', '_', '{', '}', '[', ']', '(', ')', '#', '+', '.', '!', '|', '>', '-']);

function escapeMarkdown(text: string): string {
  return [...text].map((ch) => (MARKDOWN_ESCAPE.has(ch) ? `\\${ch}` : ch)).join('');
}

/**
 * Render tweet text as markdown with clickable links.
 * - Mentions → [@username](https://x.com/username)
 * - URLs → [display](expanded_url)
 * - Hashtags → #tag (escaped)
 */
export function renderMarkdown(text: string, entities?: TweetEntities): string {
  if (!entities) {
    return text;
  }

  const segments = collectSegments(entities);
  let cursor = 0;
  let output = '';

  for (const segment of segments) {
    if (segment.start < cursor || segment.end <= segment.start || segment.end > text.length) {
      continue;
    }

    output += text.slice(cursor, segment.start);

    if (segment.kind === 'url') {
      output += `[${escapeMarkdown(segment.displayUrl)}](${segment.expandedUrl})`;
    } else if (segment.kind === 'mention') {
      output += `[@${escapeMarkdown(segment.username)}](https://x.com/${segment.username})`;
    } else if (segment.kind === 'hashtag') {
      output += escapeMarkdown(`#${segment.tag}`);
    } else {
      output += escapeMarkdown(text.slice((segment as { start: number }).start, (segment as { end: number }).end));
    }

    cursor = segment.end;
  }

  output += text.slice(cursor);
  return output;
}
