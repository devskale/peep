# bird → peep Rename Checklist

## Core Files
- [x] `package.json` - name, bin, scripts, env vars
- [x] `.gitignore` - binary name

## Documentation
- [x] `README.md` - all references
- [x] `CHANGELOG.md` - all references  
- [x] `docs/releasing.md`
- [x] `docs/testing.md`

## Source Code (src/)
- [x] `src/cli.ts` - comments
- [x] `src/cli/program.ts` - name, banner, examples
- [x] `src/cli/shared.ts` - BirdConfig → PeepConfig, paths, env vars
- [x] `src/lib/version.ts` - BIRD_VERSION → PEEP_VERSION
- [x] `src/lib/runtime-query-ids.ts` - env vars, paths
- [x] `src/lib/runtime-features.ts` - env vars, paths
- [x] `src/lib/cli-args.ts` - argv
- [x] `src/lib/twitter-client-timelines.ts` - debug env vars
- [x] `src/lib/twitter-client-news.ts` - debug env vars
- [x] `src/lib/twitter-client-utils.ts` - debug env vars
- [x] `src/commands/user-tweets.ts` - examples
- [x] `src/commands/query-ids.ts` - example

## Tests (tests/)
- [x] All test files - env vars, CLI invocations

## Validation
- [x] `pnpm install`
- [x] `pnpm run build:dist`
- [x] `pnpm run build:binary`
- [x] `pnpm test`
- [x] Verify `./peep --help` works
