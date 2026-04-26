/**
 * Cache management commands for peep.
 */

import type { Command } from 'commander';
import type { CliContext } from '../cli/shared.js';
import { getDb, getCacheStats, getCacheDbPath } from '../lib/local-cache.js';

export function registerCacheCommand(program: Command, ctx: CliContext): void {
  program
    .command('cache')
    .description('Local cache management')
    .option('--stats', 'Show cache statistics')
    .option('--json', 'Output as JSON')
    .action(async (cmdOpts: { stats?: boolean; json?: boolean }) => {
      const db = getDb();
      const isJson = Boolean(cmdOpts.json);
      const stats = getCacheStats(db);
      const dbPath = getCacheDbPath();

      if (isJson) {
        console.log(JSON.stringify({ dbPath, ...stats }, null, 2));
      } else {
        console.log(`${ctx.l('source')}Local cache: ${dbPath}`);
        console.log(`  Tweets:     ${stats.tweets}`);
        console.log(`  Profiles:   ${stats.profiles}`);
        console.log(`  Bookmarks:  ${stats.bookmarks}`);
        console.log(`  Likes:      ${stats.likes}`);
        console.log(`  Blocks:     ${stats.blocks}`);
        console.log(`  Mutes:      ${stats.mutes}`);
        console.log(`  AI Scores:  ${stats.aiScores}`);
      }
    });
}
