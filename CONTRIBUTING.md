# Contributing to ClaudePulse

Thank you for your interest in contributing to ClaudePulse! We welcome contributions from the community.

## How to Contribute

1. **Fork the repository**
2. **Create a feature branch** (`git checkout -b feature/amazing-feature`)
3. **Commit your changes** (`git commit -m 'Add amazing feature'`)
4. **Push to the branch** (`git push origin feature/amazing-feature`)
5. **Open a Pull Request**

## Development Setup

```bash
git clone https://github.com/substance0/claudepulse.git
cd claudepulse
npm install
npm run dev
```

## Development Guidelines

### Code Style

- Follow existing code patterns and conventions
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Keep functions focused and single-purpose

### Testing

> [!NOTE]
> No tests are implemented yet. Use dry run mode to verify configuration.

```bash
# Run with dry run mode to verify configuration
DRY_RUN=true npm start
```

### Code Quality

```bash
# Lint code (check syntax and style)
npm run lint
```

> [!TIP]
> Run linting before committing to ensure code quality standards

### Pull Request Guidelines

- **Clear description**: Explain what your PR does and why
- **Small focused changes**: Keep PRs focused on a single feature/fix
- **Update documentation**: Update README.md if needed
- **Test your changes**: Verify functionality works as expected
- **Use conventional commits**: Follow conventional commit format for proper versioning

## Project Structure

Before contributing, familiarize yourself with the project structure:

```text
claudepulse/
├── .taskmaster/               # Task Master AI project management
│   ├── tasks/                 # Task definitions and tracking
│   ├── docs/                  # PRD and planning documents
│   └── config.json            # Task Master configuration
├── .mcp.json                  # MCP server configuration (Task Master)
├── assets/                    # Logo and visual assets
├── docs/                      # Documentation
├── src/                       # Source code
│   ├── api/                   # Claude Agent SDK integration
│   ├── automation/            # Scheduling logic
│   ├── config/                # Configuration
│   └── utils/                 # Core utilities
├── CHANGELOG.md               # Version history
├── docker-compose.yml         # Container orchestration
├── Dockerfile                 # Container build configuration
├── ENVIRONMENT.md             # Environment variables reference
└── README.md                  # Project documentation
```

### Task Management

ClaudePulse uses [Task Master AI](https://github.com/cyanheads/task-master-ai) for project task management. All features, improvements, and bugs are tracked as structured tasks.

**MCP Integration:** The project includes a pre-configured `.mcp.json` with the Task Master MCP server, allowing AI assistants like Claude Code to interact with tasks directly through the MCP protocol.

**Viewing Tasks:**

```bash
# List all tasks (CLI)
task-master list

# View next available task
task-master next

# View specific task details
task-master show <task-id>
```

**Working with Tasks:**

When contributing, check existing tasks to:

- See what's already planned or in progress
- Understand task dependencies
- Align your contribution with project goals

All task files are stored in `.taskmaster/tasks/` and tracked in version control.

## Versioning and Release System

ClaudePulse uses an automated versioning and release system built on semantic versioning and conventional commits.

### Branch Strategy

- **`develop`**: Active development branch - no releases generated
- **`main`**: Production branch - automatic releases triggered by pushes

### Conventional Commits

All commits must follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```bash
# Examples
feat: add OAuth authentication support
fix: resolve session timeout handling
docs: update installation instructions
chore: bump dependencies to latest versions
```

**Commit Types and Version Impact:**

- `feat:` → Minor version bump (1.1.0 → 1.2.0)
- `fix:` → Patch version bump (1.1.0 → 1.1.1)
- `BREAKING CHANGE:` → Major version bump (1.1.0 → 2.0.0)
- `docs:`, `chore:`, `style:` → No version bump

### Automated Release Pipeline

When code is pushed to `main` branch:

1. **semantic-release** analyzes conventional commits
2. **Version** is automatically determined and updated in `package.json`
3. **GitHub Release** is created with auto-generated changelog
4. **Docker Images** are built and published to GitHub Container Registry
5. **CHANGELOG.md** is automatically updated

### Release Artifacts

Each release automatically creates:

- **GitHub Release** with semantic version tag (e.g., `v1.2.3`)
- **Docker Images** published to `ghcr.io/substance0/claudepulse`
  - `latest` (latest stable release)
  - `main` (latest main branch)
  - `v1.2.3` (specific version)
- **Multi-platform support**: `linux/amd64`, `linux/arm64`

### Development Workflow

```bash
# 1. Work on feature branch
git checkout -b feature/new-functionality
git commit -m "feat: add new functionality"

# 2. Create PR to develop branch
gh pr create --base develop --title "Add new functionality"

# 3. After review, merge to develop
# (No releases triggered on develop)

# 4. When ready for release, create PR from develop to main
gh pr create --base main --title "Release v1.2.0"

# 5. Merge to main triggers automatic release
# → Version bump, GitHub release, Docker images published
```

### Manual Release Prevention

To commit without triggering releases, add `[skip ci]` to commit messages:

```bash
git commit -m "docs: update readme [skip ci]"
```

### Version Management

- **No hardcoded versions**: All version references are dynamic
- **Single source of truth**: `package.json` managed by semantic-release
- **Dynamic badges**: README version badge pulls from GitHub releases API

### Release Configuration

The release system is configured via:

- **`.releaserc.json`**: semantic-release configuration
- **`.github/workflows/release.yml`**: Release workflow
- **`.github/workflows/docker-release.yml`**: Docker publishing workflow

## Need Help?

- 📖 Check the [documentation](README.md)
- 🐛 [Report bugs](https://github.com/substance0/claudepulse/issues)
- 💡 [Request features](https://github.com/substance0/claudepulse/issues)
- 💬 Ask questions in [GitHub Discussions](https://github.com/substance0/claudepulse/discussions)

## Code of Conduct

Please be respectful and constructive in all interactions. We're all here to build something great together!

---

**Thank you for contributing to ClaudePulse!**
