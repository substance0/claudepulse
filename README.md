> [!NOTE]
> This is a personal project I’m using to learn and experiment (with some AI help). It’s not really maintained, doesn’t have a roadmap, and comes with no guarantees—use at your own risk.

<div align="center">

<img src="assets/logo.png" alt="ClaudePulse Logo" width="250">

# ClaudePulse

**ClaudePulse maintains a steady pulse on your Claude Pro/Max sessions, automatically triggering new 5-hour cycles at reset boundaries to ensure you get every coding hour you pay for. Keep your development flow uninterrupted – ClaudePulse pulses in the background so you're always ready to code at full capacity.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/docker-%230db7ed.svg?style=flat&logo=docker&logoColor=white)](https://www.docker.com/)
[![Version](https://img.shields.io/github/v/release/substance0/claudepulse)](https://github.com/substance0/claudepulse/releases)

[Installation](#installation) • [Features](#features) • [Configuration](#configuration) • [Support](#support) • [Changelog](#changelog) • [Contributing](#contributing) • [Licence](#licence)

</div>

## At a Glance

Here's the thing: Claude Code's 5-hour windows don't reset automatically when they expire. Each new window only starts when you send your first prompt after the reset time. The next limit is then computed based on your first prompt's hour (rounded down) + 5 hours. Miss that window, and you could lose precious coding hours when you finally sit down to work.

> [!WARNING]
> The "5-hour limit" can trigger before 5 actual hours due to token limits or other Claude-specific thresholds. See more details [on Claude's website](https://support.claude.com/en/articles/8324991-about-claude-s-pro-plan-usage).

### Real-World Scenario

| Time         | Without ClaudePulse                                                      | With ClaudePulse                                                         |
| ------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| **9:00 AM**  | 🚀 Start coding, excited about your project                              | 🚀 Start coding, excited about your project                              |
| **11:00 AM** | 😱 _"5-hour limit reached • resets 2pm"_                                 | 😱 _"5-hour limit reached • resets 2pm"_                                 |
| **2:00 PM**  | ⏰ Reset time arrives, but you're in meetings                            | ⏰ Reset time arrives, but you're in meetings                            |
| **2:10 PM**  | 💼 Still in meetings...                                                  | ✅ **ClaudePulse sends pulse automatically**                             |
| **4:00 PM**  | 😞 Ready to code, but window starts NOW<br>_(Lost 2 hours you paid for)_ | 😎 Ready to code with **3h remaining**<br>_(Maximum subscription value)_ |

## Installation

<details open>
<summary><strong>🐳 Docker Registry (Recommended)</strong></summary>

```bash
docker run -d --name claudepulse -e TZ=America/New_York -v claudepulse-data:/home/claudepulse/.claude ghcr.io/substance0/claudepulse:latest
```

**💡 Timezone (Optional):** Set the `TZ` environment variable to your local timezone for better log readability. Replace `America/New_York` with your timezone (e.g., `Europe/London`, `Asia/Tokyo`). Default is `UTC`. [Find your timezone](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).

---

**Authentication:**

```bash
# If you haven't pre-authenticated using 'claude /login' command:
# ClaudePulse will display an OAuth authorization URL in the logs
docker logs claudepulse

# Open the OAuth URL in your browser to authenticate
# Once authenticated, pass the verification code to complete authentication:
docker exec -it claudepulse npm run oauth-verify <verification_code>

# ClaudePulse will now automatically send pulse messages based on the detected scheduled strategy.
```

Authentication will persist between container restarts using the `claudepulse-data` Docker volume.

**Stopping ClaudePulse:**

```bash
# Stop the container
docker stop claudepulse

# Remove the container (keeps volumes)
docker rm claudepulse
```

</details>

<details>
<summary><strong>🐳 Docker Compose (Alternative)</strong></summary>

**Download docker-compose.yml:**

```bash
# Download the compose file
curl -O https://raw.githubusercontent.com/substance0/claudepulse/main/docker-compose.yml

# Or clone the entire repository
git clone https://github.com/substance0/claudepulse.git
cd claudepulse
```

**Start with Docker Compose:**

```bash
docker-compose up -d
```

**💡 Timezone (Optional):** Edit `docker-compose.yml` to set the `TZ` environment variable to your local timezone for better log readability. Default is `UTC`.

---

**Authentication:**

```bash
# If you haven't pre-authenticated using 'claude /login' command:
# ClaudePulse will display an OAuth authorization URL in the logs
docker logs claudepulse

# Open the OAuth URL in your browser to authenticate
# Once authenticated, pass the verification code to complete authentication:
docker exec -it claudepulse npm run oauth-verify <verification_code>

# ClaudePulse will now automatically send pulse messages based on the detected scheduled strategy.
```

Authentication will persist between container restarts using the `claudepulse-data` Docker volume.

**Stopping ClaudePulse:**

```bash
# Stop the Docker Compose stack
docker-compose down

# Or stop individual container
docker stop claudepulse
```

</details>

<details>
<summary><strong>💻 Local Development</strong></summary>

**Clone and Setup:**

```bash
git clone https://github.com/substance0/claudepulse.git
cd claudepulse
npm install
```

**Run with Node.js:**

```bash
npm start
```

**Or build and run locally with Docker:**

```bash
# Build from Dockerfile
docker-compose -f docker-compose.dev.yml up -d

# View logs
docker logs claudepulse-dev
```

**Requirements:** Node.js 18+ or Docker/Podman

---

**Authentication:**

**💡 Recommended:** Pre-authenticate with Claude CLI (`claude /login`) before running ClaudePulse. This allows ClaudePulse to reuse existing credentials automatically.

If not pre-authenticated, ClaudePulse will handle OAuth flow:

```bash
# ClaudePulse will display an OAuth authorization URL in the logs
# Open the OAuth URL in your browser to authenticate

# Once authenticated, pass the verification code to complete authentication:
npm run oauth-verify <verification_code>

# ClaudePulse will now automatically send pulse messages
```

</details>

## Features

| Feature                            | Description                                                                                                                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Smart 5-Hour Cycle Detection**   | Automatically detects Claude Pro/Max 5-hour windows from session history and session limit messages                                                                                                 |
| **Docker & Compose Ready**         | One-command deployment with volume persistence for authentication credentials                                                                                                                       |
| **OAuth 2.0 with PKCE**            | Secure authentication flow with browser-based authorization and verification code exchange                                                                                                          |
| **Credential Auto-Detection**      | Watches for credential changes during startup and automatically resumes when authentication completes                                                                                               |
| **Intelligent Scheduling**         | Adapts to session limit signals, respects configured hours, tracks session history, or uses reliable defaults ([see strategies details](docs/workflow-diagrams.md#3-scheduling-strategy-selection)) |
| **Immediate Post-Auth Pulse**      | If the current 5-hour window cannot be detected, sends verification pulse immediately after OAuth completion to confirm connection and trigger new 5h window                                        |
| **Intelligent Retry with Backoff** | Exponential backoff (configurable multiplier & max delay) with automatic session limit handling                                                                                                     |
| **Minimal Dependencies**           | Only depends on official Anthropic Claude Agent SDK - no unnecessary bloat                                                                                                                          |

## Configuration

ClaudePulse uses environment variables for configuration. All settings have sensible defaults.

For comprehensive configuration documentation, see [ENVIRONMENT.md](ENVIRONMENT.md).

### Essential Settings

| Variable      | Default  | Description                                  |
| ------------- | -------- | -------------------------------------------- |
| `PROMPT_TEXT` | `"ping"` | Pulse message sent to Claude                 |
| `MAX_RETRIES` | `3`      | Maximum retry attempts on failure            |
| `LOG_LEVEL`   | `INFO`   | Logging verbosity (ERROR, WARN, INFO, DEBUG) |
| `DRY_RUN`     | `false`  | Simulate pulses without sending to Claude    |

### Advanced Settings

| Variable                   | Default      | Description                          |
| -------------------------- | ------------ | ------------------------------------ |
| `RETRY_BACKOFF_MULTIPLIER` | `2`          | Exponential backoff multiplier       |
| `MAX_BACKOFF_MINUTES`      | `30`         | Maximum retry delay in minutes       |
| `NODE_ENV`                 | `production` | Environment mode                     |
| `DISCORD_WEBHOOK_URL`      | `unset`      | Discord webhook URL for error alerts |

### Discord Notifications (Optional)

Get instant error alerts in Discord by setting up a webhook:

1. **Create webhook**: Discord Server → Settings → Integrations → Webhooks → New Webhook
2. **Copy webhook URL**
3. **Add to environment**:
   ```bash
   docker run -d --name claudepulse \
     -e DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_ID/YOUR_TOKEN \
     -v claudepulse-data:/home/claudepulse/.claude \
     ghcr.io/substance0/claudepulse:latest
   ```

Error notifications include error details, timestamp, and context. See [ENVIRONMENT.md](ENVIRONMENT.md#discord_webhook_url) for testing and advanced configuration.

## Support

- GitHub Issues: [Report bugs or request features](https://github.com/substance0/claudepulse/issues)
- Documentation: [Full documentation](https://github.com/substance0/claudepulse/wiki)
- Workflow Diagrams: [Visual process flows](docs/workflow-diagrams.md)

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for a list of changes and version history.

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines on how to contribute to ClaudePulse.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
