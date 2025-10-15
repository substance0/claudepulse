# Environment Variables Reference

**Complete reference for all ClaudePulse environment variables and configuration options**

This document provides detailed information about all environment variables, configuration options, and their effects on ClaudePulse behavior.

## Table of Contents

1. [Quick Reference Table](#quick-reference-table)
2. [Core Configuration](#core-configuration)
   - [`RESET_HOUR`](#reset_hour)
   - [`PROMPT_TEXT`](#prompt_text)
   - [`INTERVAL_HOURS`](#interval_hours)
   - [`MAX_RETRIES`](#max_retries)
   - [`RETRY_BACKOFF_MULTIPLIER`](#retry_backoff_multiplier)
   - [`MAX_BACKOFF_MINUTES`](#max_backoff_minutes)
3. [Logging Configuration](#logging-configuration)
   - [`DEBUG`](#debug)
   - [`LOG_LEVEL`](#log_level)
   - [`NODE_ENV`](#node_env)
   - [`LOG_FORMAT`](#log_format)
4. [Docker-Specific Variables](#docker-specific-variables)
   - [Container Environment](#container-environment)
   - [Kubernetes ConfigMap](#kubernetes-configmap)
5. [Authentication Configuration](#authentication-configuration)
6. [Advanced Configuration Examples](#advanced-configuration-examples)
   - [High-Frequency Monitoring](#high-frequency-monitoring)
   - [Low-Frequency Monitoring](#low-frequency-monitoring)
   - [Development Mode](#development-mode)
   - [Production Mode](#production-mode)
   - [High-Availability Mode](#high-availability-mode)
7. [Environment-Specific Configurations](#environment-specific-configurations)
   - [Local Development](#local-development)
   - [Staging Environment](#staging-environment)
   - [Production Environment](#production-environment)
8. [Configuration Validation](#configuration-validation)
9. [Common Configuration Issues](#common-configuration-issues)
10. [Configuration Monitoring](#configuration-monitoring)
11. [Configuration Best Practices](#configuration-best-practices)
12. [Scheduling Strategies and Priority](#scheduling-strategies-and-priority)
    - [Priority Order](#priority-order-highest--lowest)
    - [Strategy Details](#strategy-details)
    - [Configuration Examples](#configuration-examples-1)
    - [External Signal Behavior](#external-signal-behavior)
    - [Key Features](#key-features)
    - [Strategy Selection Flow](#strategy-selection-flow)
    - [Log Messages](#log-messages)

## Quick Reference Table

| Variable                   | Type    | Default      | Description                                | Example                                   |
| -------------------------- | ------- | ------------ | ------------------------------------------ | ----------------------------------------- |
| `PROMPT_TEXT`              | String  | `"pulse check"`     | Message sent to Claude for pulse       | `"Custom pulse"`                      |
| `INTERVAL_HOURS`           | Number  | `5`          | Hours between pulse messages           | `3`, `8`, `24`                            |
| `MAX_RETRIES`              | Number  | `3`          | Maximum retry attempts for failed requests | `1`, `5`, `10`                            |
| `RETRY_BACKOFF_MULTIPLIER` | Number  | `2`          | Exponential backoff multiplier             | `1.5`, `2`, `3`                           |
| `MAX_BACKOFF_MINUTES`      | Number  | `30`         | Maximum backoff delay in minutes           | `10`, `60`, `120`                         |
| `DEBUG`                    | Boolean | `false`      | Enable debug logging                       | `true`, `false`                           |
| `LOG_LEVEL`                | String  | `INFO`       | Logging verbosity level                    | `ERROR`, `WARN`, `INFO`, `DEBUG`, `TRACE` |
| `NODE_ENV`                 | String  | `production` | Application environment mode               | `development`, `production`, `test`       |
| `RESET_HOUR`               | Number  | `unset`      | Anchor first run to local hour boundary+10 | `0`..`23` (e.g., `4` for 04:10 local)     |

## Core Configuration
### `RESET_HOUR`

Purpose: Anchor the first scheduled pulse to a daily local hour boundary, plus a 10‑minute safety buffer, without needing prior session history.

Type: Number (Integer 0–23)
Default: Unset (falls back to next hour + 10 minutes)

Behavior:
- On fresh start with no active session history, the first run is set to the next occurrence of `RESET_HOUR:10` in the container’s local timezone; subsequent runs continue every 5 hours.
- If a rate‑limit message provides an explicit reset time, that takes precedence over this anchor.

Examples:

```bash
# Run first pulse at 04:10 local time, then every 5 hours
RESET_HOUR=4

# Docker
docker run -e RESET_HOUR=4 claudepulse
```

Notes:
- Local time is the container’s timezone; set TZ if you need a specific zone.
- When authentication is obtained by sending a “connection test”, a fresh 5‑hour window starts immediately; the next run typically aligns with the computed session expiry + 10 minutes.


### `PROMPT_TEXT`

**Purpose**: Defines the message sent to Claude for session pulse.

**Type**: String
**Default**: `"pulse check"`
**Valid Values**: Any text string (1-500 characters recommended)

**Examples**:

```bash
# Simple pulse
PROMPT_TEXT="pulse check"

# Custom message
PROMPT_TEXT="keep session active"

# With timestamp
PROMPT_TEXT="Keepalive at $(date)"

# Minimal response request
PROMPT_TEXT="ok"
```

**Considerations**:

- Shorter messages use fewer tokens and cost less
- Avoid complex prompts that might generate long responses
- Consider Claude's token limits for cost optimization
- Test prompts to ensure consistent minimal responses

---

### `INTERVAL_HOURS`

**Purpose**: Sets the interval between pulse messages in hours.

**Type**: Number (Integer or Float)
**Default**: `5`
**Valid Range**: `0.1` to `168` (1 week)

**Examples**:

```bash
# Every 3 hours
INTERVAL_HOURS=3

# Every 30 minutes (0.5 hours)
INTERVAL_HOURS=0.5

# Once per day
INTERVAL_HOURS=24

# Twice per week
INTERVAL_HOURS=84
```

**Smart Token Refresh**:
ClaudePulse automatically adjusts token refresh timing based on this interval:

- **Short intervals** (< 2 hours): Standard 5-minute buffer
- **Long intervals** (> 6 hours): Extended buffer to ensure token validity

**Cost Considerations**:

- More frequent intervals = higher token usage
- Balance between session persistence and cost
- Consider Claude's session timeout policies

---

### `MAX_RETRIES`

**Purpose**: Maximum number of retry attempts for failed pulse requests.

**Type**: Number (Integer)
**Default**: `3`
**Valid Range**: `1` to `10`

**Examples**:

```bash
# Conservative retries
MAX_RETRIES=1

# Standard resilience
MAX_RETRIES=3

# High resilience
MAX_RETRIES=5

# Maximum persistence
MAX_RETRIES=10
```

**Retry Behavior**:

- Each retry uses exponential backoff
- Total time for all retries: ~1-30 minutes
- Failed retries are logged with detailed error information

---

### `RETRY_BACKOFF_MULTIPLIER`

**Purpose**: Controls exponential backoff timing between retry attempts.

**Type**: Number (Float)
**Default**: `2`
**Valid Range**: `1.0` to `5.0`

**Examples**:

```bash
# Linear backoff (not recommended)
RETRY_BACKOFF_MULTIPLIER=1.0

# Conservative exponential
RETRY_BACKOFF_MULTIPLIER=1.5

# Standard exponential
RETRY_BACKOFF_MULTIPLIER=2

# Aggressive backoff
RETRY_BACKOFF_MULTIPLIER=3
```

**Backoff Calculation**:

```javascript
const delay = baseDelay * Math.pow(multiplier, attempt);
```

**Timing Examples** (base delay = 1 minute):

- `1.5`: 1min, 1.5min, 2.25min, 3.4min
- `2.0`: 1min, 2min, 4min, 8min
- `3.0`: 1min, 3min, 9min, 27min

---

### `MAX_BACKOFF_MINUTES`

**Purpose**: Maximum delay between retry attempts to prevent excessive waiting.

**Type**: Number (Integer)
**Default**: `30`
**Valid Range**: `1` to `120`

**Examples**:

```bash
# Quick retries
MAX_BACKOFF_MINUTES=5

# Standard patience
MAX_BACKOFF_MINUTES=30

# Extended patience
MAX_BACKOFF_MINUTES=60

# Maximum patience
MAX_BACKOFF_MINUTES=120
```

**Safety Feature**:
Prevents exponential backoff from creating delays longer than practical for pulse purposes.

## Logging Configuration

### `DEBUG`

**Purpose**: Legacy debug flag for backward compatibility.

**Type**: Boolean
**Default**: `false`
**Valid Values**: `true`, `false`, `1`, `0`

**Examples**:

```bash
# Enable debug mode
DEBUG=true

# Disable debug mode (default)
DEBUG=false
```

**Note**: Superseded by `LOG_LEVEL`. When `DEBUG=true`, sets `LOG_LEVEL=DEBUG`.

---

### `LOG_LEVEL`

**Purpose**: Controls logging verbosity and output detail.

**Type**: String (Enum)
**Default**: `INFO`
**Valid Values**: `ERROR`, `WARN`, `INFO`, `DEBUG`, `TRACE`

**Level Hierarchy** (each level includes all above):

1. **ERROR**: Critical errors only
2. **WARN**: Warnings and errors
3. **INFO**: General information, warnings, and errors
4. **DEBUG**: Detailed debugging, info, warnings, and errors
5. **TRACE**: Ultra-verbose tracing (all messages)

**Examples**:

```bash
# Production (minimal logging)
LOG_LEVEL=ERROR

# Standard production
LOG_LEVEL=INFO

# Development debugging
LOG_LEVEL=DEBUG

# Deep troubleshooting
LOG_LEVEL=TRACE
```

**Log Volume Estimates**:

- **ERROR**: ~1-5 messages per day
- **INFO**: ~10-50 messages per day
- **DEBUG**: ~100-500 messages per day
- **TRACE**: ~1000+ messages per day

---

### `NODE_ENV`

**Purpose**: Sets the application environment mode affecting error handling verbosity and performance optimizations. **Does NOT control log format** - use `LOG_FORMAT` for that.

**Type**: String (Enum)
**Default**: `production`
**Valid Values**: `development`, `production`, `test`

**Examples**:

```bash
# Development mode with detailed error handling
NODE_ENV=development

# Production mode with optimized performance
NODE_ENV=production

# Test mode with minimal output
NODE_ENV=test
```

**Environment Effects**:

| Environment   | Error Handling | Performance | Debug Features | Typical Use |
| ------------- | -------------- | ----------- | -------------- | ----------- |
| `development` | **Verbose** - Full stack traces | Debug info enabled | Extended debugging | Local development |
| `production`  | **Compact** - Essential errors only | Optimized for performance | Minimal overhead | Production deployment |
| `test`        | **Silent** - Reduced noise | Fast execution | Test-friendly output | Unit/integration tests |

**Important**: Log format is controlled by `LOG_FORMAT`, not `NODE_ENV`. These are independent settings.

---

### `LOG_FORMAT`

**Purpose**: Controls the output format of log messages.

**Type**: String (Enum)
**Default**: `inline`
**Valid Values**: `inline`, `json`

**Examples**:

```bash
# Human-readable logs (default)
LOG_FORMAT=inline

# Machine-parseable JSON logs
LOG_FORMAT=json
```

**Format Comparison**:

| Format   | Description | Colors | Use Case | Example |
|----------|-------------|--------|----------|---------|
| `inline` | **Human-readable** structured text | Enabled (if TTY) | Local development, debugging | `[2025-09-26 14:30:00] INFO - Scheduler starting` |
| `json`   | **Machine-parseable** JSON objects | Disabled | Production, log aggregation | `{"timestamp":"2025-09-26T14:30:00.000Z","level":"INFO","message":"Scheduler starting"}` |

**Color Control**:
- Colors are enabled for `inline` format when output is a TTY
- Override with `NO_COLOR=1` (disable) or `FORCE_COLOR=1` (enable)
- JSON format never uses colors

**Independence from NODE_ENV**:

```bash
# These are completely independent:
NODE_ENV=production LOG_FORMAT=inline  # Inline logs in production
NODE_ENV=development LOG_FORMAT=json   # JSON logs in development
NODE_ENV=test LOG_FORMAT=inline        # Inline logs in tests
```

## Docker-Specific Variables

### Container Environment

```bash
# Docker Compose
environment:
  - NODE_ENV=production
  - LOG_LEVEL=INFO
  - INTERVAL_HOURS=5
  - DEBUG=false

# Docker Run
docker run -e NODE_ENV=production \
           -e LOG_LEVEL=INFO \
           -e INTERVAL_HOURS=5 \
           claudepulse
```

### Kubernetes ConfigMap

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: claudepulse-config
data:
  NODE_ENV: "production"
  LOG_LEVEL: "INFO"
  INTERVAL_HOURS: "5"
  MAX_RETRIES: "3"
  PROMPT_TEXT: "pulse check"
```

## Authentication Configuration

### OAuth Credentials Path

While not an environment variable, the credentials path is configurable:

**Default Location**: `~/.claude/.credentials.json`

**Custom Path** (programmatic):

```javascript
const oauth = new ClaudeOAuth({
  credentialsPath: "/custom/path/.credentials.json",
});
```

**Docker Mount**:

```yaml
volumes:
  - /host/custom/path:/home/claudeapp/.claude
```

## Advanced Configuration Examples

### High-Frequency Monitoring

```bash
# Check every hour with aggressive retries
INTERVAL_HOURS=1
MAX_RETRIES=5
RETRY_BACKOFF_MULTIPLIER=1.5
MAX_BACKOFF_MINUTES=10
LOG_LEVEL=INFO
```

### Low-Frequency Monitoring

```bash
# Check twice daily with patience
INTERVAL_HOURS=12
MAX_RETRIES=3
RETRY_BACKOFF_MULTIPLIER=2
MAX_BACKOFF_MINUTES=60
LOG_LEVEL=WARN
```

### Development Mode

```bash
# Detailed logging for development
NODE_ENV=development
LOG_LEVEL=DEBUG
INTERVAL_HOURS=0.1  # 6 minutes for testing
MAX_RETRIES=2
PROMPT_TEXT="dev test"
```

### Production Mode

```bash
# Optimized for production
NODE_ENV=production
LOG_LEVEL=INFO
INTERVAL_HOURS=5
MAX_RETRIES=3
RETRY_BACKOFF_MULTIPLIER=2
MAX_BACKOFF_MINUTES=30
PROMPT_TEXT="ping"
```

### High-Availability Mode

```bash
# Resilient configuration
NODE_ENV=production
LOG_LEVEL=WARN
INTERVAL_HOURS=4
MAX_RETRIES=5
RETRY_BACKOFF_MULTIPLIER=1.8
MAX_BACKOFF_MINUTES=45
PROMPT_TEXT="ha-pulse"
```

## Environment-Specific Configurations

### Local Development

Create `.env.development`:

```bash
NODE_ENV=development
LOG_LEVEL=DEBUG
DEBUG=true
INTERVAL_HOURS=0.25
MAX_RETRIES=2
PROMPT_TEXT="local dev test"
```

Load with:

```bash
npm run dev  # Automatically loads development config
```

### Staging Environment

Create `.env.staging`:

```bash
NODE_ENV=production
LOG_LEVEL=INFO
INTERVAL_HOURS=2
MAX_RETRIES=3
PROMPT_TEXT="staging pulse"
```

### Production Environment

Create `.env.production`:

```bash
NODE_ENV=production
LOG_LEVEL=WARN
INTERVAL_HOURS=5
MAX_RETRIES=3
RETRY_BACKOFF_MULTIPLIER=2
MAX_BACKOFF_MINUTES=30
PROMPT_TEXT="ping"
```

## Configuration Validation

### Built-in Validation

ClaudePulse validates configuration on startup:

```javascript
// Validation rules
const config = {
  intervalHours: {
    min: 0.1,
    max: 168,
    default: 5,
  },
  maxRetries: {
    min: 1,
    max: 10,
    default: 3,
  },
  // ... other validations
};
```

### Custom Validation Script

Create `validate-config.mjs`:

```javascript
import { ClaudeScheduler } from "./src/automation/scheduler.js";

const validateConfig = () => {
  try {
    const scheduler = new ClaudeScheduler();
    console.log("✅ Configuration valid");
    console.log("Config:", scheduler.config);
  } catch (error) {
    console.error("❌ Configuration invalid:", error.message);
    process.exit(1);
  }
};

validateConfig();
```

Run validation:

```bash
node validate-config.mjs
```

## Common Configuration Issues

### Issue: Excessive Token Usage

**Symptoms**: High Claude API costs
**Cause**: Too frequent intervals
**Solution**:

```bash
# Increase interval
INTERVAL_HOURS=8

# Use minimal prompt
PROMPT_TEXT="ok"
```

### Issue: Session Expiration

**Symptoms**: Authentication failures
**Cause**: Intervals too long for token refresh
**Solution**:

```bash
# Reduce interval
INTERVAL_HOURS=4

# More aggressive retries
MAX_RETRIES=5
```

### Issue: Excessive Logging

**Symptoms**: Large log files, disk space issues
**Solution**:

```bash
# Reduce log verbosity
LOG_LEVEL=WARN

# Use JSON logs for efficiency
NODE_ENV=production
```

### Issue: Retry Storms

**Symptoms**: Rapid repeated failures
**Cause**: Aggressive retry configuration
**Solution**:

```bash
# Increase backoff
RETRY_BACKOFF_MULTIPLIER=3
MAX_BACKOFF_MINUTES=60

# Reduce max retries
MAX_RETRIES=2
```

## Configuration Monitoring

### Log Configuration on Startup

ClaudePulse logs its configuration for verification:

```json
{
  "timestamp": "2025-09-22T12:00:00.000Z",
  "level": "INFO",
  "category": "scheduler",
  "message": "ClaudeScheduler initialized",
  "data": {
    "config": {
      "promptText": "ping",
      "intervalHours": 5,
      "maxRetries": 3,
      "retryBackoffMultiplier": 2,
      "maxBackoffMinutes": 30
    }
  }
}
```

### Runtime Configuration Changes

Monitor for configuration drift:

```bash
# Check current config
npm run metrics | jq '.data.config'

# Validate against expected
expected='{"intervalHours":5,"maxRetries":3}'
current=$(npm run metrics | jq '.data.config')
diff <(echo $expected) <(echo $current)
```

## Configuration Best Practices

### 1. Environment Separation

Use different configurations for each environment:

- **Development**: Verbose logging, short intervals
- **Staging**: Production-like with debug capabilities
- **Production**: Optimized for cost and reliability

### 2. Configuration Management

Store configuration in version control:

```bash
config/
├── .env.development
├── .env.staging
├── .env.production
└── .env.example
```

### 3. Secrets Management

Never store sensitive data in environment variables:

```bash
# ❌ Bad
CLAUDE_API_KEY=secret_key_here

# ✅ Good (OAuth handles this)
OAUTH_CREDENTIALS_PATH=/secure/path/.credentials.json
```

### 4. Monitoring and Alerting

Set up alerts for configuration issues:

- Token usage exceeding thresholds
- Retry rates above normal
- Authentication failures
- Unexpected log volume

### 5. Documentation

Document your configuration decisions:

```bash
# config/README.md
## Production Configuration Rationale

- INTERVAL_HOURS=5: Balances cost vs session persistence
- MAX_RETRIES=3: Sufficient resilience without excessive delays
- LOG_LEVEL=INFO: Captures important events without spam
```

This comprehensive environment variables reference ensures optimal ClaudePulse configuration for any deployment scenario.

---

## Scheduling Strategies and Priority

ClaudePulse uses a **strategy pattern** with clear priority ordering. Higher-priority strategies override lower-priority ones.

### Priority Order (Highest → Lowest)

```
1. External Signal Strategy    (Rate limit override)
2. Reset Hour Anchor Strategy  (Business hours alignment)
3. Session Expiry Strategy     (Smart session tracking)
4. Fixed Cadence Strategy      (Consistent intervals)
5. Initial Align Strategy      (Safe fallback)
```

### Strategy Details

| Priority | Strategy | Trigger | Next Run Time | Use Case |
|----------|----------|---------|---------------|-----------|
| **1** | **External Signal** | Rate limit message: `"5-hour limit reached ∙ resets 2pm"` | Reset hour + 10min buffer | **Overrides all others** |
| **2** | **Reset Hour Anchor** | `RESET_HOUR` set + no previous schedule | Next `RESET_HOUR:10` occurrence | **Business hours alignment** |
| **3** | **Session Expiry** | Active Claude session detected | Session window end + 10min | **Maximizes session time** |
| **4** | **Fixed Cadence** | Previous pulse exists | `lastScheduledTime + 5 hours` | **Maintains intervals** |
| **5** | **Initial Align** | No session history, no `RESET_HOUR` | Next hour + 10min (UTC) | **Safe default** |

### Configuration Examples

#### Business Hours Setup
```bash
# Align to 9am, 2pm, 7pm local time
RESET_HOUR=9  # Next runs: 9:10am, 2:10pm, 7:10pm, 12:10am, 5:10am...
```

#### Natural Session Flow
```bash
# No RESET_HOUR set - follows Claude session windows
# If session started at 14:23 UTC → next run at 19:33 UTC (5h + 10min)
```

### External Signal Behavior

**Trigger**: Claude CLI returns rate limit message
```
Error: 5-hour limit reached ∙ resets 2pm
```

**Action**:
- Parses `2pm` as local time (container timezone)
- Schedules next run at 14:10 local time
- Subsequent runs continue every 5 hours from that point

### Key Features

- **State Persistence**: `lastScheduledTime` preserved across auth failures
- **Timezone Aware**: Local time parsing with UTC calculations
- **Smart Recovery**: Automatic credential watching with seamless resume
- **Consistent Timing**: 10-minute safety buffer on all schedules

### Strategy Selection Flow

```
Schedule Request
       ↓
   Rate Limit? → Yes → External Signal (Priority 1)
       ↓ No
 Has Last Time? → Yes → Fixed Cadence (Priority 4)
       ↓ No
  RESET_HOUR Set? → Yes → Reset Hour Anchor (Priority 2)
       ↓ No
Session Active? → Yes → Session Expiry (Priority 3)
       ↓ No
   Initial Align (Priority 5)
```

### Log Messages

**Strategy Selection**:
```
"strategy": "external_signal" | "reset_hour_anchor" | "session_expiry" | "fixed_cadence" | "initial_align"
```

**Next Run Calculation**:
```json
{
  "next_run": "2025-09-26T14:10:00.000Z",
  "strategy": "external_signal",
  "reason": "Rate limit reset at 2pm local"
}
```

