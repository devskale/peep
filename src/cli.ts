#!/usr/bin/env node

/**
 * peep - CLI tool for posting tweets and replies
 *
 * Usage:
 *   peep tweet "Hello world!"
 *   peep reply <tweet-id> "This is a reply"
 *   peep reply <tweet-url> "This is a reply"
 *   peep read <tweet-id-or-url>
 */

import { createProgram, KNOWN_COMMANDS } from './cli/program.js';
import { createCliContext } from './cli/shared.js';
import { resolveCliInvocation } from './lib/cli-args.js';

const rawArgs: string[] = process.argv.slice(2);
const normalizedArgs: string[] = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;

const ctx = createCliContext(normalizedArgs);

const program = createProgram(ctx);

const { argv, showHelp } = resolveCliInvocation(normalizedArgs, KNOWN_COMMANDS);

if (showHelp) {
  program.outputHelp();
  process.exit(0);
}

if (argv) {
  program.parse(argv);
} else {
  program.parse(['node', 'peep', ...normalizedArgs]);
}
