/**
 * First-class starred/bookmark management commands for peep.
 *
 * Bookmarks are treated as items you care about and want to remember.
 * Supports notes, tags, priority, read/unread state, and revisit flags.
 */

import { Command } from 'commander';
import type { CliContext } from '../cli/shared.js';
import {
  getBookmarkPriorityCounts,
  getDb,
  listBookmarkFolders,
  listBookmarkTags,
  listStoredBookmarks,
  markBookmarkRead,
  markBookmarkUnread,
  setBookmarkFolder,
  setBookmarkNote,
  setBookmarkPriority,
  setBookmarkTags,
  toggleBookmarkRevisit,
} from '../lib/local-cache.js';

export function registerStarredCommands(program: Command, ctx: CliContext): void {
  const starred = new Command('starred')
    .description('Your starred bookmarks — things you care about')
    .option('-n, --count <number>', 'Number of items', '20')
    .option('--unread', 'Show only unread bookmarks')
    .option('--revisit', 'Show only items flagged for revisiting')
    .option('--tag <tag>', 'Filter by tag')
    .option('--folder <name>', 'Filter by folder')
    .option('--priority <level>', 'Filter by priority: low, normal, high, critical')
    .option('--author <handle>', 'Filter by author')
    .option('--search <query>', 'Search in bookmark text')
    .option('--sort <field>', 'Sort by: bookmarked_at, priority, tweet_created_at', 'bookmarked_at')
    .option('--json', 'Output as JSON')
    .action(async (cmdOpts) => {
      const db = getDb();
      const isJson = Boolean(cmdOpts.json);
      const count = Number.parseInt(cmdOpts.count || '20', 10);

      const validSorts = ['bookmarked_at', 'priority', 'tweet_created_at'];
      const sortBy = validSorts.includes(cmdOpts.sort) ? cmdOpts.sort : 'bookmarked_at';

      const bookmarks = listStoredBookmarks(db, {
        unreadOnly: cmdOpts.unread,
        revisitOnly: cmdOpts.revisit,
        tag: cmdOpts.tag,
        folder: cmdOpts.folder,
        priority: cmdOpts.priority,
        author: cmdOpts.author,
        searchQuery: cmdOpts.search,
        sortBy,
        limit: count,
      });

      if (isJson) {
        console.log(JSON.stringify(bookmarks, null, 2));
        return;
      }

      if (bookmarks.length === 0) {
        console.log('No starred bookmarks found.');
        console.log('  Tip: Use `peep bookmarks` to fetch from X, then manage them here.');
        return;
      }

      for (const b of bookmarks) {
        const priorityIcon =
          b.priority === 'critical' ? '🔴' : b.priority === 'high' ? '🟠' : b.priority === 'low' ? '⚪' : '🟢';
        const flags: string[] = [];
        if (b.isRevisit) {
          flags.push('🔄 revisit');
        }
        if (!b.isRead) {
          flags.push('📩 unread');
        }
        if (b.note) {
          flags.push(`📝 ${b.note}`);
        }
        if (b.tags) {
          flags.push(`🏷️ ${b.tags}`);
        }

        console.log(`\n${priorityIcon} @${b.authorUsername} — ${b.tweetCreatedAt ?? 'unknown date'}`);
        console.log(`  ${b.tweetText.slice(0, 140)}${b.tweetText.length > 140 ? '...' : ''}`);
        console.log(`  https://x.com/${b.authorUsername}/status/${b.tweetId}`);
        if (flags.length > 0) {
          console.log(`  ${flags.join('  ')}`);
        }
        if (b.folderName) {
          console.log(`  📁 ${b.folderName}`);
        }
      }

      console.log(`\n${ctx.p('info')}Showing ${bookmarks.length} of ${getBookmarkPriorityCounts(db).total} total.`);
    });

  starred
    .command('note')
    .description('Add/edit a note on a bookmark')
    .argument('<tweet-id-or-url>', 'Tweet ID or URL')
    .argument('<note-text>', 'Note text')
    .action(async (tweetIdOrUrl: string, noteText: string) => {
      const db = getDb();
      const tweetId = ctx.extractTweetId(tweetIdOrUrl);
      const ok = setBookmarkNote(db, tweetId, noteText);
      if (ok) {
        console.log(`${ctx.p('ok')}Note saved for ${tweetId}.`);
      } else {
        console.error(`${ctx.p('err')}Bookmark not found locally. Fetch it first with 'peep bookmarks'.`);
        process.exit(1);
      }
    });

  starred
    .command('tag')
    .description('Set tags on a bookmark (comma-separated)')
    .argument('<tweet-id-or-url>', 'Tweet ID or URL')
    .argument('<tags>', 'Tags (comma-separated, e.g. "bug,idea,follow-up")')
    .action(async (tweetIdOrUrl: string, tags: string) => {
      const db = getDb();
      const tweetId = ctx.extractTweetId(tweetIdOrUrl);
      const ok = setBookmarkTags(db, tweetId, tags);
      if (ok) {
        console.log(`${ctx.p('ok')}Tags set: ${tags}`);
      } else {
        console.error(`${ctx.p('err')}Bookmark not found locally. Fetch it first with 'peep bookmarks'.`);
        process.exit(1);
      }
    });

  starred
    .command('priority')
    .description('Set priority: low, normal, high, critical')
    .argument('<tweet-id-or-url>', 'Tweet ID or URL')
    .argument('<level>', 'Priority level')
    .action(async (tweetIdOrUrl: string, level: string) => {
      const db = getDb();
      const tweetId = ctx.extractTweetId(tweetIdOrUrl);
      const ok = setBookmarkPriority(db, tweetId, level);
      if (ok) {
        console.log(`${ctx.p('ok')}Priority set to '${level}' for ${tweetId}.`);
      } else {
        console.error(`${ctx.p('err')}Bookmark not found or invalid priority. Use: low, normal, high, critical.`);
        process.exit(1);
      }
    });

  starred
    .command('folder')
    .description('Assign a bookmark to a named folder')
    .argument('<tweet-id-or-url>', 'Tweet ID or URL')
    .argument('<folder-name>', 'Folder name')
    .action(async (tweetIdOrUrl: string, folderName: string) => {
      const db = getDb();
      const tweetId = ctx.extractTweetId(tweetIdOrUrl);
      const ok = setBookmarkFolder(db, tweetId, folderName);
      if (ok) {
        console.log(`${ctx.p('ok')}Moved to folder '${folderName}'.`);
      } else {
        console.error(`${ctx.p('err')}Bookmark not found locally. Fetch it first with 'peep bookmarks'.`);
        process.exit(1);
      }
    });

  starred
    .command('revisit')
    .description('Flag a bookmark for revisiting (toggle)')
    .argument('<tweet-id-or-url>', 'Tweet ID or URL')
    .action(async (tweetIdOrUrl: string) => {
      const db = getDb();
      const tweetId = ctx.extractTweetId(tweetIdOrUrl);
      const result = toggleBookmarkRevisit(db, tweetId);
      if (result === null) {
        console.error(`${ctx.p('err')}Bookmark not found locally.`);
        process.exit(1);
      }
      console.log(result ? `${ctx.p('ok')}Marked for revisiting 🔄` : `${ctx.p('ok')}Revisit flag cleared.`);
    });

  starred
    .command('mark-read')
    .description('Mark a bookmark as read')
    .argument('<tweet-id-or-url>', 'Tweet ID or URL')
    .action(async (tweetIdOrUrl: string) => {
      const db = getDb();
      const tweetId = ctx.extractTweetId(tweetIdOrUrl);
      const ok = markBookmarkRead(db, tweetId);
      if (ok) {
        console.log(`${ctx.p('ok')}Marked as read.`);
      } else {
        console.error(`${ctx.p('err')}Bookmark not found locally.`);
        process.exit(1);
      }
    });

  starred
    .command('unread')
    .description('Mark a bookmark as unread')
    .argument('<tweet-id-or-url>', 'Tweet ID or URL')
    .action(async (tweetIdOrUrl: string) => {
      const db = getDb();
      const tweetId = ctx.extractTweetId(tweetIdOrUrl);
      const ok = markBookmarkUnread(db, tweetId);
      if (ok) {
        console.log(`${ctx.p('ok')}Marked as unread.`);
      } else {
        console.error(`${ctx.p('err')}Bookmark not found locally.`);
        process.exit(1);
      }
    });

  starred
    .command('tags')
    .description('List all tags used on bookmarks')
    .option('--json', 'Output as JSON')
    .action(async (cmdOpts) => {
      const db = getDb();
      const tags = listBookmarkTags(db);
      if (cmdOpts.json) {
        console.log(JSON.stringify(tags, null, 2));
      } else if (tags.length === 0) {
        console.log('No tags found. Use `peep starred tag <tweet-id> <tags>` to add tags.');
      } else {
        console.log('Tags:');
        for (const tag of tags) {
          console.log(`  ${tag}`);
        }
      }
    });

  starred
    .command('folders')
    .description('List all folders used on bookmarks')
    .option('--json', 'Output as JSON')
    .action(async (cmdOpts) => {
      const db = getDb();
      const folders = listBookmarkFolders(db);
      if (cmdOpts.json) {
        console.log(JSON.stringify(folders, null, 2));
      } else if (folders.length === 0) {
        console.log('No folders found. Use `peep starred folder <tweet-id> <name>` to assign folders.');
      } else {
        console.log('Folders:');
        for (const f of folders) {
          console.log(`  ${f}`);
        }
      }
    });

  starred
    .command('stats')
    .description('Show bookmark statistics')
    .option('--json', 'Output as JSON')
    .action(async (cmdOpts) => {
      const db = getDb();
      const counts = getBookmarkPriorityCounts(db);
      if (cmdOpts.json) {
        console.log(JSON.stringify(counts, null, 2));
      } else {
        console.log(`${ctx.p('info')}Bookmark stats:`);
        console.log(`  Total:      ${counts.total}`);
        console.log(`  🔴 Critical: ${counts.critical}`);
        console.log(`  🟠 High:     ${counts.high}`);
        console.log(`  🟢 Normal:   ${counts.normal}`);
        console.log(`  ⚪ Low:      ${counts.low}`);
        console.log(`  📩 Unread:   ${counts.unread}`);
        console.log(`  🔄 Revisit:  ${counts.revisit}`);
      }
    });

  program.addCommand(starred);
}
