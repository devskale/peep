/**
 * Local search command for peep.
 *
 * Full-text search over the locally cached tweets using SQLite FTS5.
 */

import type { Command } from 'commander';
import type { CliContext } from '../cli/shared.js';
import { getDb, type LocalSearchParams, searchLocalTweets } from '../lib/local-cache.js';

export function registerLocalSearchCommand(program: Command, ctx: CliContext): void {
  program
    .command('local-search')
    .description('Search locally cached tweets (offline, fast)')
    .argument('<query>', 'FTS5 search query')
    .option('-n, --count <number>', 'Number of results', '20')
    .option('--author <handle>', 'Filter by author username')
    .option('--since <date>', 'Filter from date (YYYY-MM-DD)')
    .option('--until <date>', 'Filter until date (YYYY-MM-DD)')
    .option('--json', 'Output as JSON')
    .action(
      async (
        query: string,
        cmdOpts: { count?: string; author?: string; since?: string; until?: string; json?: boolean },
      ) => {
        const db = getDb();
        const count = Number.parseInt(cmdOpts.count || '20', 10);
        const isJson = Boolean(cmdOpts.json);

        const params: LocalSearchParams = {
          query,
          limit: count,
          author: cmdOpts.author,
          since: cmdOpts.since,
          until: cmdOpts.until,
        };

        const tweets = searchLocalTweets(db, params);

        if (isJson) {
          console.log(JSON.stringify(tweets, null, 2));
        } else {
          if (tweets.length === 0) {
            console.log('No matching tweets found in local cache.');
            console.log(
              'Tip: Use `peep archive --import <path>` to import your archive, or run other commands to populate the cache.',
            );
          } else {
            ctx.printTweets(tweets, { json: false, emptyMessage: 'No results.' });
            console.log(`\n${ctx.p('info')}Showing ${tweets.length} results from local cache.`);
          }
        }
      },
    );
}
