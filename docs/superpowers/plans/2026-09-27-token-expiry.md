# Token Expiry Warnings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn on Discord 14, 7 and 1 day before the Claude token expires and once it has, and make a rejected token's alert say how to fix it.

**Architecture:** A `tokenExpiry` service holds the pure rules (days left, which threshold is due, the message) and a monitor with an injected clock and sender. `index.js` runs the monitor at startup and hourly when `TOKEN_EXPIRES_AT` is set. The scheduler's authentication-failure alerts get an actionable message.

**Tech Stack:** Node.js 22 ESM, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-27-scheduling-and-alerts-design.md` §4

## Global Constraints

- Node ≥ 22, no runtime npm dependencies; tests use `node:test` and `node:assert/strict` only.
- Branch `feat/token-expiry` from `main`; one PR; conventional commits.
- `TOKEN_EXPIRES_AT` is `YYYY-MM-DD`, meaning local midnight at the start of that day.
- Thresholds: 14, 7, 1 day(s) left, and 0 (expired). Days left = ceil((expiry − now) / 24 h).
- Alerts go to `DISCORD_WEBHOOK_URL` (WARN before expiry, ERROR after) and the log.
- The account label (if set) prefixes alert titles: `<label> · <title>`.
- Comments and docs describe what the code does now.

## Review Focus

- Starting the container 3 days before expiry → one "7 days" warning now, the "1 day" warning later, not a burst of 14 + 7.
- A date like `2027-02-30` → rejected at startup, not rolled over to March.
- An already-expired token at startup → one ERROR alert, not repeated every hour.
- No `DISCORD_WEBHOOK_URL` → the warning still reaches the log.
- The hourly check throwing (network error) → logged, never crashes the process.

---

### Task 1: Expiry rules and monitor

**Files:**
- Create: `src/core/services/tokenExpiry.js`
- Test: create `test/tokenExpiry.test.js`

**Interfaces:**
- Produces:
  - `parseExpiryDate(text: string): Date | null`
  - `daysLeft(expiresAt: Date, now: Date): number`
  - `dueThreshold(days: number): number | null` (14, 7, 1, 0 or null)
  - `buildExpiryWarning(days: number, expiresAt: Date, label?: string): {title, description, level}`
  - `createTokenExpiryMonitor({expiresAt, webhookUrl, label, logger, send?, now?}): {check(): Promise<void>}`

- [ ] **Step 1: Write the failing tests** (`test/tokenExpiry.test.js`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildExpiryWarning,
  createTokenExpiryMonitor,
  daysLeft,
  dueThreshold,
  parseExpiryDate,
} from "../src/core/services/tokenExpiry.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRY = new Date(2027, 8, 25); // 25 Sep 2027, local midnight

test("reads an expiry date as local midnight", () => {
  assert.deepEqual(parseExpiryDate("2027-09-25"), EXPIRY);
});

test("rejects a date that does not exist or is not YYYY-MM-DD", () => {
  for (const text of ["2027-02-30", "2027-13-01", "25/09/2027", "2027-9-25", ""]) {
    assert.equal(parseExpiryDate(text), null, text);
  }
});

test("counts partial days as a full day left", () => {
  assert.equal(daysLeft(EXPIRY, new Date(EXPIRY.getTime() - 1)), 1);
  assert.equal(daysLeft(EXPIRY, new Date(EXPIRY.getTime() - 6.5 * DAY_MS)), 7);
  assert.equal(daysLeft(EXPIRY, EXPIRY), 0);
});

test("picks the closest threshold at or above the days left", () => {
  assert.equal(dueThreshold(20), null);
  assert.equal(dueThreshold(14), 14);
  assert.equal(dueThreshold(13), 14);
  assert.equal(dueThreshold(7), 7);
  assert.equal(dueThreshold(3), 7);
  assert.equal(dueThreshold(1), 1);
  assert.equal(dueThreshold(0), 0);
  assert.equal(dueThreshold(-5), 0);
});

test("a warning before expiry says how to renew", () => {
  const warning = buildExpiryWarning(7, EXPIRY);

  assert.equal(warning.title, "Claude token expires in 7 days");
  assert.equal(warning.level, "WARN");
  assert.match(warning.description, /claude setup-token/);
  assert.match(warning.description, /<t:\d+:D>/);
});

test("an expired token is an error", () => {
  const warning = buildExpiryWarning(0, EXPIRY, "work");

  assert.equal(warning.title, "work · Claude token expired");
  assert.equal(warning.level, "ERROR");
});

test("says day, not days, for one day left", () => {
  assert.equal(buildExpiryWarning(1, EXPIRY).title, "Claude token expires in 1 day");
});

function buildMonitor(nowRef) {
  const sent = [];
  const warned = [];
  const monitor = createTokenExpiryMonitor({
    expiresAt: EXPIRY,
    webhookUrl: "https://discord.test/hook",
    logger: { warn: (_c, message) => warned.push(message), error: (_c, message) => warned.push(message) },
    send: async (payload) => sent.push(payload),
    now: () => nowRef.value,
  });
  return { monitor, sent, warned };
}

test("sends each threshold once", async () => {
  const now = { value: new Date(EXPIRY.getTime() - 3 * DAY_MS) };
  const { monitor, sent } = buildMonitor(now);

  await monitor.check();
  await monitor.check();
  now.value = new Date(EXPIRY.getTime() - 0.5 * DAY_MS);
  await monitor.check();
  now.value = new Date(EXPIRY.getTime() + DAY_MS);
  await monitor.check();
  await monitor.check();

  assert.deepEqual(
    sent.map((p) => p.title),
    [
      "Claude token expires in 3 days",
      "Claude token expires in 1 day",
      "Claude token expired",
    ],
  );
});

test("sends nothing while expiry is far away", async () => {
  const { monitor, sent } = buildMonitor({ value: new Date(EXPIRY.getTime() - 30 * DAY_MS) });

  await monitor.check();

  assert.deepEqual(sent, []);
});

test("logs each warning too", async () => {
  const { monitor, warned } = buildMonitor({ value: new Date(EXPIRY.getTime() - 3 * DAY_MS) });

  await monitor.check();

  assert.deepEqual(warned, ["Claude token expires in 3 days"]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/tokenExpiry.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (`src/core/services/tokenExpiry.js`)

```js
/**
 * Token Expiry Warnings
 * The token from `claude setup-token` lasts a year and ClaudePulse cannot
 * read its expiry, so the operator records it in TOKEN_EXPIRES_AT. Warnings
 * go out as expiry approaches, once per threshold.
 */

import { sendDiscordAlert } from "./notificationService.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days left at which a warning is sent; 0 means expired. */
export const WARNING_THRESHOLDS_DAYS = [14, 7, 1, 0];

/**
 * Parse YYYY-MM-DD as local midnight at the start of that day.
 * @param {string} text
 * @returns {Date|null} Null for a malformed or non-existent date
 */
export function parseExpiryDate(text) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text ?? "");
  if (!match) {
    return null;
  }
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(year, month - 1, day);
  const exists =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day;
  return exists ? date : null;
}

/**
 * Whole days left before expiry; a partial day counts as a full one.
 * @param {Date} expiresAt
 * @param {Date} now
 * @returns {number} 0 or less once expired
 */
export function daysLeft(expiresAt, now) {
  return Math.ceil((expiresAt.getTime() - now.getTime()) / DAY_MS);
}

/**
 * The warning threshold that applies with this many days left.
 * @param {number} days
 * @returns {number|null} Null when no warning applies yet
 */
export function dueThreshold(days) {
  if (days <= 0) {
    return 0;
  }
  const above = WARNING_THRESHOLDS_DAYS.filter((t) => t > 0 && t >= days);
  return above.length > 0 ? Math.min(...above) : null;
}

/**
 * The Discord payload warning about expiry.
 * @param {number} days - Days left, 0 or less once expired
 * @param {Date} expiresAt
 * @param {string} [label] - Account label prefixed to the title
 * @returns {{title: string, description: string, level: string}}
 */
export function buildExpiryWarning(days, expiresAt, label) {
  const epoch = Math.floor(expiresAt.getTime() / 1000);
  const renew =
    "Run `claude setup-token`, replace CLAUDE_CODE_OAUTH_TOKEN in claudepulse.env, update TOKEN_EXPIRES_AT and recreate the container.";
  const title =
    days <= 0
      ? "Claude token expired"
      : `Claude token expires in ${days} ${days === 1 ? "day" : "days"}`;

  return {
    title: label ? `${label} · ${title}` : title,
    description:
      days <= 0
        ? `Pulses fail until the token is renewed. ${renew}`
        : `It expires on <t:${epoch}:D>. ${renew}`,
    level: days <= 0 ? "ERROR" : "WARN",
  };
}

/**
 * Create a monitor that sends each due warning once.
 * @param {Object} options
 * @param {Date} options.expiresAt
 * @param {string|undefined} options.webhookUrl - Discord webhook; log only when unset
 * @param {string} [options.label] - Account label
 * @param {{warn: Function, error: Function}} options.logger
 * @param {Function} [options.send] - Discord sender (overridable in tests)
 * @param {() => Date} [options.now] - Clock (overridable in tests)
 * @returns {{check: () => Promise<void>}}
 */
export function createTokenExpiryMonitor({
  expiresAt,
  webhookUrl,
  label,
  logger,
  send = sendDiscordAlert,
  now = () => new Date(),
}) {
  const sentThresholds = new Set();

  return {
    async check() {
      const days = daysLeft(expiresAt, now());
      const threshold = dueThreshold(days);
      if (threshold === null || sentThresholds.has(threshold)) {
        return;
      }
      sentThresholds.add(threshold);

      const warning = buildExpiryWarning(days, expiresAt, label);
      // Logged at warn: logger.error would post to the same webhook again.
      logger.warn("token", warning.title, { expiresAt: expiresAt.toISOString(), daysLeft: days });
      await send(warning, webhookUrl);
    },
  };
}
```

The monitor logs with `logger.warn` even once expired: `logger.error` posts to the error webhook itself, which would duplicate the alert `send` already posts.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/tokenExpiry.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/services/tokenExpiry.js test/tokenExpiry.test.js
git commit -m "feat: compute token expiry warnings"
```

### Task 2: Config and startup wiring

**Files:**
- Modify: `src/core/config/index.js`
- Modify: `src/index.js`
- Test: `test/config.redaction.test.js`

**Interfaces:**
- Consumes: `parseExpiryDate`, `createTokenExpiryMonitor` (Task 1).
- Produces: `config.TOKEN_EXPIRES_AT: string | undefined`; validation error `TOKEN_EXPIRES_AT must be a date as YYYY-MM-DD`.

- [ ] **Step 1: Write the failing tests** (append)

```js
test("reads the token expiry date", async () => {
  const { loadConfig } = await import("../src/core/config/index.js");
  process.env.TOKEN_EXPIRES_AT = "2027-09-25";

  try {
    assert.equal(loadConfig().TOKEN_EXPIRES_AT, "2027-09-25");
  } finally {
    delete process.env.TOKEN_EXPIRES_AT;
  }
});

test("rejects a token expiry that is not a real date", async () => {
  const { loadConfig, validateConfig } = await import("../src/core/config/index.js");
  const config = { ...loadConfig(), TOKEN_EXPIRES_AT: "2027-02-30" };

  assert.throws(() => validateConfig(config), /TOKEN_EXPIRES_AT must be a date as YYYY-MM-DD/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/config.redaction.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/core/config/index.js`:

```js
import { parseExpiryDate } from "../services/tokenExpiry.js";
```

`DEFAULT_CONFIG`: `TOKEN_EXPIRES_AT: undefined,`; `parseEnvironmentVariables`: `TOKEN_EXPIRES_AT: process.env.TOKEN_EXPIRES_AT || undefined,`; `validateConfig`:

```js
  if (config.TOKEN_EXPIRES_AT !== undefined && !parseExpiryDate(config.TOKEN_EXPIRES_AT)) {
    errors.push("TOKEN_EXPIRES_AT must be a date as YYYY-MM-DD, e.g. 2027-09-25");
  }
```

`src/index.js`: import `{ createTokenExpiryMonitor, parseExpiryDate }` from `./core/services/tokenExpiry.js`, and in `runScheduler`, after `scheduler.start()` succeeded (after the "automation running" log):

```js
  if (config.TOKEN_EXPIRES_AT) {
    const monitor = createTokenExpiryMonitor({
      expiresAt: parseExpiryDate(config.TOKEN_EXPIRES_AT),
      webhookUrl: config.DISCORD_WEBHOOK_URL,
      label: config.ACCOUNT_LABEL,
      logger,
    });
    const checkExpiry = () =>
      monitor.check().catch((error) =>
        logger.warn("token", "Token expiry check failed", { error: error.message }),
      );
    await checkExpiry();
    // Hourly is plenty for day-sized thresholds; unref lets shutdown proceed.
    setInterval(checkExpiry, 60 * 60 * 1000).unref();
  }
```

- [ ] **Step 4: Run the suite and a smoke run**

Run: `npm test`
Expected: all PASS.

Run: `DRY_RUN=true TOKEN_EXPIRES_AT=2027-02-30 CLAUDE_CODE_OAUTH_TOKEN=placeholder node src/index.js; echo "exit=$?"`
Expected: `Configuration validation failed … TOKEN_EXPIRES_AT must be a date` and `exit=1`.

- [ ] **Step 5: Commit**

```bash
git add src/core/config/index.js src/index.js test/config.redaction.test.js
git commit -m "feat: warn before the Claude token expires"
```

### Task 3: A rejected token names the fix

**Files:**
- Modify: `src/features/scheduling/automation/scheduler.js` (`_executePulseCycle` auth branch, `_sendInitialPulse` failure branch)
- Test: `test/scheduler.window.test.js`

**Interfaces:**
- Produces: alert message `Token rejected - run \`claude setup-token\`, update claudepulse.env and recreate the container` for authentication failures in a cycle and at startup.

- [ ] **Step 1: Write the failing tests** (append; `buildScheduler`, `cycleAndSchedule` exist in the file)

```js
const AUTH_FAILURE = {
  success: false,
  authFailure: true,
  error: "API Error: 401 authentication_error",
  rateLimit: null,
};

test("a rejected token's alert says how to renew it", async () => {
  const { scheduler, record } = buildScheduler(AUTH_FAILURE);

  await cycleAndSchedule(scheduler);

  assert.match(record.alerts[0], /claude setup-token/);
});

test("a rejected token at startup says how to renew it", async () => {
  const { scheduler, record } = buildScheduler(AUTH_FAILURE);

  await scheduler._sendInitialPulse();

  assert.match(record.alerts[0], /claude setup-token/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/scheduler.window.test.js`
Expected: FAIL — alerts read "Authentication rejected - re-authenticate to resume pulsing" and "Initial pulse failed".

- [ ] **Step 3: Implement**

Near `isUnrecoverableAuthError` in `scheduler.js`:

```js
/** Alert text for a token the API no longer accepts. */
const TOKEN_REJECTED_MESSAGE =
  "Token rejected - run `claude setup-token`, update claudepulse.env and recreate the container";
```

In `_executePulseCycle`, the auth branch: `this._failCycle(TOKEN_REJECTED_MESSAGE, { error: result.error });`

In `_sendInitialPulse`, the failure branch:

```js
        this._failCycle(
          isUnrecoverableAuthError(result.error)
            ? TOKEN_REJECTED_MESSAGE
            : "Initial pulse failed",
          { error: result.error },
        );
```

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: all PASS (the existing "alerts when the startup pulse fails" test checks the count, not the text).

- [ ] **Step 5: Commit**

```bash
git add src/features/scheduling/automation/scheduler.js test/scheduler.window.test.js
git commit -m "feat: tell the operator how to renew a rejected token"
```

### Task 4: Document the expiry setting

**Files:**
- Modify: `README.md` (Settings table; Operating "Renew the token" paragraph)
- Modify: `ENVIRONMENT.md` (Quick Reference row; `TOKEN_EXPIRES_AT` section after `CLAUDE_CODE_OAUTH_TOKEN`)

- [ ] **Step 1: README**

Settings row:

```markdown
| `TOKEN_EXPIRES_AT`           | unset         | Token expiry (`YYYY-MM-DD`); Discord warnings 14, 7 and 1 day before   |
```

Operating, "Renew the token" paragraph gains a last sentence:

```markdown
Set `TOKEN_EXPIRES_AT` to the date one year after `claude setup-token` to be warned on Discord 14, 7 and 1 day before.
```

- [ ] **Step 2: ENVIRONMENT.md**

````markdown
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
````

- [ ] **Step 3: Verify and commit**

Run: `npm test`
Expected: all PASS.

```bash
git add README.md ENVIRONMENT.md
git commit -m "docs: explain token expiry warnings"
```
