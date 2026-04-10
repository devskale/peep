// General-purpose utilities used across the Twitter client.

export function normalizeQuoteDepth(value?: number): number {
  if (value === undefined || value === null) {
    return 1;
  }
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(0, Math.floor(value));
}

export function firstText(...values: Array<string | undefined | null>): string | undefined {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }
  return undefined;
}

export function collectTextFields(value: unknown, keys: Set<string>, output: string[]): void {
  if (!value) {
    return;
  }
  if (typeof value === 'string') {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectTextFields(item, keys, output);
    }
    return;
  }

  if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (keys.has(key)) {
        if (typeof nested === 'string') {
          const trimmed = nested.trim();
          if (trimmed) {
            output.push(trimmed);
          }
          continue;
        }
      }
      collectTextFields(nested, keys, output);
    }
  }
}

export function uniqueOrdered(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

// Re-export from split modules for backward compatibility.
export {
  type ContentState,
  extractArticleMetadata,
  extractArticleText,
  extractMedia,
  extractNoteTweetText,
  extractTweetText,
  renderContentState,
} from './twitter-client-content-state.js';
export {
  collectTweetResultsFromEntry,
  extractCursorFromInstructions,
  findTweetInInstructions,
  type MapTweetResultOptions,
  mapTweetResult,
  type ParseTweetsOptions,
  parseTweetsFromInstructions,
  parseUsersFromInstructions,
  unwrapTweetResult,
} from './twitter-client-tweet-mapping.js';
