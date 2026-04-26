/**
 * Profile reply inspection command for peep.
 *
 * Scans a user's recent replies to spot potential AI/bot behavior.
 * Inspired by birdclaw's `profiles replies` feature.
 */

import { Command } from 'commander';
import type { CliContext } from '../cli/shared.js';
import { normalizeHandle } from '../lib/normalize-handle.js';
import { TwitterClient } from '../lib/twitter-client.js';

export function registerProfileCommands(program: Command, ctx: CliContext): void {
  const profileCmd = new Command('profile')
    .description('Inspect user profiles');

  profileCmd
    .command('replies')
    .description("Scan a user's recent replies (moderation/anti-bot tool)")
    .argument('<handle-or-id>', 'Username or user ID')
    .option('-n, --count <number>', 'Number of replies to scan', '12')
    .option('--json', 'Output as JSON')
    .action(async (handleOrId: string, cmdOpts: { count?: string; json?: boolean }) => {
      const opts = program.opts();
      const timeoutMs = ctx.resolveTimeoutFromOptions(opts);
      const limit = Number.parseInt(cmdOpts.count || '12', 10);
      const isJson = Boolean(cmdOpts.json);

      const { cookies, warnings } = await ctx.resolveCredentialsFromOptions(opts);
      for (const w of warnings) console.error(`${ctx.p('warn')}${w}`);

      if (!cookies.authToken || !cookies.ct0) {
        console.error(`${ctx.p('err')}Missing required credentials`);
        process.exit(1);
      }

      const client = new TwitterClient({ cookies, timeoutMs });

      // Resolve user
      const handle = normalizeHandle(handleOrId);
      let userId: string | undefined;

      if (handle) {
        const lookup = await client.getUserIdByUsername(handle);
        if (lookup.success && lookup.userId) {
          userId = lookup.userId;
        }
      }

      if (!userId && /^\d+$/.test(handleOrId)) {
        userId = handleOrId;
      }

      if (!userId) {
        console.error(`${ctx.p('err')}Could not resolve profile: ${handleOrId}`);
        process.exit(1);
      }

      console.error(`${ctx.p('info')}Scanning recent replies from user ${userId}...`);

      // Fetch user tweets (more than needed to filter for replies)
      const scanSize = Math.min(Math.max(limit * 3, 20), 100);
      const result = await client.getUserTweets(userId, scanSize);

      if (!result.success || !result.tweets) {
        console.error(`${ctx.p('err')}Failed to fetch user tweets: ${'error' in result ? result.error : 'Unknown error'}`);
        process.exit(1);
      }

      // Filter to only replies
      const replies = result.tweets.filter((t) => t.inReplyToStatusId).slice(0, limit);

      if (isJson) {
        console.log(
          JSON.stringify(
            {
              profileId: userId,
              scannedCount: result.tweets.length,
              replyCount: replies.length,
              replies: replies.map((t) => ({
                id: t.id,
                text: t.text,
                createdAt: t.createdAt,
                replyToId: t.inReplyToStatusId,
                likeCount: t.likeCount,
                replyCount: t.replyCount,
              })),
            },
            null,
            2,
          ),
        );
      } else {
        if (replies.length === 0) {
          console.log('No recent replies found.');
          return;
        }

        console.log(`Found ${replies.length} replies (scanned ${result.tweets.length} tweets):\n`);

        for (const reply of replies) {
          console.log(`@${reply.author.username} → reply to ${reply.inReplyToStatusId}`);
          console.log(`  ${reply.text.slice(0, 200)}${reply.text.length > 200 ? '...' : ''}`);
          console.log(`  ❤️ ${reply.likeCount ?? 0}  💬 ${reply.replyCount ?? 0}  ${reply.createdAt ?? ''}`);
          console.log('─'.repeat(50));
        }

        // Simple bot-detection hints
        const avgLength = replies.reduce((sum, r) => sum + r.text.length, 0) / replies.length;
        const uniqueStarts = new Set(replies.map((r) => r.text.slice(0, 30).toLowerCase())).size;
        const similarCount = replies.length - uniqueStarts;

        console.log(`\n${ctx.p('info')}Scan summary:`);
        console.log(`  Average reply length: ${Math.round(avgLength)} chars`);
        console.log(`  Unique opening phrases: ${uniqueStarts}/${replies.length}`);

        if (similarCount > 0) {
          console.log(
            `${ctx.p('warn')}⚠️  ${similarCount} replies share similar openings — possible templated behavior.`,
          );
        }
      }
    });

  program.addCommand(profileCmd);
}
