# Release Checklist

## Pre-release

- [ ] All tests pass: `npx vitest run`
- [ ] TypeScript clean: `npx tsc --noEmit`
- [ ] Version bumped in `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`
- [ ] CHANGELOG.md updated with release notes
- [ ] No uncommitted changes: `git status` is clean

## Build verification

- [ ] `cargo tauri build` succeeds
- [ ] Smoke test on built binary:
  - Fresh launch shows WelcomeScreen
  - Create new company file
  - Enter a journal entry (debit + credit)
  - View trial balance (balanced)
  - View general ledger
  - Close and reopen file

## Release

- [ ] Commit all changes
- [ ] Tag: `git tag v0.x.y`
- [ ] Push: `git push && git push --tags`
- [ ] GitHub Actions release workflow builds all platforms
- [ ] Review draft release on GitHub, publish when ready
