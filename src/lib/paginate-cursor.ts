export type CursorPage<T> =
  | {
      success: true;
      items: T[];
      cursor?: string;
    }
  | {
      success: false;
      error: string;
    };

export type CursorPaginationResult<T> =
  | {
      success: true;
      items: T[];
      nextCursor?: string;
    }
  | {
      success: false;
      error: string;
      items?: T[];
      nextCursor?: string;
    };

export type CursorPaginationBase<T> = {
  /** Starting cursor for pagination (resume from previous fetch) */
  cursor?: string;
  /** Maximum number of pages to fetch. */
  maxPages?: number;
  /** Delay in milliseconds between page fetches. Default: 0 (no delay). */
  pageDelayMs?: number;
  /** Sleep function for inter-page delays. Required when `pageDelayMs > 0`. */
  sleep?: (ms: number) => Promise<void>;
  /** Extract a unique key from an item for deduplication. */
  getKey: (item: T) => string;
};

export type CursorPaginationWithLimit<T> = CursorPaginationBase<T> & {
  /**
   * Maximum number of items to collect. When set, fetchPage receives
   * `(count: number, cursor?: string)`.
   */
  limit: number;
  /** Page size for APIs that require a count parameter. Default: 20. */
  pageSize?: number;
  fetchPage: (count: number, cursor?: string) => Promise<CursorPage<T>>;
};

export type CursorPaginationUnlimited<T> = CursorPaginationBase<T> & {
  /**
   * No limit — paginate until cursor ends. fetchPage receives
   * `(cursor?: string)`.
   */
  limit?: undefined;
  fetchPage: (cursor?: string) => Promise<CursorPage<T>>;
};

/**
 * Paginate through cursor-based results with deduplication and optional item limit.
 *
 * - When `limit` is set, `fetchPage` receives `(count, cursor)` and the loop stops
 *   once `items.length >= limit`.
 * - When `limit` is omitted, `fetchPage` receives `(cursor)` only.
 * - Stops on: no cursor, cursor repeat, empty page, all-duplicate page, maxPages reached.
 */
export async function paginateCursor<T>(
  opts: CursorPaginationWithLimit<T> | CursorPaginationUnlimited<T>,
): Promise<CursorPaginationResult<T>> {
  const { maxPages, pageDelayMs = 0 } = opts;
  const pageSize = 'pageSize' in opts ? (opts.pageSize ?? 20) : 20;
  const limit = opts.limit;
  const seen = new Set<string>();
  const items: T[] = [];
  let cursor: string | undefined = opts.cursor;
  let pagesFetched = 0;
  const unlimited = limit === undefined;

  while (true) {
    // Inter-page delay (skip before first page)
    if (pagesFetched > 0 && pageDelayMs > 0 && opts.sleep) {
      await opts.sleep(pageDelayMs);
    }

    let page: CursorPage<T>;

    if (unlimited) {
      // Legacy signature: fetchPage(cursor?)
      page = await opts.fetchPage(cursor);
    } else {
      // With limit: fetchPage(count, cursor?)
      const remaining = limit - items.length;
      const count = Math.min(pageSize, remaining);
      page = await opts.fetchPage(count, cursor);
    }

    if (!page.success) {
      if (items.length > 0) {
        return { success: false, error: page.error, items, nextCursor: cursor };
      }
      return page;
    }
    pagesFetched += 1;

    let added = 0;
    for (const item of page.items) {
      const key = opts.getKey(item);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      items.push(item);
      added += 1;
      if (!unlimited && items.length >= limit) {
        break;
      }
    }

    const pageCursor = page.cursor;
    // For limited pagination, stop on empty pages or all-duplicate pages.
    // For unlimited pagination, only stop on cursor exhaustion (the caller
    // may need to skip pages that have no matching items).
    if (!pageCursor || pageCursor === cursor) {
      return { success: true, items, nextCursor: undefined };
    }
    if (!unlimited && (page.items.length === 0 || added === 0)) {
      return { success: true, items, nextCursor: undefined };
    }

    if (maxPages !== undefined && pagesFetched >= maxPages) {
      return { success: true, items, nextCursor: pageCursor };
    }

    cursor = pageCursor;
  }
}
