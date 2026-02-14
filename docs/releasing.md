# Releasing peep

Target destinations:
- npm: `@devskale/peep`
- Homebrew: tap formula in `devskale/homebrew-tap` (e.g., `peep.rb`)

## Checklist (npm + GitHub)
1) Version bump
   - Update `package.json` `version` (semver, e.g., `0.5.0`).
   - Update `CHANGELOG.md` and tag the release section.

2) Clean build & tests
   - `pnpm install`
   - `pnpm test`
   - `pnpm run build`

3) Publish to npm (scoped)
   - Ensure you are logged in (`npm whoami`).
   - `npm publish --access public` (from repo root). Package name is `@devskale/peep`.
   - Verify:
     - `npm view @devskale/peep version`
     - `npx -y @devskale/peep@<version> --help`

4) Git tag & GitHub release
   - `git tag v<version> && git push origin v<version>`
   - Create GitHub release from the tag. Include changelog notes and attach optional binary (see below).

## Optional: attach compiled binary
If you want a single-file binary for Homebrew/GitHub assets:
- Build: `pnpm run binary` (uses Bun to produce `./peep`).
- Upload `peep` to the GitHub release and use it for the Homebrew tarball.

## Homebrew tap update (devskale/homebrew-tap)
1) Package the binary
   - From repo root: `tar -czf peep-macos-universal-v<version>.tar.gz peep`
   - Compute SHA: `shasum -a 256 peep-macos-universal-v<version>.tar.gz`

2) Update formula in tap repo
   - File: `homebrew-tap/peep.rb` (create if absent). Model it after `poltergeist.rb`.
   - Fields to update:
     - `url "https://github.com/devskale/peep/releases/download/v<version>/peep-macos-universal-v<version>.tar.gz"`
     - `sha256 "<calculated_sha>"`
     - `version "<version>"`
   - Install block: `bin.install "peep"`
   - `test do`: minimal `assert_match "<version>", shell_output("#{bin}/peep --version")`

3) Push tap changes
   - `git add peep.rb && git commit -m "peep 0.1.0" && git push`

## Release order suggestion
1) Merge to `main` and tag.
2) Publish npm.
3) Build binary, upload to GitHub release.
4) Update Homebrew tap with new URL/SHA.

## Notes
- Scoped npm name (`@devskale/peep`) requires `--access public` on first publish.
- Homebrew formula assumes macOS universal binary; adjust URL/name if you ship per-arch.
- Config defaults (JSON5) and Safari/Chrome/Firefox cookie selection are documented in `README.md` — keep that in sync for each release.
