# bird → peep Rename Checklist

## Core Files
- [ ] `package.json` - name, bin, scripts, env vars
- [ ] `.gitignore` - binary name

## Documentation
- [ ] `README.md` - all references
- [ ] `CHANGELOG.md` - all references  
- [ ] `docs/releasing.md`
- [ ] `docs/testing.md`

## Source Code (src/)
- [ ] `src/cli.ts` - comments
- [ ] `src/cli/program.ts` - name, banner, examples
- [ ] `src/cli/shared.ts` - BirdConfig → PeepConfig, paths, env vars
- [ ] `src/lib/version.ts` - BIRD_VERSION → PEEP_VERSION
- [ ] `src/lib/runtime-query-ids.ts` - env vars, paths
- [ ] `src/lib/runtime-features.ts` - env vars, paths
- [ ] `src/lib/cli-args.ts` - argv
- [ ] `src/lib/twitter-client-timelines.ts` - debug env vars
- [ ] `src/lib/twitter-client-news.ts` - debug env vars
- [ ] `src/lib/twitter-client-utils.ts` - debug env vars
- [ ] `src/commands/user-tweets.ts` - examples
- [ ] `src/commands/query-ids.ts` - example

## Tests (tests/)
- [ ] All test files - env vars, CLI invocations

## Validation
- [ ] `pnpm install`
- [ ] `pnpm run build:dist`
- [ ] `pnpm test`
- [ ] Verify `./peep --help` works
