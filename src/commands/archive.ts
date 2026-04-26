/**
 * Archive commands for peep.
 *
 * Import Twitter/X data exports into the local SQLite cache.
 */

import { Command } from 'commander';
import type { CliContext } from '../cli/shared.js';
import { findArchives, importArchive } from '../lib/archive-import.js';
import { getCacheStats, getDb } from '../lib/local-cache.js';

export function registerArchiveCommands(program: Command, ctx: CliContext): void {
  program
    .command('archive')
    .description('Import and manage local Twitter/X archive')
    .addCommand(
      new Command('find')
        .description('Find archive files on disk')
        .option('--json', 'Output as JSON')
        .action(async (cmdOpts: { json?: boolean }) => {
          return findArchivesAction(ctx, !!cmdOpts.json);
        }),
    )
    .addCommand(
      new Command('import')
        .description('Import archive from a zip file')
        .argument('<path>', 'Path to the archive zip file')
        .option('--json', 'Output as JSON')
        .action(async (archivePath: string, cmdOpts: { json?: boolean }) => {
          return importArchiveAction(ctx, archivePath, !!cmdOpts.json);
        }),
    );
}

async function findArchivesAction(ctx: CliContext, isJson: boolean): Promise<void> {
  console.error(`${ctx.p('info')}Searching for archive files...`);
  const archives = await findArchives();

  if (isJson) {
    console.log(JSON.stringify(archives, null, 2));
  } else if (archives.length === 0) {
    console.log('No archive files found.');
  } else {
    for (const a of archives) {
      const sizeMB = (a.size / (1024 * 1024)).toFixed(1);
      console.log(`  ${a.path} (${sizeMB} MB)`);
    }
  }
}

async function importArchiveAction(ctx: CliContext, archivePath: string, isJson: boolean): Promise<void> {
  console.error(`${ctx.p('info')}Importing archive from ${archivePath}...`);
  const db = getDb();
  const beforeStats = getCacheStats(db);

  try {
    const result = await importArchive(db, archivePath);
    const afterStats = getCacheStats(db);

    if (isJson) {
      console.log(JSON.stringify({ ...result, cacheBefore: beforeStats, cacheAfter: afterStats }, null, 2));
    } else {
      console.log(`${ctx.p('ok')}Archive imported successfully!`);
      console.log(`  Tweets:      ${result.tweets}`);
      console.log(`  Likes:       ${result.likes}`);
      console.log(`  Followers:   ${result.followers}`);
      console.log(`  Following:   ${result.following}`);
      console.log(`  Profiles:    ${result.profiles}`);
      console.log(`\n  Cache stats: ${afterStats.tweets} tweets, ${afterStats.profiles} profiles`);
    }
  } catch (error) {
    console.error(`${ctx.p('err')}Import failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
