import type { GraphqlTweetResult, TweetMedia } from './twitter-client-types.js';
import { collectTextFields, firstText, uniqueOrdered } from './twitter-client-utils.js';

// ============================================================================
// Draft.js Content State Types and Parser for Long-form Tweets (X Articles)
// ============================================================================

/** Inline style range for text formatting (Bold, Italic, etc.) */
interface InlineStyleRange {
  offset: number;
  length: number;
  style: string;
}

/** Entity range linking a portion of text to an entity in entityMap */
interface EntityRange {
  key: number;
  offset: number;
  length: number;
}

/** A content block in Draft.js format */
interface ContentBlock {
  key: string;
  type: string;
  text: string;
  data?: {
    mentions?: Array<{ fromIndex: number; toIndex: number; text: string }>;
  };
  entityRanges?: EntityRange[];
  inlineStyleRanges?: InlineStyleRange[];
}

/** Entity data for different entity types */
interface EntityValue {
  type: string;
  mutability: string;
  data: {
    markdown?: string;
    url?: string;
    tweetId?: string;
  };
}

/** Entity map entry */
interface EntityMapEntry {
  key: string;
  value: EntityValue;
}

/** Draft.js content state structure */
export interface ContentState {
  blocks: ContentBlock[];
  entityMap?: Array<EntityMapEntry> | Record<string, EntityValue>;
}

/**
 * Renders a Draft.js content_state into readable markdown/text format.
 * Handles blocks (paragraphs, headers, lists) and entities (code blocks, links, tweets, dividers).
 */
export function renderContentState(contentState: ContentState | undefined): string | undefined {
  if (!contentState?.blocks || contentState.blocks.length === 0) {
    return undefined;
  }

  // Build entity lookup map from array/object formats
  const entityMap = new Map<number, EntityValue>();
  const rawEntityMap = contentState.entityMap ?? [];
  if (Array.isArray(rawEntityMap)) {
    for (const entry of rawEntityMap) {
      const key = Number.parseInt(entry.key, 10);
      if (!Number.isNaN(key)) {
        entityMap.set(key, entry.value);
      }
    }
  } else {
    for (const [key, value] of Object.entries(rawEntityMap)) {
      const keyNumber = Number.parseInt(key, 10);
      if (!Number.isNaN(keyNumber)) {
        entityMap.set(keyNumber, value);
      }
    }
  }

  const outputLines: string[] = [];
  let orderedListCounter = 0;
  let previousBlockType: string | undefined;

  for (const block of contentState.blocks) {
    // Reset ordered list counter when leaving ordered list context
    if (block.type !== 'ordered-list-item' && previousBlockType === 'ordered-list-item') {
      orderedListCounter = 0;
    }

    switch (block.type) {
      case 'unstyled': {
        // Plain paragraph - just output text with any inline formatting
        const text = renderBlockText(block, entityMap);
        if (text) {
          outputLines.push(text);
        }
        break;
      }

      case 'header-one': {
        const text = renderBlockText(block, entityMap);
        if (text) {
          outputLines.push(`# ${text}`);
        }
        break;
      }

      case 'header-two': {
        const text = renderBlockText(block, entityMap);
        if (text) {
          outputLines.push(`## ${text}`);
        }
        break;
      }

      case 'header-three': {
        const text = renderBlockText(block, entityMap);
        if (text) {
          outputLines.push(`### ${text}`);
        }
        break;
      }

      case 'unordered-list-item': {
        const text = renderBlockText(block, entityMap);
        if (text) {
          outputLines.push(`- ${text}`);
        }
        break;
      }

      case 'ordered-list-item': {
        orderedListCounter++;
        const text = renderBlockText(block, entityMap);
        if (text) {
          outputLines.push(`${orderedListCounter}. ${text}`);
        }
        break;
      }

      case 'blockquote': {
        const text = renderBlockText(block, entityMap);
        if (text) {
          outputLines.push(`> ${text}`);
        }
        break;
      }

      case 'atomic': {
        // Atomic blocks are placeholders for embedded entities
        const entityContent = renderAtomicBlock(block, entityMap);
        if (entityContent) {
          outputLines.push(entityContent);
        }
        break;
      }

      default: {
        // Fallback: just output the text
        const text = renderBlockText(block, entityMap);
        if (text) {
          outputLines.push(text);
        }
      }
    }

    previousBlockType = block.type;
  }

  const result = outputLines.join('\n\n');
  return result.trim() || undefined;
}

/**
 * Renders text content of a block, applying inline link entities.
 */
function renderBlockText(block: ContentBlock, entityMap: Map<number, EntityValue>): string {
  let text = block.text;

  // Handle LINK entities by appending URL in markdown format
  // Process in reverse order to not mess up offsets
  const linkRanges = (block.entityRanges ?? [])
    .filter((range) => {
      const entity = entityMap.get(range.key);
      return entity?.type === 'LINK' && entity.data.url;
    })
    .sort((a, b) => b.offset - a.offset);

  for (const range of linkRanges) {
    const entity = entityMap.get(range.key);
    if (entity?.data.url) {
      const linkText = text.slice(range.offset, range.offset + range.length);
      const markdownLink = `[${linkText}](${entity.data.url})`;
      text = text.slice(0, range.offset) + markdownLink + text.slice(range.offset + range.length);
    }
  }

  return text.trim();
}

/**
 * Renders an atomic block by looking up its entity and returning appropriate content.
 */
function renderAtomicBlock(block: ContentBlock, entityMap: Map<number, EntityValue>): string | undefined {
  const entityRanges = block.entityRanges ?? [];
  if (entityRanges.length === 0) {
    return undefined;
  }

  const entityKey = entityRanges[0].key;
  const entity = entityMap.get(entityKey);

  if (!entity) {
    return undefined;
  }

  switch (entity.type) {
    case 'MARKDOWN':
      // Code blocks and other markdown content - output as-is
      return entity.data.markdown?.trim();

    case 'DIVIDER':
      return '---';

    case 'TWEET':
      if (entity.data.tweetId) {
        return `[Embedded Tweet: https://x.com/i/status/${entity.data.tweetId}]`;
      }
      return undefined;

    case 'LINK':
      if (entity.data.url) {
        return `[Link: ${entity.data.url}]`;
      }
      return undefined;

    case 'IMAGE':
      // Images in atomic blocks - could extract URL if available
      return '[Image]';

    default:
      return undefined;
  }
}

export function extractArticleText(result: GraphqlTweetResult | undefined): string | undefined {
  const article = result?.article;
  if (!article) {
    return undefined;
  }

  const articleResult = article.article_results?.result ?? article;
  if (process.env.PEEP_DEBUG_ARTICLE === '1') {
    console.error(
      '[peep][debug][article] payload:',
      JSON.stringify(
        {
          rest_id: result?.rest_id,
          article: articleResult,
          note_tweet: result?.note_tweet?.note_tweet_results?.result ?? null,
        },
        null,
        2,
      ),
    );
  }

  const title = firstText(articleResult.title, article.title);

  // Try to render from rich content_state first (Draft.js format with blocks + entityMap)
  // This preserves code blocks, embedded tweets, markdown, etc.
  const contentState = article.article_results?.result?.content_state;
  const richBody = renderContentState(contentState);
  if (richBody) {
    // Rich content found - prepend title if not already included
    if (title) {
      const normalizedTitle = title.trim();
      const trimmedBody = richBody.trimStart();
      const headingMatches = [`# ${normalizedTitle}`, `## ${normalizedTitle}`, `### ${normalizedTitle}`];
      const hasTitle =
        trimmedBody === normalizedTitle ||
        trimmedBody.startsWith(`${normalizedTitle}\n`) ||
        headingMatches.some((heading) => trimmedBody.startsWith(heading));
      if (!hasTitle) {
        return `${title}\n\n${richBody}`;
      }
    }
    return richBody;
  }

  // Fallback to plain text extraction for articles without rich content_state
  let body = firstText(
    articleResult.plain_text,
    article.plain_text,
    articleResult.body?.text,
    articleResult.body?.richtext?.text,
    articleResult.body?.rich_text?.text,
    articleResult.content?.text,
    articleResult.content?.richtext?.text,
    articleResult.content?.rich_text?.text,
    articleResult.text,
    articleResult.richtext?.text,
    articleResult.rich_text?.text,
    article.body?.text,
    article.body?.richtext?.text,
    article.body?.rich_text?.text,
    article.content?.text,
    article.content?.richtext?.text,
    article.content?.rich_text?.text,
    article.text,
    article.richtext?.text,
    article.rich_text?.text,
  );

  if (body && title && body.trim() === title.trim()) {
    body = undefined;
  }

  if (!body) {
    const collected: string[] = [];
    collectTextFields(articleResult, new Set(['text', 'title']), collected);
    collectTextFields(article, new Set(['text', 'title']), collected);
    const unique = uniqueOrdered(collected);
    const filtered = title ? unique.filter((value) => value !== title) : unique;
    if (filtered.length > 0) {
      body = filtered.join('\n\n');
    }
  }

  if (title && body && !body.startsWith(title)) {
    return `${title}\n\n${body}`;
  }

  return body ?? title;
}

export function extractNoteTweetText(result: GraphqlTweetResult | undefined): string | undefined {
  const note = result?.note_tweet?.note_tweet_results?.result;
  if (!note) {
    return undefined;
  }

  return firstText(
    note.text,
    note.richtext?.text,
    note.rich_text?.text,
    note.content?.text,
    note.content?.richtext?.text,
    note.content?.rich_text?.text,
  );
}

export function extractTweetText(result: GraphqlTweetResult | undefined): string | undefined {
  return extractArticleText(result) ?? extractNoteTweetText(result) ?? firstText(result?.legacy?.full_text);
}

export function extractArticleMetadata(
  result: GraphqlTweetResult | undefined,
): { title: string; previewText?: string } | undefined {
  const article = result?.article;
  if (!article) {
    return undefined;
  }

  const articleResult = article.article_results?.result ?? article;
  const title = firstText(articleResult.title, article.title);
  if (!title) {
    return undefined;
  }

  // preview_text is available in home timeline responses
  const previewText = firstText(articleResult.preview_text, article.preview_text);

  return { title, previewText };
}

export function extractMedia(result: GraphqlTweetResult | undefined): TweetMedia[] | undefined {
  // Prefer extended_entities (has video info), fall back to entities
  const rawMedia = result?.legacy?.extended_entities?.media ?? result?.legacy?.entities?.media;
  if (!rawMedia || rawMedia.length === 0) {
    return undefined;
  }

  const media: TweetMedia[] = [];

  for (const item of rawMedia) {
    if (!item.type || !item.media_url_https) {
      continue;
    }

    const mediaItem: TweetMedia = {
      type: item.type,
      url: item.media_url_https,
    };

    // Get dimensions from largest available size
    const sizes = item.sizes;
    if (sizes?.large) {
      mediaItem.width = sizes.large.w;
      mediaItem.height = sizes.large.h;
    } else if (sizes?.medium) {
      mediaItem.width = sizes.medium.w;
      mediaItem.height = sizes.medium.h;
    }

    // For thumbnails/previews
    if (sizes?.small) {
      mediaItem.previewUrl = `${item.media_url_https}:small`;
    }

    // Extract video URL for video/animated_gif
    if ((item.type === 'video' || item.type === 'animated_gif') && item.video_info?.variants) {
      // Prefer highest bitrate MP4, fall back to first MP4 when bitrate is missing.
      const mp4Variants = item.video_info.variants.filter(
        (v): v is { bitrate?: number; content_type: string; url: string } =>
          v.content_type === 'video/mp4' && typeof v.url === 'string',
      );
      const mp4WithBitrate = mp4Variants
        .filter((v): v is { bitrate: number; content_type: string; url: string } => typeof v.bitrate === 'number')
        .sort((a, b) => b.bitrate - a.bitrate);
      const selectedVariant = mp4WithBitrate[0] ?? mp4Variants[0];

      if (selectedVariant) {
        mediaItem.videoUrl = selectedVariant.url;
      }

      if (typeof item.video_info.duration_millis === 'number') {
        mediaItem.durationMs = item.video_info.duration_millis;
      }
    }

    media.push(mediaItem);
  }

  return media.length > 0 ? media : undefined;
}
