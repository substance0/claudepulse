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
| `IMMEDIATE_PULSE_AFTER_AUTH` | Boolean | `true`          | Send discovery pulse after authentication       |
| `DISCORD_WEBHOOK_URL`        | String  | `unset`         | Discord webhook URL for error notifications     |

## Core Configuration

### `SCHEDULED_START_HOUR`

**Purpose:** Sets preferred hour for **first pulse only** when no session history exists.

**Type:** Number (0-23)
**Default:** Unset (falls back to next hour + 10 seconds)

**Behavior:**

- Only affects initial scheduling when starting fresh
- First pulse scheduled at `SCHEDULED_START_HOUR:00:10` local time
- Subsequent pulses use other strategies (cycle limit signals, session tracking, or 5-hour fixed intervals)
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

### Pulse Interval Behavior

**IMPORTANT:** ClaudePulse does **not** use a configurable `INTERVAL_HOURS` variable.

The pulse interval is determined automatically by the scheduling strategy:

| Mode           | Interval | When Used                                |
| -------------- | -------- | ---------------------------------------- |
| Discovery Mode | 1 hour   | No cycle limit detected yet              |
| Normal Mode    | 5 hours  | After first cycle limit message received |

This adaptive behavior ensures:

- Fast discovery of current session state (1-hour probes)
- Efficient operation once session windows are known (5-hour intervals)

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

**Purpose:** Send discovery pulse immediately after authentication.

**Type:** Boolean
**Default:** `true`
**Valid Values:** `true`, `false`

**Behavior:**

- `true` (default): Send pulse right after OAuth to discover current session state
- `false`: Wait for first scheduled time

**Use Case:** Helps quickly establish current 5-hour window boundaries.

---

## Authentication Configuration

### OAuth Credentials Path

**Default:** `~/.claude/.credentials.json`

ClaudePulse uses credentials from Claude Code CLI. Customize path via Docker volume mounts:

**Docker:**

```bash
docker run -v /custom/path:/home/claudepulse/.claude claudepulse
```

**Authentication Flow:**

1. Pre-auth recommended: `claude /login`
2. Or, ClaudePulse displays OAuth URL in logs
3. Complete browser auth
4. Pass verification code: `npm run oauth-verify <code>`

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
- Container timezone must match your local timezone for correct cycle limit parsing

---

## Docker Configuration Examples

### Docker Run

```bash
docker run -d --name claudepulse \
  -e TZ=America/New_York \
  -e LOG_LEVEL=INFO \
  -e MAX_RETRIES=3 \
  -e PROMPT_TEXT="ping" \
  -v ${HOME}/.claude:/home/claudepulse/.claude \
  ghcr.io/substance0/claudepulse:latest
```

### Docker Compose

```yaml
version: "3.8"
services:
  claudepulse:
    image: ghcr.io/substance0/claudepulse:latest
    environment:
      - TZ=America/New_York
      - LOG_LEVEL=INFO
      - MAX_RETRIES=3
      - PROMPT_TEXT=ping
      - NODE_ENV=production
    volumes:
      - ${HOME}/.claude:/home/claudepulse/.claude
```

---

## Troubleshooting

### Cycle Limit Timing Issues

**Symptoms:** Pulses sent at wrong times
**Solution:**

```bash
# Verify container timezone:
docker exec claudepulse date

# Set correct timezone:
docker run -e TZ=America/New_York claudepulse

# Check cycle limit detection:
docker logs claudepulse | grep -i "cycle limit\|reset"
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

### 3. Timezone Accuracy

Always set `TZ` to match your location for correct cycle limit parsing.

---

## Advanced/Debug Variables

These variables are primarily for development and debugging:

| Variable                            | Type   | Purpose                             |
| ----------------------------------- | ------ | ----------------------------------- |
| `SESSION_LIMIT_TIME_REGEX`          | String | Custom regex for parsing reset time |
| `MOCK_CLAUDE_SESSION_LIMIT_MESSAGE` | String | Simulate cycle limit error          |
| `MOCK_CLAUDE_PING_SUCCESS_MESSAGE`  | String | Simulate successful pulse           |

**Note:** These are not recommended for production use.

---

## Scheduling Strategies

ClaudePulse uses priority-based scheduling:

| Priority | Strategy        | Trigger                      | Next Run Time             |
| -------- | --------------- | ---------------------------- | ------------------------- |
| 1        | External Signal | Cycle limit message detected | Reset time + 10sec        |
| 2        | Initial Hour    | `SCHEDULED_START_HOUR` set   | Hour + 10sec (first only) |
| 3        | Session Expiry  | Active session detected      | Window end + 10sec        |
| 4        | Fixed Cadence   | Has previous schedule        | Last + 5 hours            |
| 5        | Discovery       | Fallback                     | Next hour + 10sec         |

**All schedules include a 10-second buffer** to ensure pulses occur after time boundaries.

See [Workflow Diagrams](docs/workflow-diagrams.md) for detailed strategy flows.
