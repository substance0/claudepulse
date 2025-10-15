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

## Project Structure

Before contributing, familiarize yourself with the project structure:

```text
claudepulse/
├── assets/                    # Logo and visual assets
├── docs/                      # Documentation
├── src/                       # Source code
│   ├── api/                   # Claude CLI integration
│   ├── automation/            # Scheduling logic
│   ├── config/                # Configuration
│   └── utils/                 # Core utilities
├── CHANGELOG.md               # Version history
├── docker-compose.yml         # Container orchestration
├── Dockerfile                 # Container build configuration
├── ENVIRONMENT.md             # Environment variables reference
└── README.md                  # Project documentation
```

## Need Help?

- 📖 Check the [documentation](README.md)
- 🐛 [Report bugs](https://github.com/substance0/claudepulse/issues)
- 💡 [Request features](https://github.com/substance0/claudepulse/issues)
- 💬 Ask questions in [GitHub Discussions](https://github.com/substance0/claudepulse/discussions)

## Code of Conduct

Please be respectful and constructive in all interactions. We're all here to build something great together!

---

**Thank you for contributing to ClaudePulse!**
