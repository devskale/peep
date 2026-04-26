/**
 * AI inbox command for peep.
 *
 * Shows an AI-ranked inbox of mentions and DMs for triage.
 */

import type { Command } from 'commander';
import type { CliContext } from '../cli/shared.js';
import { getDb } from '../lib/local-cache.js';
import { buildInboxFromCache, scoreInbox, type InboxQueryOptions } from '../lib/ai-inbox.js';

export function registerInboxCommand(program: Command, ctx: CliContext): void {
  program
    .command('inbox')
    .description('AI-ranked inbox of mentions and DMs')
    .option('-n, --count <number>', 'Number of items to show', '20')
    .option('--kind <kind>', 'Filter: mentions, dm, or mixed', 'mixed')
    .option('--score', 'Refresh AI scores before listing (requires OPENAI_API_KEY)')
    .option('--hide-low-signal', 'Hide items scoring below 40')
    .option('--min-score <number>', 'Minimum score threshold', '0')
    .option('--json', 'Output as JSON')
    .action(
      async (cmdOpts: { count?: string; kind?: string; score?: boolean; hideLowSignal?: boolean; minScore?: string; json?: boolean }) => {
        const db = getDb();
        const isJson = Boolean(cmdOpts.json);
        const count = Number.parseInt(cmdOpts.count || '20', 10);
        const minScore = Number.parseInt(cmdOpts.minScore || '0', 10);

        const validKinds = ['mentions', 'dm', 'mixed'];
        const kind = validKinds.includes(cmdOpts.kind ?? '') ? (cmdOpts.kind as InboxQueryOptions['kind']) : 'mixed';

        // Score items with OpenAI if requested
        if (cmdOpts.score) {
          console.error(`${ctx.p('info')}Scoring inbox items with OpenAI...`);
          try {
            const result = await scoreInbox(db, { kind, limit: count });
            console.error(`${ctx.p('ok')}Scored ${result.scored} items with OpenAI.`);
          } catch (error) {
            console.error(
              `${ctx.p('warn')}AI scoring failed: ${error instanceof Error ? error.message : String(error)}`,
            );
            console.error('  Set OPENAI_API_KEY to enable AI scoring.');
          }
        }

        const inbox = buildInboxFromCache(db, {
          kind,
          minScore,
          hideLowSignal: cmdOpts.hideLowSignal,
          limit: count,
        });

        if (isJson) {
          console.log(JSON.stringify({ items: inbox.items, stats: inbox.stats }, null, 2));
        } else {
          if (inbox.items.length === 0) {
            console.log('No inbox items found.');
            console.log('Tip: Run commands like `peep mentions` or `peep home` to populate the cache, or import an archive.');
            return;
          }

          for (const item of inbox.items) {
            const scoreBar = '█'.repeat(Math.round(item.score / 10)) + '░'.repeat(10 - Math.round(item.score / 10));
            console.log(`\n${scoreBar} ${item.score}/100 [${item.source}]`);
            console.log(`  ${item.title}`);
            console.log(`  ${item.text.slice(0, 120)}${item.text.length > 120 ? '...' : ''}`);
            console.log(`  @${item.participant.username} · ${item.participant.followersCount ?? 0} followers`);
            if (item.summary) console.log(`  ${item.reasoning}`);
            if (item.createdAt) console.log(`  ${item.createdAt}`);
          }

          console.log(`\n${ctx.p('info')}${inbox.stats.total} items (${inbox.stats.openai} AI-scored, ${inbox.stats.heuristic} heuristic)`);
          if (cmdOpts.score) {
            console.log('  Use --score to refresh AI rankings.');
          }
        }
      },
    );
}
