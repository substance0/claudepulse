> [!NOTE]
> **Educational Project Disclaimer:** This is a personal project created for educational purposes and personal use, developed with AI generation tools. There is no clear intention for ongoing maintenance, support, or structured roadmapping. Use at your own discretion.

<div align="center">

<img src="assets/logo.png" alt="ClaudePulse Logo" width="250">

# ClaudePulse

**ClaudePulse maintains a steady pulse on your Claude Pro/Max sessions, automatically triggering new 5-hour cycles at reset boundaries to ensure you get every coding hour you pay for. Keep your development flow uninterrupted – ClaudePulse pulses in the background so you're always ready to code at full capacity.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=flat&logo=docker&logoColor=white)](https://www.docker.com/)
[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/substance0/claudepulse/releases)

[Quick Start](#quick-start-with-docker) • [Features](#features) • [Documentation](docs/) • [Support](#support)

</div>

## Acknowledgments

A special thanks to **[Maciek-roboblog](https://github.com/Maciek-roboblog)** for his work on **[claude-code-usage-monitor](https://github.com/Maciek-roboblog/claude-code-usage-monitor)** that helped implement the 5-hour cycle detection logic. Clever tool here!

## At a Glance

Here's the thing: Claude Code's 5-hour windows don't reset automatically when they expire. Each new window only starts when you send your first prompt after the reset time. The next limit is then computed based on your first prompt's hour (rounded down) + 5 hours. Miss that window, and you could lose precious coding hours when you finally sit down to work.

> [!WARNING]
> The "5-hour limit" can trigger before 5 actual hours due to token limits or other Claude-specific thresholds.

### Real-World Scenario

| Time | Without ClaudePulse | With ClaudePulse |
|------|---------------------|------------------|
| **9:00 AM** | 🚀 Start coding, excited about your project | 🚀 Start coding, excited about your project |
| **11:00 AM** | 😱 *"5-hour limit reached • resets 2pm"* | 😱 *"5-hour limit reached • resets 2pm"* |
| **2:00 PM** | ⏰ Reset time arrives, but you're in meetings | ⏰ Reset time arrives, but you're in meetings |
| **2:10 PM** | 💼 Still in meetings... | ✅ **ClaudePulse sends pulse automatically** |
| **4:00 PM** | 😞 Ready to code, but window starts NOW<br>*(Lost 2 hours you paid for)* | 😎 Ready to code with **3h remaining**<br>*(Maximum subscription value)* |

## Installation

<details open>
<summary><strong>🐳 Docker Registry (Recommended)</strong></summary>

```bash
# Pull and run from GitHub Container Registry with persistent volume
docker run -d --name claudepulse \
  -v claudepulse-data:/root/.claude \
  ghcr.io/substance0/claudepulse:latest

# Authenticate with Claude (one-time setup)
docker exec -it claudepulse claude
# In Claude CLI, run: /login
# Follow authentication prompts, then exit
```

Authentication persists between container restarts using the named volume.

</details>

<details>
<summary><strong>🐳 Docker Compose (Alternative)</strong></summary>

```bash
# Clone and build locally
git clone https://github.com/substance0/claudepulse.git
cd claudepulse
docker-compose up -d

# Authenticate with Claude (one-time setup)
docker exec -it claudepulse claude
# In Claude CLI, run: /login
# Follow authentication prompts, then exit
```

Use Docker Compose for local builds with persistent volumes if you want your authentication to persist between restarts.

</details>

<details>
<summary><strong>📦 NPM Global Install</strong></summary>

```bash
npm install -g claudepulse
claudepulse
```

Requires Node.js 18+ and Claude CLI to be installed and authenticated separately.

</details>

<details>
<summary><strong>💻 Local Development</strong></summary>

```bash
git clone https://github.com/substance0/claudepulse.git
cd claudepulse
npm install
npm start
```

Requires Claude CLI to be installed and authenticated separately.

</details>

## Features

| Feature | Description |
|---------|-------------|
| **Smart 5-Hour Scheduling** | Automatically detects and aligns with usage windows |
| **Claude CLI authentication auto-detection** | Ensures Claude CLI is authenticated before sending pulse messages to Claude servers |
| **Session Tracking** | Monitors active sessions across projects |
| **Intelligent Retry** | Exponential backoff with rate limit handling |
| **Comprehensive Logging** | Structured JSON or human-friendly logs |
| **Docker Ready** | One-command deployment with compose |
| **Zero Dependencies** | Uses only Node.js built-ins for security |

## Configuration

ClaudePulse uses environment variables for configuration. All settings have sensible defaults.

For comprehensive configuration documentation, see [ENVIRONMENT.md](ENVIRONMENT.md).

### Essential Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `PROMPT_TEXT` | `"ping"` | Pulse message sent to Claude |
| `MAX_RETRIES` | `3` | Maximum retry attempts on failure |
| `LOG_LEVEL` | `INFO` | Logging verbosity (ERROR, WARN, INFO, DEBUG) |
| `DRY_RUN` | `false` | Simulate pulses without sending to Claude |

### Advanced Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `RETRY_BACKOFF_MULTIPLIER` | `2` | Exponential backoff multiplier |
| `MAX_BACKOFF_MINUTES` | `30` | Maximum retry delay in minutes |
| `LOG_FORMAT` | `inline` | Log output format (`inline` or `json`) - independent of NODE_ENV |
| `NODE_ENV` | `production` | Environment mode |

## Docker Deployment

### Basic Container

```bash
# Build image
docker build -t claudepulse .

# Run container in background
docker run -d --name claudepulse claudepulse

# Exec into container to authenticate with Claude
docker exec -it claudepulse claude

# In Claude CLI, run /login slash command to authenticate with your Claude Pro/Max account
/login

# Follow authentication prompts, then exit Claude CLI
exit

# ClaudePulse will now automatically send pulse messages every 5 hours.

# View logs
docker logs -f claudepulse
```

### Docker Compose

Use the provided [`docker-compose.yml`](docker-compose.yml) file for easy deployment:

```bash
# Start services
docker-compose up -d
```

## Troubleshooting

<details>
<summary><strong>Authentication Failed</strong></summary>

Ensure Claude CLI is installed and authenticated

```bash
# Authenticate interactively
docker exec -it claudepulse claude
# Then run: /login
```

</details>

<details>
<summary><strong>Docker Container Exits</strong></summary>

Container may exit due to authentication or configuration issues

```bash
# View container logs
docker logs claudepulse

# Run in interactive mode for debugging
docker run -it claudepulse
```

</details>

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines on how to contribute to ClaudePulse.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

- GitHub Issues: [Report bugs or request features](https://github.com/substance0/claudepulse/issues)
- Documentation: [Full documentation](https://github.com/substance0/claudepulse/wiki)
- Workflow Diagrams: [Visual process flows](docs/workflow-diagrams.md)

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for a list of changes and version history.

## Standards Compliance

This project follows established standards for versioning and change documentation:

- **[Keep a Changelog v1.1.0](https://keepachangelog.com/en/1.1.0/)** - Changelog format and structure
- **[Semantic Versioning v2.0.0](https://semver.org/spec/v2.0.0.html)** - Version numbering scheme

