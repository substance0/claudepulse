# Contributing to ClaudePulse

Thank you for your interest in contributing to ClaudePulse! We welcome contributions from the community.

## How to Contribute

1. **Fork the repository**
2. **Set up your clone** (see [Development Setup](#development-setup))
3. **Create a feature branch** (`git switch -c feat/window-summary`)
4. **Commit using [conventional commits](#conventional-commits)**
5. **Open a pull request against `main`**

## Development Setup

Requirements: Node.js 22 or later, and the Claude Code CLI on your `PATH` to run pulses locally.

```bash
git clone https://github.com/substance0/claudepulse.git
cd claudepulse
npm install

# Secret scanning before each commit (see Secret Scanning below)
uv tool install pre-commit
pre-commit install
```

Run the app against your own account with a token from `claude setup-token`:

```bash
export CLAUDE_CODE_OAUTH_TOKEN=<token>
DRY_RUN=true npm start   # print the schedule without sending a pulse
npm run dev              # run with debug logging
```

## Checks

Every pull request runs the same checks as below; run them locally before pushing.

```bash
npm test               # node --test, built-ins only
npm run check:syntax   # node --check on every source, script and test file
```

Pull requests also lint the workflow files with actionlint and scan the whole history for secrets.

### Secret Scanning

[gitleaks](https://github.com/gitleaks/gitleaks) runs on each commit through the pre-commit hook, and on every pull request.

- `.gitleaks.toml` adds rules for the two secrets ClaudePulse handles, `CLAUDE_CODE_OAUTH_TOKEN` and Discord webhook URLs, on top of gitleaks' built-in rules. `test/gitleaks-rules.test.js` proves the rules match.
- `.gitleaksignore` lists findings that need no action, by fingerprint.

If the hook blocks a commit, remove the secret from the staged files. Use an env file (`claudepulse.env`, never committed) instead.

## Development Guidelines

- Follow existing code patterns and conventions
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Keep functions focused and single-purpose
- Add or update tests with every behaviour change

### Pull Request Guidelines

- **Clear description**: Explain what your PR does and why
- **Small focused changes**: Keep PRs focused on a single feature/fix
- **Update documentation**: Update README.md or ENVIRONMENT.md if needed
- **Green checks**: Tests, workflow lint and secret scan must pass

## Project Structure

```text
claudepulse/
├── .github/
│   ├── workflows/             # PR checks, release and image builds
│   └── dependabot.yml         # Dependency update policy
├── assets/                    # Logo and visual assets
├── docker/claude-cli/         # Pinned Claude Code CLI installed in the image
├── docs/                      # Workflow diagrams
├── scripts/                   # Build helpers (dev image versions)
├── src/                       # Source code
│   ├── core/                  # Configuration, logging, notifications
│   ├── features/
│   │   ├── claude/executor/   # Runs Claude Code for each pulse
│   │   └── scheduling/        # Scheduler and scheduling strategies
│   └── index.js               # Entry point and composition root
├── test/                      # Tests (node --test, no dependencies)
├── .gitleaks.toml             # Secret scanning rules
├── .pre-commit-config.yaml    # Pre-commit hooks
├── CHANGELOG.md               # Version history (generated)
├── docker-compose.yml         # Production-style deployment
├── docker-compose.dev.yml     # Local build and run
├── Dockerfile                 # Container build configuration
├── ENVIRONMENT.md             # Environment variables reference
└── README.md                  # Project documentation
```

## Versioning and Releases

ClaudePulse uses [semantic-release](https://github.com/semantic-release/semantic-release): merging to `main` decides the next version from the commit messages.

### Conventional Commits

All commits must follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```bash
feat: announce window reset times on a dedicated Discord webhook
fix: keep retrying when the Claude CLI exits before reporting usage
docs: document the release channels
build(deps): bump @anthropic-ai/claude-code in /docker/claude-cli
```

| Commit                                    | Release           |
| ----------------------------------------- | ----------------- |
| `feat:`                                   | minor (2.1.0)     |
| `fix:`, `perf:`                           | patch (2.0.1)     |
| `feat!:` or a `BREAKING CHANGE:` footer   | major (3.0.0)     |
| `docs:`, `chore:`, `ci:`, `build:`, `test:`, `refactor:` | none |

### What a Merge to `main` Does

1. **PR Checks** have already passed on the pull request.
2. **Release** (`release.yml`) runs the tests, then semantic-release. When the commits call for a release it tags `vX.Y.Z`, updates `package.json` and `CHANGELOG.md`, and creates the GitHub Release.
3. **Image builds** publish to `ghcr.io/substance0/claudepulse`: every commit gets an `edge` image, and a release also gets `latest` and its version tags.

The tags, snapshots of branches and release rebuilds are described in the README's [Release Channels](README.md#release-channels).

### Workflows

| Workflow                     | Runs on                    | Does                                      |
| ---------------------------- | -------------------------- | ----------------------------------------- |
| `pr-checks.yml`              | every pull request         | tests, actionlint, secret scan            |
| `release.yml`                | push to `main`             | tests, semantic-release, release image    |
| `docker-edge.yml`            | push to `main`             | `edge` image                              |
| `docker-snapshot.yml`        | on demand                  | `snapshot-<branch>` image                 |
| `docker-release-rebuild.yml` | on demand                  | rebuilds a release's image from its tag   |
| `docker-build.yml`           | called by the image workflows | shared test, build, push and provenance |

## Need Help?

- 📖 Check the [documentation](README.md)
- 🐛 [Report bugs](https://github.com/substance0/claudepulse/issues)
- 💡 [Request features](https://github.com/substance0/claudepulse/issues)

## Code of Conduct

Please be respectful and constructive in all interactions. We're all here to build something great together!

---

**Thank you for contributing to ClaudePulse!**
