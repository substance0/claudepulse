# Environment Variables Reference

Complete reference for ClaudePulse environment variables and configuration options.

## Quick Reference

| Variable                     | Type    | Default         | Description                                     |
| ---------------------------- | ------- | --------------- | ----------------------------------------------- |
| `SCHEDULED_START_HOUR`       | Number  | `unset`         | Hour for first pulse only (0-23)                |
| `WORK_HOURS_ENABLED`         | Boolean | `false`         | Turns work hours on                             |
| `WORK_START`                 | String  | `unset`         | Working day start (`HH:MM`)                     |
| `WORK_END`                   | String  | `unset`         | No window starts at or after (`HH:MM`)          |
| `HOURS_LEFT_AT_START`        | Number  | `5`             | Hours left at `WORK_START` (1-5)                |
| `WORK_DAYS`                  | String  | every day       | Working days, e.g. `Mon-Fri`                    |
| `PROMPT_TEXT`                | String  | `"pulse check"` | Message sent to Claude                          |
| `MAX_RETRIES`                | Number  | `3`             | Maximum retry attempts (1-10)                   |
| `RETRY_BACKOFF_MULTIPLIER`   | Number  | `2`             | Exponential backoff multiplier (1.0-5.0)        |
| `MAX_BACKOFF_MINUTES`        | Number  | `30`            | Maximum retry delay in minutes (1-300)          |
| `LOG_LEVEL`                  | String  | `INFO`          | Logging verbosity (ERROR/WARN/INFO/DEBUG/TRACE) |
| `ACCOUNT_LABEL`              | String  | `unset`         | Name shown in logs and Discord messages         |
| `DRY_RUN`                    | Boolean | `false`         | Test mode - analyze schedule without sending    |
| `KEEP_PULSE_ON_FAILURE`      | Boolean | `false`         | Keep container running on auth failures         |
| `IMMEDIATE_PULSE_AFTER_AUTH` | Boolean | `true`          | Pulse at startup to learn the current window    |
| `DISCORD_WEBHOOK_URL`        | String  | `unset`         | Discord webhook for errors and token warnings   |
| `DISCORD_WINDOW_WEBHOOK_URL` | String  | `unset`         | Discord webhook announcing window reset times   |
| `CLAUDE_CODE_OAUTH_TOKEN`    | String  | required        | Token from `claude setup-token`                 |
| `TOKEN_EXPIRES_AT`           | Date    | `unset`         | Token expiry (`YYYY-MM-DD`) for warnings        |

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

### Work Hours

**Purpose:** Pulse only during your working day, and open its first window
early so part of it is left when you start, followed soon by a fresh one.

Work hours are off unless `WORK_HOURS_ENABLED=true`. While off, the other
settings are ignored, so they can stay in place; a startup warning says so.

| Setting               | Format                              | Default                    |
| --------------------- | ----------------------------------- | -------------------------- |
| `WORK_HOURS_ENABLED`  | `true` / `false`                    | `false`                    |
| `WORK_START`          | `HH:MM`                             | required when enabled      |
| `WORK_END`            | `HH:MM`                             | required when enabled      |
| `HOURS_LEFT_AT_START` | 1-5                                 | `5`                        |
| `WORK_DAYS`           | `Mon-Fri`, `Mon-Thu,Sat`, `Fri-Mon` | every day                  |

A window resets 5 hours after the minute of the pulse that opens it. The
day's first pulse fires 5 hours before `WORK_START + HOURS_LEFT_AT_START`.
With `WORK_START=09:00` and `HOURS_LEFT_AT_START=2`, it fires at 06:00:10:
its window resets at 11:00, leaving 2 hours at 09:00, and the next window
opens right after. `09:30` with 2 fires at 06:30:10 and leaves 2 hours too.
Pulses then follow each reported reset until `WORK_END`; none is sent at
night or on other days, none at startup outside these hours, and a failing
pulse is not retried after `WORK_END`.

The 5 hours are real hours, so the hours left stay exact on the days the
clocks change.

A window opened just before `WORK_END` lasts 5 hours. If the next day's first
pulse comes sooner, a startup warning explains that mornings may start with
fewer hours left, and suggests an earlier `WORK_END` or switching work hours
off.

`WORK_HOURS_ENABLED=true` and `SCHEDULED_START_HOUR` cannot both be set.

```bash
WORK_HOURS_ENABLED=true
WORK_START=09:00
WORK_END=19:00
HOURS_LEFT_AT_START=2
WORK_DAYS=Mon-Fri
```

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
history and the compose file. Docker still copies env file values into the
container configuration, so anyone who can run `docker inspect` can read it:

```yaml
services:
  claudepulse:
    env_file:
      - /path/to/claudepulse.env # CLAUDE_CODE_OAUTH_TOKEN=...
```

The token is not validated at startup. An expired or rejected one surfaces as
a failed pulse, which is reported without retrying (see `MAX_RETRIES`).

---

### `TOKEN_EXPIRES_AT`

**Purpose:** Be warned before the token from `claude setup-token` expires.

**Type:** Date, `YYYY-MM-DD` (local midnight)
**Default:** Unset (no warnings)

ClaudePulse cannot read the token's expiry, so record it here: one year
after you ran `claude setup-token`. Warnings go to `DISCORD_WEBHOOK_URL` and
the log when 14, 7 and 1 day(s) are left, and once it has expired. A restart
re-sends the current warning once.

```bash
TOKEN_EXPIRES_AT=2027-09-25
```

---

### `DISCORD_WEBHOOK_URL`

**Purpose:** Enable Discord notifications for error alerts.

**Type:** String (URL)
**Default:** Unset (no notifications)

**Behavior:**

- Sends rich embeds to Discord channel on ERROR level logs
- Includes error details, category, timestamp, and context
- Non-blocking (failures don't affect application)
- Only triggers on actual errors (not INFO/WARN logs), plus the token expiry
  warnings described under `TOKEN_EXPIRES_AT`
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
2. Add it to `claudepulse.env`, next to the token, then recreate the container:
   ```bash
   echo "DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN" >> claudepulse.env
   ```

The webhook URL is a secret: anyone holding it can post to the channel. Keep
it in the env file, not in `-e` flags or a compose file's `environment:`,
which would also override the env file's value.

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

### `DISCORD_WINDOW_WEBHOOK_URL`

**Purpose:** Announce on Discord when the current usage window resets, so the
reset time is visible from a phone.

**Type:** String (URL)
**Default:** Unset (no window announcements)

**Behavior:**

- After each pulse that reports a window, posts "Window open" with the reset
  time. Discord shows it in each reader's own time zone, with a countdown.
- When a pulse is refused, posts "Usage limit reached" with the time the
  limit lifts, or "Weekly limit reached" with the date and time the weekly
  limit lifts. Pulsing resumes on its own at that time.
- "Window open" also shows weekly usage and when the weekly window resets.
- Uses a webhook of its own. Create it in a dedicated channel, then mute or
  unmute that channel in Discord to turn announcements off and on without
  touching error alerts.
- A failed announcement is logged as a warning and never affects pulsing.
- The URL is masked as `[REDACTED]` in the startup configuration log.

---

### `ACCOUNT_LABEL`

**Purpose:** Tell several ClaudePulse containers apart, one per account.

**Type:** String, 1-32 letters, digits, spaces, dots, underscores or hyphens
**Default:** Unset (no label)

When set, log lines read `[INFO] [work] [PULSE] …`, error alerts are titled
`🚨 claudepulse (work) Error`, and window notifications `work · Window open`.

```bash
ACCOUNT_LABEL=work
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
  --restart unless-stopped \
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
docker logs claudepulse 2>&1 | grep -i "Strategy selected"

# Whether pulses report a window reset (failures are warnings, on stderr):
docker logs claudepulse 2>&1 | grep -i "windowResetsAt\|Pulse failed"
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
```

---

### Unrecognised Rate-Limit Fields

**Symptoms:** a `[WARN]` line with category `[RATELIMIT]` and the message
`Unrecognised rate-limit fields (fields={…})` in the logs; with
`ACCOUNT_LABEL` set, the label sits before the category.
**Meaning:** A pulse reported rate-limit data ClaudePulse does not use yet.
Pulsing is unaffected. Each distinct set of field names is logged once per
container start. The extra-usage fields every pulse carries (`overageStatus`,
`overageDisabledReason`, `isUsingOverage`, `overageResetsAt`) are read and do
not trigger this line.

```bash
docker logs claudepulse 2>&1 | grep -i "Unrecognised rate-limit fields"
```

Warnings are written to stderr, so `2>&1` is needed for `grep` to see them.
If you open an issue with that line, check it first: values describing your
account's billing (`canUserPurchaseCredits`, `hasChargeableSavedPaymentMethod`)
are replaced by `[omitted]`, but other values are printed as received.

When a pulse is drawing on paid extra usage, its log line ends with
`overage=on`:

```bash
docker logs claudepulse 2>&1 | grep "overage=on"
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
