> [!NOTE]
> This is a personal project I’m using to learn and experiment (with some AI help). It’s not really maintained, doesn’t have a roadmap, and comes with no guarantees—use at your own risk.

<div align="center">

<img src="assets/logo.png" alt="ClaudePulse Logo" width="250">

# ClaudePulse

**Starts each new Claude Pro/Max 5-hour window right after the previous one resets, so the hours you pay for are already running when you sit down to code.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)
[![Version](https://img.shields.io/github/v/release/substance0/claudepulse)](https://github.com/substance0/claudepulse/releases)
[![Docker Edge](https://github.com/substance0/claudepulse/actions/workflows/docker-edge.yml/badge.svg)](https://github.com/substance0/claudepulse/actions/workflows/docker-edge.yml)

[How It Works](#how-it-works) • [Installation](#installation) • [Operating](#operating) • [Configuration](#configuration) • [Image Tags](#image-tags) • [Support](#support) • [License](#license)

</div>

## At a Glance

Claude's 5-hour windows don't start on their own when the previous one resets. A new window only starts with your first prompt after the reset, and it ends about 5 hours later. If you come back to your desk late, the window starts late too.

> [!WARNING]
> The "5-hour limit" can trigger before 5 actual hours due to token limits or other Claude-specific thresholds. See more details [on Claude's website](https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work).

### Real-World Scenario

| Time         | Without ClaudePulse                                                      | With ClaudePulse                                                         |
| ------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| **9:00 AM**  | 🚀 Start coding, excited about your project                              | 🚀 Start coding, excited about your project                              |
| **11:00 AM** | 😱 _"5-hour limit reached • resets 2pm"_                                 | 😱 _"5-hour limit reached • resets 2pm"_                                 |
| **2:00 PM**  | ⏰ Reset time arrives, but you're in meetings                            | ⏰ Reset time arrives, but you're in meetings                            |
| **2:10 PM**  | 💼 Still in meetings...                                                  | ✅ **ClaudePulse sends pulse automatically**                             |
| **4:00 PM**  | 😞 Ready to code, but window starts NOW<br>_(Lost 2 hours you paid for)_ | 😎 Ready to code with **3h remaining**<br>_(Maximum subscription value)_ |

## How It Works

1. **A pulse** runs Claude Code once (`claude -p`) on the cheapest model, with thinking disabled and an isolated configuration, so it costs as little as possible.
2. **Claude Code reports when the current window resets.** ClaudePulse schedules the next pulse just after that time, so one pulse per window is enough.
3. **At startup**, ClaudePulse pulses right away to learn the current window, or waits for `SCHEDULED_START_HOUR` if you set one. Until a window is known, it pulses hourly.
4. **Work hours** (opt-in, `WORK_HOURS_ENABLED=true`): with `WORK_START`, `WORK_END` and `HOURS_LEFT_AT_START`, the first pulse of each working day lands so the window has that many hours left when you start, and a fresh window follows soon after. No pulse is sent at night, on days off, or at startup outside these hours.

See the [workflow diagrams](docs/workflow-diagrams.md) for the full scheduling logic.

## Features

| Feature                     | Description                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Window-Aware Scheduling** | Follows the reported window reset, waits out usage limits, and respects a configured start hour ([strategies](docs/workflow-diagrams.md#3-scheduling-strategy-selection)) |
| **Window Notifications**    | Optional Discord message each time a window opens (with weekly usage) or a 5-hour or weekly limit is reached, with reset times in your local time zone |
| **Spaced Failure Alerts**   | Optional Discord alerts on the 1st, 2nd, 4th, 8th consecutive failure and so on, so an outage stays visible without flooding the channel |
| **Retry with Backoff**      | Exponential backoff (configurable multiplier and maximum delay) for transient failures; authentication failures are not retried     |
| **No Stored Credentials**   | Claude Code authenticates each pulse from `CLAUDE_CODE_OAUTH_TOKEN`; ClaudePulse keeps no credentials, and state only when `STATE_DIR` is set |
| **Small, Verifiable Image** | No npm runtime dependencies, a pinned Claude Code CLI, `linux/amd64` and `linux/arm64` builds, and signed build provenance         |

## Installation

All installation paths read secrets from a `claudepulse.env` file. Create it once.

**1. Generate a token** on any machine with a browser. It is valid for one year:

```bash
claude setup-token
```

**2. Store it in `claudepulse.env`**, readable only by you. The command prints the token once and saves it nowhere:

```bash
echo "CLAUDE_CODE_OAUTH_TOKEN=<token>" > claudepulse.env && chmod 600 claudepulse.env
```

The env file keeps the token out of your shell history and compose files. Docker still copies its values into the container configuration, so anyone who can run `docker inspect` on the host can read it.

<details open>
<summary><strong>🐳 Docker (Recommended)</strong></summary>

```bash
docker run -d --name claudepulse --restart unless-stopped \
  -e TZ=America/New_York \
  --env-file claudepulse.env \
  ghcr.io/substance0/claudepulse:latest
```

Set `TZ` to your [time zone](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) so log timestamps match your clock (default `UTC`). Podman works the same way: replace `docker` with `podman`.

</details>

<details>
<summary><strong>🐳 Docker Compose</strong></summary>

Download the compose file next to `claudepulse.env`, then start it:

```bash
curl -O https://raw.githubusercontent.com/substance0/claudepulse/main/docker-compose.yml
TZ=America/New_York docker compose up -d
```

Settings go in `environment:`; secrets, including the optional Discord webhooks, go in `claudepulse.env`. Values under `environment:` override the env file, so never list a secret there.

</details>

<details>
<summary><strong>💻 From Source</strong></summary>

Requires Node.js 22 or later and the Claude CLI on your `PATH`. There are no runtime dependencies, so no `npm install` is needed to run it:

```bash
git clone https://github.com/substance0/claudepulse.git
cd claudepulse
set -a && . ./claudepulse.env && set +a
npm start
```

Or build and run the image locally: `docker compose -f docker-compose.dev.yml up -d`.

For development setup, tests and the release process, see [CONTRIBUTING.md](CONTRIBUTING.md).

</details>

## Operating

**Check that it works.** A healthy run logs a successful pulse, then the time of the next one:

```bash
docker logs -f claudepulse
# [INFO] [PULSE] Pulse successful (window_resets=…, weekly=20%, cost=…)
# [INFO] [STRATEGY] ✓ Strategy selected: window_reset → scheduling next pulse at …
```

`docker ps` also shows a health status. It checks that Node.js and the Claude CLI run, not that pulses succeed; failed pulses show up in the logs and in Discord alerts.

**Upgrade** to the latest release:

```bash
docker pull ghcr.io/substance0/claudepulse:latest
docker rm -f claudepulse   # then run the `docker run` command above again

docker compose pull && docker compose up -d   # with Docker Compose
```

**Renew the token** before it expires, one year after `claude setup-token`. An expired token makes every pulse fail with an authentication error, and it is not retried. Run `claude setup-token` again, replace the token in `claudepulse.env`, update `TOKEN_EXPIRES_AT` if you set it, then recreate the container as for an upgrade. Set `TOKEN_EXPIRES_AT` to the date one year after `claude setup-token` to be warned on Discord 14, 7 and 1 day before, and once it has expired.

**Stop** ClaudePulse with `docker rm -f claudepulse`, or `docker compose down`.

## Configuration

Every setting has a default. Pass settings with `-e` or under `environment:`, and secrets through `claudepulse.env`. [ENVIRONMENT.md](ENVIRONMENT.md) documents each one in detail.

### Settings

| Variable                     | Default       | Description                                                            |
| ---------------------------- | ------------- | ---------------------------------------------------------------------- |
| `TZ`                         | `UTC`         | Time zone for logs, work hours and `SCHEDULED_START_HOUR`              |
| `ACCOUNT_LABEL`              | unset         | Name shown in log lines and Discord messages, to tell accounts apart   |
| `TOKEN_EXPIRES_AT`           | unset         | Token expiry (`YYYY-MM-DD`); warnings 14, 7 and 1 day before, and once expired |
| `STATE_DIR`                  | unset         | Absolute directory for a state file, so a restart resumes the planned pulse (mount a volume there, e.g. `/data`) |
| `WORK_HOURS_ENABLED`         | `false`       | Turns work hours on (see [Work Hours](ENVIRONMENT.md#work-hours))       |
| `WORK_START`                 | unset         | When your working day starts (`HH:MM`); required when enabled          |
| `WORK_END`                   | unset         | No window starts at or after this time (`HH:MM`); required when enabled |
| `HOURS_LEFT_AT_START`        | `5`           | Hours left in the window at `WORK_START` (1-5)                         |
| `WORK_DAYS`                  | every day     | Working days, e.g. `Mon-Fri` or `Mon-Thu,Sat`                          |
| `SCHEDULED_START_HOUR`       | unset         | Hour (0-23) of a single first pulse; later pulses follow the window. Not with work hours on |
| `LOG_LEVEL`                  | `INFO`        | Logging verbosity (`ERROR`, `WARN`, `INFO`, `DEBUG`, `TRACE`)          |
| `DRY_RUN`                    | `false`       | Print the schedule and exit without sending a pulse                    |
| `PROMPT_TEXT`                | `pulse check` | Message each pulse sends to Claude                                     |
| `MAX_RETRIES`                | `3`           | Maximum retry attempts on failure                                      |
| `RETRY_BACKOFF_MULTIPLIER`   | `2`           | Exponential backoff multiplier                                         |
| `MAX_BACKOFF_MINUTES`        | `30`          | Maximum retry delay in minutes                                         |
| `IMMEDIATE_PULSE_AFTER_AUTH` | `true`        | Pulse at startup to learn the current window                           |
| `KEEP_PULSE_ON_FAILURE`      | `false`       | Keep the container running when the scheduler fails to start, for debugging |

### Secrets (`claudepulse.env`)

| Variable                     | Required | Description                                          |
| ---------------------------- | -------- | ---------------------------------------------------- |
| `CLAUDE_CODE_OAUTH_TOKEN`    | yes      | Token from `claude setup-token`                      |
| `DISCORD_ERROR_WEBHOOK_URL`  | no       | Discord webhook for errors and alerts (token expiry, extra usage) |
| `DISCORD_WINDOW_WEBHOOK_URL` | no       | Discord webhook announcing each window's reset time  |

### Discord Notifications (Optional)

ClaudePulse can post to two Discord webhooks:

- **Errors and alerts** (`DISCORD_ERROR_WEBHOOK_URL`, formerly `DISCORD_WEBHOOK_URL`, whose old name is now ignored): failed pulses and other errors, spaced out during an outage, plus token expiry warnings when `TOKEN_EXPIRES_AT` is set. Keep it on a channel you do not mute.
- **Window notifications** (`DISCORD_WINDOW_WEBHOOK_URL`): "Window open" with the reset time and weekly usage, "Usage limit reached" with the time it lifts, or "Weekly limit reached" with the date it lifts. Handy for checking your window from a phone. Give it a channel of its own, so you can mute it without muting error alerts.

To set one up:

1. **Create the webhook**: Discord Server → Settings → Integrations → Webhooks → New Webhook, then copy its URL.
2. **Add it to `claudepulse.env`**. A webhook URL is a secret: anyone holding it can post to the channel.
   ```bash
   echo "DISCORD_WINDOW_WEBHOOK_URL=https://discord.com/api/webhooks/…" >> claudepulse.env
   ```
3. **Recreate the container** so it reads the new value, as for an upgrade.

See [ENVIRONMENT.md](ENVIRONMENT.md#discord_webhook_url) to send a test alert.

### Several Accounts

Run one container per account, each with its own env file and label:

```yaml
services:
  claudepulse-work:
    image: ghcr.io/substance0/claudepulse:latest
    container_name: claudepulse-work
    environment:
      - TZ=Europe/Paris
      - ACCOUNT_LABEL=work
    env_file:
      - work.env
    restart: unless-stopped
  claudepulse-personal:
    image: ghcr.io/substance0/claudepulse:latest
    container_name: claudepulse-personal
    environment:
      - TZ=Europe/Paris
      - ACCOUNT_LABEL=personal
    env_file:
      - personal.env
    restart: unless-stopped
```

Both can share Discord webhooks: every message names its account. If you enable `STATE_DIR`, give each container a volume of its own (for example `claudepulse-work-data` and `claudepulse-personal-data`): a state file belongs to one account.

## Image Tags

Images are published to `ghcr.io/substance0/claudepulse` for `linux/amd64` and `linux/arm64`.

| Tag                           | Published              | Use                         |
| ----------------------------- | ---------------------- | --------------------------- |
| `latest`, `X.Y.Z`, `X.Y`, `X` | when a release is cut  | production                  |
| `edge`, `X.Y.Z-dev.N`         | every commit on `main` | early access to merged work |
| `sha-<commit>`                | every edge and release | pinning an exact build      |

Every image carries signed build provenance. Verify one with:

```bash
gh attestation verify oci://ghcr.io/substance0/claudepulse:<tag> -R substance0/claudepulse
```

Branch snapshots and release rebuilds are covered in [CONTRIBUTING.md](CONTRIBUTING.md#image-builds).

## Support

- [Report bugs or request features](https://github.com/substance0/claudepulse/issues)
- [Environment variables reference](ENVIRONMENT.md)
- [Workflow diagrams](docs/workflow-diagrams.md)
- [Changelog](CHANGELOG.md)

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for the development setup, checks and release process.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
