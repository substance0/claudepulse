# ClaudePulse

A Node 22 ESM container that sends a small `claude -p` pulse to open Claude usage windows. It has no npm runtime dependencies, and its tests use `node:test` only: run them with `npm test`.

## Rules for every change

- Commits follow Conventional Commits, which drive semantic-release: `feat:` makes a minor release, `fix:` a patch, and `BREAKING CHANGE` or `!` a major. Use `docs:`, `refactor:`, `test:`, `ci:` or `chore:` when no release is wanted.
- Never add attribution, session links or `Co-authored-by` lines for Claude to a commit or a pull request description.
- Work on a branch and open a pull request. Never push to `main`.
- Never edit `CHANGELOG.md`, or the version in `package.json` or `package-lock.json`: the release bot owns them.
- Write the failing test first, then the change, then run the whole suite.
- Add no runtime dependency.
- Keep secrets out of files, logs and messages: tokens and webhook URLs come from the environment.
- Documentation and code comments describe what the code does now, never what it replaced. Use no emoji.
