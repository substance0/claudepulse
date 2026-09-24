# Environment Variables Reference

Complete reference for ClaudePulse environment variables and configuration options.

## Quick Reference

| Variable                     | Type    | Default         | Description                                     |
| ---------------------------- | ------- | --------------- | ----------------------------------------------- |
| `SCHEDULED_START_HOUR`       | Number  | `unset`         | Hour for first pulse only (0-23)                |
| `PROMPT_TEXT`                | String  | `"pulse check"` | Message sent to Claude                          |
| `MAX_RETRIES`                | Number  | `3`             | Maximum retry attempts (1-10)                   |
| `RETRY_BACKOFF_MULTIPLIER`   | Number  | `2`             | Exponential backoff multiplier (1.0-5.0)        |
| `MAX_BACKOFF_MINUTES`        | Number  | `30`            | Maximum retry delay in minutes (1-300)          |
| `LOG_LEVEL`                  | String  | `INFO`          | Logging verbosity (ERROR/WARN/INFO/DEBUG/TRACE) |
| `NODE_ENV`                   | String  | `production`    | Environment mode (development/production/test)  |
| `DRY_RUN`                    | Boolean | `false`         | Test mode - analyze schedule without sending    |
| `KEEP_PULSE_ON_FAILURE`      | Boolean | `false`         | Keep container running on auth failures         |
| `IMMEDIATE_PULSE_AFTER_AUTH` | Boolean | `true`          | Pulse at startup to learn the current window    |
| `DISCORD_WEBHOOK_URL`        | String  | `unset`         | Discord webhook URL for error notifications     |
| `CLAUDE_CODE_OAUTH_TOKEN`    | String  | required        | Token from `claude setup-token`                 |

## Core Configuration

### `SCHEDULED_START_HOUR`

**Purpose:** Sets the hour of the **first scheduled pulse only**.

**Type:** Number (0-23)
**Default:** Unset (the first scheduled pulse follows the window, or the next hour)

**Behavior:**

- First scheduled pulse at `SCHEDULED_START_HOUR:00:10` local time
- Takes precedence over the reported window for that first pulse only, because
  it is explicit configuration
- Every later pulse follows the window reset (see Pulse Scheduling below)
- This is NOT a daily anchor - one-time use only

**Example:**

```bash
# First pulse at 04:00:10 local time
SCHEDULED_START_HOUR=4
```

**Note:** Container timezone is set via `TZ` environment variable (e.g., `TZ=America/New_York`).

---

### `PROMPT_TEXT`

**Purpose:** Message sent to Claude for session pulse.

**Type:** String
**Default:** `"pulse check"`
**Recommended:** 1-50 characters for minimal token usage

**Examples:**

```bash
PROMPT_TEXT="ping"          # Minimal
PROMPT_TEXT="pulse check"   # Default
PROMPT_TEXT="ok"            # Ultra-minimal
```

---

### Pulse Scheduling

**IMPORTANT:** ClaudePulse does **not** use a configurable `INTERVAL_HOURS` variable.

Every pulse reports the rate-limit window it ran in, including when that window
resets, as a timestamp. The next pulse is scheduled from it:

| Last pulse                         | Next pulse                                  |
| ---------------------------------- | ------------------------------------------- |
| Allowed                            | 10 seconds after the 5-hour window resets   |
| Usage limit reached                | 10 seconds after the blocking window resets |
| Reported no window (e.g. it failed)| On the next hour, to learn the window       |

A single successful pulse is enough to learn the window, so in normal operation
ClaudePulse pulses once per window. Reset times are used as reported, not
rounded to the hour: windows do not start on the hour.

A pulse refused because the usage limit is reached is not a failure: Claude is
in use. It is not retried and raises no alert.

See [Scheduling Strategies](docs/workflow-diagrams.md#3-scheduling-strategy-selection) for details.

---

### `MAX_RETRIES`

**Purpose:** Maximum retry attempts for failed pulse requests.

**Type:** Number
**Default:** `3`
**Range:** 1-10

**Retry Behavior:**

- Exponential backoff between retries
- Total retry time: ~1-30 minutes (depends on backoff settings)
- Cycle limit errors are handled specially (not retried, schedule adjusted instead)
- Authentication failures are not retried either. An expired or rejected token
  needs re-authentication, so the cycle is abandoned after the first attempt
  rather than repeating a request that cannot succeed.

**Examples:**

```bash
MAX_RETRIES=1    # Minimal retry
MAX_RETRIES=3    # Standard (default)
MAX_RETRIES=5    # High resilience
```

---

### `RETRY_BACKOFF_MULTIPLIER`

**Purpose:** Controls exponential backoff timing between retries.

**Type:** Number
**Default:** `2`
**Range:** 1.0-5.0

**Calculation:** `delay = baseDelay * multiplier^attempt`

**Examples:**

```bash
RETRY_BACKOFF_MULTIPLIER=1.5    # Conservative
RETRY_BACKOFF_MULTIPLIER=2      # Standard (default)
RETRY_BACKOFF_MULTIPLIER=3      # Aggressive
```

**Timing with base delay = 1 minute:**

- `1.5`: 1min → 1.5min → 2.25min → 3.4min
- `2.0`: 1min → 2min → 4min → 8min
- `3.0`: 1min → 3min → 9min → 27min

---

### `MAX_BACKOFF_MINUTES`

**Purpose:** Maximum delay between retry attempts.

**Type:** Number
**Default:** `30`
**Range:** 1-300 minutes

**Examples:**

```bash
MAX_BACKOFF_MINUTES=10     # Quick retries
MAX_BACKOFF_MINUTES=30     # Standard (default)
MAX_BACKOFF_MINUTES=60     # Patient retries
MAX_BACKOFF_MINUTES=300    # Maximum (5 hours)
```

---

## Logging Configuration

### `LOG_LEVEL`

**Purpose:** Controls logging verbosity.

**Type:** String
**Default:** `INFO`
**Valid Values:** `ERROR`, `WARN`, `INFO`, `DEBUG`, `TRACE`

**Level Hierarchy** (each includes all above):

1. **ERROR** - Critical errors only
2. **WARN** - Warnings and errors
3. **INFO** - General operation info (recommended for production)
4. **DEBUG** - Detailed debugging information
5. **TRACE** - Ultra-verbose (all messages including SDK internals)

**Examples:**

```bash
LOG_LEVEL=ERROR    # Production minimal
LOG_LEVEL=INFO     # Production standard (default)
LOG_LEVEL=DEBUG    # Development/troubleshooting
```

**Log Format:** Inline text format (human-readable). Colors auto-enabled for TTY output.

---

### `NODE_ENV`

**Purpose:** Application environment mode.

**Type:** String
**Default:** `production`
**Valid Values:** `development`, `production`, `test`

**Effects:**

| Mode          | Error Handling | Debug Info | Use Case              |
| ------------- | -------------- | ---------- | --------------------- |
| `development` | Verbose        | Enabled    | Local development     |
| `production`  | Compact        | Minimal    | Production deployment |
| `test`        | Silent         | Reduced    | Automated testing     |

---

## Operational Configuration

### `DRY_RUN`

**Purpose:** Test mode - analyzes schedule without sending pulses to Claude.

**Type:** Boolean
**Default:** `false`
**Valid Values:** `true`, `false`

**Behavior:**

- Performs full scheduling analysis
- Logs what would happen
- Exits without sending messages
- Useful for testing configuration

**Example:**

```bash
DRY_RUN=true npm start
```

---

### `KEEP_PULSE_ON_FAILURE`

**Purpose:** Keep container running on authentication failures for debugging.

**Type:** Boolean
**Default:** `false`
**Valid Values:** `true`, `false`

**Behavior:**

- `false` (default): Exit on auth failures
- `true`: Hold process alive for debugging, watch for credential updates

**Example:**

```bash
KEEP_PULSE_ON_FAILURE=true
```

---

### `IMMEDIATE_PULSE_AFTER_AUTH`

**Purpose:** Send a pulse at startup to learn the current window.

**Type:** Boolean
**Default:** `true`
**Valid Values:** `true`, `false`

**Behavior:**

- `true` (default): Send a pulse at startup to discover current session state
- `false`: Wait for first scheduled time

**Use Case:** The startup pulse reports when the current window resets, so
the first scheduled pulse can follow it. A startup pulse that fails raises an
alert, which surfaces a bad token as soon as the container starts.

---

## Authentication Configuration

### `CLAUDE_CODE_OAUTH_TOKEN`

**Type:** String
**Default:** `unset` (required)

ClaudePulse does not manage credentials. Each pulse runs Claude Code as a
subprocess, which reads this variable and authenticates itself.

Generate the token on a machine with a browser:

```bash
claude setup-token
```

The command prints the token once and saves it nowhere. It is valid for one
year. Supply it from a file rather than inline, so it stays out of shell
history, `docker inspect` output and stack listings:

```yaml
services:
  claudepulse:
    env_file:
      - /path/to/claudepulse.env # CLAUDE_CODE_OAUTH_TOKEN=...
```

The token is not validated at startup. An expired or rejected one surfaces as
a failed pulse, which is reported without retrying (see `MAX_RETRIES`).

---

### `DISCORD_WEBHOOK_URL`

**Purpose:** Enable Discord notifications for error alerts.

**Type:** String (URL)
**Default:** Unset (no notifications)

**Behavior:**

- Sends rich embeds to Discord channel on ERROR level logs
- Includes error details, category, timestamp, and context
- Non-blocking (failures don't affect application)
- Only triggers on actual errors (not INFO/WARN logs)
- Repeated pulse failures alert at widening intervals — on the 1st, 2nd, 4th,
  8th consecutive failure and so on — instead of once per cycle. A sustained
  outage therefore stays visible without flooding the channel, and the counter
  resets on the first successful pulse.

The webhook URL is masked as `[REDACTED]` in the startup configuration log, so
it is not exposed to anyone reading container logs.

**Setup:**

1. Create a webhook in Discord:
   - Server Settings → Integrations → Webhooks → New Webhook
   - Copy the webhook URL
2. Add to ClaudePulse environment:
   ```bash
   DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN
   ```

**Example:**

```bash
# Docker run
docker run -d --name claudepulse \
  -e DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/123456789/abcdefg \
  ghcr.io/substance0/claudepulse:latest

# Docker Compose
environment:
  - DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/123456789/abcdefg
```

**Testing:**

```bash
# Test the webhook is working
docker exec claudepulse node -e "
import('file:///app/src/core/services/notificationService.js').then(m => {
  m.sendDiscordAlert({
    title: '🧪 Test Alert',
    description: 'Testing Discord webhook',
    level: 'ERROR',
    fields: [{name: 'Status', value: 'Working!', inline: true}]
  }, process.env.DISCORD_WEBHOOK_URL).then(() => console.log('Sent!'));
});
"
```

---

## Timezone Configuration

**Environment Variable:** `TZ`
**Default:** `UTC`
**Format:** IANA timezone identifier

**Examples:**

```bash
TZ=America/New_York
TZ=Europe/London
TZ=Asia/Tokyo
TZ=Australia/Sydney
```

**Important:**

- Use IANA identifiers (not UTC offsets) for automatic DST handling
- ✅ Good: `TZ=America/New_York` (handles DST)
- ❌ Bad: `TZ=UTC-5` (no DST adjustment)
- `TZ` sets log timestamps and the hour `SCHEDULED_START_HOUR` refers to.
  Window reset times arrive as timestamps, so scheduling does not depend on it.

---

## Docker Configuration Examples

### Docker Run

```bash
docker run -d --name claudepulse \
  -e TZ=America/New_York \
  -e LOG_LEVEL=INFO \
  -e MAX_RETRIES=3 \
  -e PROMPT_TEXT="ping" \
  --env-file claudepulse.env \
  ghcr.io/substance0/claudepulse:latest
```

`claudepulse.env` holds `CLAUDE_CODE_OAUTH_TOKEN`. No volume is needed:
ClaudePulse keeps no state between restarts, and the startup pulse learns the
current window again.

### Docker Compose

```yaml
services:
  claudepulse:
    image: ghcr.io/substance0/claudepulse:latest
    environment:
      - TZ=America/New_York
      - LOG_LEVEL=INFO
      - MAX_RETRIES=3
      - PROMPT_TEXT=ping
      - NODE_ENV=production
    env_file:
      - claudepulse.env # CLAUDE_CODE_OAUTH_TOKEN=...
    restart: unless-stopped
```

---

## Troubleshooting

### Pulses Not Following the Window

**Symptoms:** Pulses every hour instead of once per window
**Solution:** Hourly pulses mean no pulse has reported a window, usually
because pulses are failing.

```bash
# Which strategy scheduled the next pulse (window_reset is normal):
docker logs claudepulse | grep -i "Strategy selected"

# Whether pulses report a window reset:
docker logs claudepulse | grep -i "windowResetsAt\|Pulse failed"
```

---

### Daylight Saving Time (DST)

**Symptoms:** Timing shifts during DST transitions
**Solution:**

```bash
# Use IANA timezone (handles DST automatically):
TZ=America/New_York  # ✅ Auto-adjusts
TZ=UTC-5            # ❌ No DST support

# Verify during DST transition:
docker logs claudepulse | grep -i "schedule\|next run"
```

---

### Excessive Logging

**Symptoms:** Large log files
**Solution:**

```bash
LOG_LEVEL=WARN      # Reduce verbosity
NODE_ENV=production # Optimize output
```

---

## Configuration Best Practices

### 1. Minimal Token Usage

```bash
PROMPT_TEXT="ok"     # Shortest possible
LOG_LEVEL=WARN       # Reduce logging overhead
```

### 2. High Resilience

```bash
MAX_RETRIES=5
MAX_BACKOFF_MINUTES=60
RETRY_BACKOFF_MULTIPLIER=2
```

### 3. Readable Timestamps

Set `TZ` to your location so log timestamps and `SCHEDULED_START_HOUR` use your
local time.

---

## Scheduling Strategies

ClaudePulse uses priority-based scheduling:

| Priority | Strategy          | Trigger                                 | Next Run Time                   |
| -------- | ----------------- | --------------------------------------- | ------------------------------- |
| 1        | `scheduled_start` | `SCHEDULED_START_HOUR` set, first only  | Configured hour + 10sec         |
| 2        | `window_reset`    | Last pulse reported a window            | Window reset + 10sec            |
| 3        | `discovery`       | No window known (e.g. a failed pulse)   | Next hour + 10sec               |

`window_reset` uses the 5-hour reset after an allowed pulse, and the blocking
window's reset after a pulse refused at the usage limit.

**All schedules include a 10-second buffer** to ensure pulses occur after time boundaries.

See [Workflow Diagrams](docs/workflow-diagrams.md) for detailed strategy flows.
