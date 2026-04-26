/**
 * Block and mute commands for peep.
 *
 * Local-first blocklist and mutelist management with optional live transport.
 */

import type { Command } from 'commander';
import type { CliContext } from '../cli/shared.js';
import {
  addBlock,
  addMute,
  getDb,
  listBlocks,
  listMutes,
  removeBlock,
  removeMute,
  storeUser,
} from '../lib/local-cache.js';
import type { TwitterUser } from '../lib/twitter-client-types.js';

const HANDLE_REGEX = /^@[a-zA-Z0-9_]{1,15}$/;
const NUMERIC_ID_REGEX = /^\d+$/;
const AT_PREFIX_REGEX = /^@/;
const MARKDOWN_BULLET_REGEX = /^[-*]\s+/;
const X_URL_HANDLE_REGEX = /x\.com\/([^/]+)/;

export function registerBlockMuteCommands(program: Command, ctx: CliContext): void {
  // ---- blocks ----
  program
    .command('blocks')
    .description('Manage local blocklist')
    .option('--add <handle-or-id>', 'Add a profile to the blocklist')
    .option('--remove <handle-or-id>', 'Remove a profile from the blocklist')
    .option('--import-file <path>', 'Import blocklist from a file (handles/URLs, one per line)')
    .option('--json', 'Output as JSON')
    .action(async (cmdOpts: { add?: string; remove?: string; importFile?: string; json?: boolean }) => {
      const db = getDb();
      const isJson = Boolean(cmdOpts.json);

      if (cmdOpts.importFile) {
        return importBlocklist(db, cmdOpts.importFile, ctx, isJson);
      }

      if (cmdOpts.add) {
        return addBlockEntry(db, cmdOpts.add, ctx);
      }

      if (cmdOpts.remove) {
        return removeBlockEntry(db, cmdOpts.remove, ctx);
      }

      // Default: list blocks
      const blocks = listBlocks(db);
      if (isJson) {
        console.log(JSON.stringify(blocks, null, 2));
      } else if (blocks.length === 0) {
        console.log('No blocked profiles.');
      } else {
        for (const b of blocks) {
          console.log(`@${b.username} (${b.name}) — blocked ${b.createdAt}`);
        }
      }
    });

  // ---- ban (alias for blocks --add) ----
  program
    .command('ban')
    .description('Block a user (alias for blocks --add)')
    .argument('<handle-or-id>', 'Username or user ID to block')
    .action(async (handleOrId: string) => {
      const db = getDb();
      await addBlockEntry(db, handleOrId, ctx);
    });

  // ---- unban (alias for blocks --remove) ----
  program
    .command('unban')
    .description('Unblock a user (alias for blocks --remove)')
    .argument('<handle-or-id>', 'Username or user ID to unblock')
    .action(async (handleOrId: string) => {
      const db = getDb();
      await removeBlockEntry(db, handleOrId, ctx);
    });

  // ---- mutes ----
  program
    .command('mutes')
    .description('Manage local mutelist')
    .option('--add <handle-or-id>', 'Add a profile to the mutelist')
    .option('--remove <handle-or-id>', 'Remove a profile from the mutelist')
    .option('--json', 'Output as JSON')
    .action(async (cmdOpts: { add?: string; remove?: string; json?: boolean }) => {
      const db = getDb();
      const isJson = Boolean(cmdOpts.json);

      if (cmdOpts.add) {
        return addMuteEntry(db, cmdOpts.add, ctx);
      }

      if (cmdOpts.remove) {
        return removeMuteEntry(db, cmdOpts.remove, ctx);
      }

      // Default: list mutes
      const mutes = listMutes(db);
      if (isJson) {
        console.log(JSON.stringify(mutes, null, 2));
      } else if (mutes.length === 0) {
        console.log('No muted profiles.');
      } else {
        for (const m of mutes) {
          console.log(`@${m.username} (${m.name}) — muted ${m.createdAt}`);
        }
      }
    });

  // ---- mute (alias) ----
  program
    .command('mute')
    .description('Mute a user')
    .argument('<handle-or-id>', 'Username or user ID to mute')
    .action(async (handleOrId: string) => {
      const db = getDb();
      await addMuteEntry(db, handleOrId, ctx);
    });

  // ---- unmute (alias) ----
  program
    .command('unmute')
    .description('Unmute a user')
    .argument('<handle-or-id>', 'Username or user ID to unmute')
    .action(async (handleOrId: string) => {
      const db = getDb();
      await removeMuteEntry(db, handleOrId, ctx);
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveProfile(handleOrId: string, ctx: CliContext): Promise<TwitterUser | null> {
  const { cookies, warnings } = await ctx.resolveCredentialsFromOptions({} as never);
  for (const w of warnings) {
    console.error(`${ctx.p('warn')}${w}`);
  }

  if (!cookies.authToken || !cookies.ct0) {
    return null;
  }

  const { TwitterClient } = await import('../lib/twitter-client.js');
  const client = new TwitterClient({ cookies, timeoutMs: 10000 });

  // Try as username first
  const handle = handleOrId.replace(AT_PREFIX_REGEX, '');
  if (HANDLE_REGEX.test(handle)) {
    const result = await client.getUserIdByUsername(handle);
    if (result.success && result.userId) {
      return {
        id: result.userId,
        username: result.username ?? handle,
        name: result.username ?? handle,
      };
    }
  }

  // Try as numeric ID
  if (NUMERIC_ID_REGEX.test(handleOrId)) {
    return { id: handleOrId, username: handleOrId, name: handleOrId };
  }

  // Try extracting ID from URL
  const urlMatch = X_URL_HANDLE_REGEX.exec(handleOrId);
  if (urlMatch) {
    const result = await client.getUserIdByUsername(urlMatch[1]);
    if (result.success && result.userId) {
      return {
        id: result.userId,
        username: result.username ?? urlMatch[1],
        name: result.username ?? urlMatch[1],
      };
    }
  }

  return null;
}

async function addBlockEntry(db: ReturnType<typeof getDb>, handleOrId: string, ctx: CliContext): Promise<void> {
  const profile = await resolveProfile(handleOrId, ctx);
  if (!profile) {
    // Store with raw handle as ID if resolution fails
    const id = handleOrId.replace(AT_PREFIX_REGEX, '');
    storeUser(db, { id, username: id, name: id });
    addBlock(db, id);
    console.log(`${ctx.p('ok')}Blocked ${id} (local only — could not resolve profile)`);
    return;
  }

  storeUser(db, profile);
  addBlock(db, profile.id);
  console.log(`${ctx.p('ok')}Blocked @${profile.username} (${profile.name})`);
}

async function removeBlockEntry(db: ReturnType<typeof getDb>, handleOrId: string, ctx: CliContext): Promise<void> {
  const profile = await resolveProfile(handleOrId, ctx);
  const id = profile?.id ?? handleOrId.replace(AT_PREFIX_REGEX, '');
  removeBlock(db, id);
  console.log(`${ctx.p('ok')}Unblocked ${profile ? `@${profile.username}` : id}`);
}

async function addMuteEntry(db: ReturnType<typeof getDb>, handleOrId: string, ctx: CliContext): Promise<void> {
  const profile = await resolveProfile(handleOrId, ctx);
  if (!profile) {
    const id = handleOrId.replace(AT_PREFIX_REGEX, '');
    storeUser(db, { id, username: id, name: id });
    addMute(db, id);
    console.log(`${ctx.p('ok')}Muted ${id} (local only — could not resolve profile)`);
    return;
  }

  storeUser(db, profile);
  addMute(db, profile.id);
  console.log(`${ctx.p('ok')}Muted @${profile.username} (${profile.name})`);
}

async function removeMuteEntry(db: ReturnType<typeof getDb>, handleOrId: string, ctx: CliContext): Promise<void> {
  const profile = await resolveProfile(handleOrId, ctx);
  const id = profile?.id ?? handleOrId.replace(AT_PREFIX_REGEX, '');
  removeMute(db, id);
  console.log(`${ctx.p('ok')}Unmuted ${profile ? `@${profile.username}` : id}`);
}

async function importBlocklist(
  db: ReturnType<typeof getDb>,
  filePath: string,
  ctx: CliContext,
  isJson: boolean,
): Promise<void> {
  const { readFileSync } = await import('node:fs');
  const content = readFileSync(filePath, 'utf8');
  const lines = content
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  if (lines.length === 0) {
    console.log('No entries found in blocklist file.');
    return;
  }

  let added = 0;
  let failed = 0;

  for (const line of lines) {
    // Strip markdown bullets
    const cleaned = line.replace(MARKDOWN_BULLET_REGEX, '').trim();
    // Extract handle from URL if present
    const handleMatch = X_URL_HANDLE_REGEX.exec(cleaned);
    const handle = handleMatch ? handleMatch[1] : cleaned.replace(AT_PREFIX_REGEX, '');

    if (!handle) {
      failed++;
      continue;
    }

    storeUser(db, { id: handle, username: handle, name: handle });
    addBlock(db, handle);
    added++;
  }

  if (isJson) {
    console.log(JSON.stringify({ added, failed, total: lines.length }, null, 2));
  } else {
    console.log(`${ctx.p('ok')}Imported ${added} entries (${failed} failed) from ${filePath}`);
  }
}
