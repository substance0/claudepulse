# Weekly Limit Awareness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read the weekly window each pulse reports, say "Weekly limit reached" when that is what blocks pulsing, and show weekly usage in window notifications and logs.

**Architecture:** The executor's `extractRateLimit` adds `weekly` and `limitType` to the rate-limit state. The window notifier and the pulse log formatter read them. Scheduling is unchanged: a rejected pulse already waits for its `resetsAt`, whichever limit it is.

**Tech Stack:** Node.js 22 ESM, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-27-scheduling-and-alerts-design.md` §3

## Global Constraints

- Node ≥ 22, no runtime npm dependencies; tests use `node:test` and `node:assert/strict` only.
- Branch `feat/weekly-limit` from `main`; one PR; conventional commits.
- `utilization` is a fraction (0.2 = 20 %), as observed on a real pulse.
- `rateLimitType` and `unifiedWindows` are undocumented: read when present, never required.
- Comments and docs describe what the code does now.

## Review Focus

- A rejection whose `rateLimitType` is missing but whose `resetsAt` equals the weekly reset → still announced as the weekly limit.
- `unifiedWindows.seven_day` present without `utilization` → no "Weekly usage" line, no `NaN%`.
- A 5-hour rejection while weekly data is present → still "Usage limit reached", not weekly.
- `utilization` above 1 (over the limit) → shown as-is (e.g. 104 %), not clamped silently.
- The account label from `createWindowNotifier` → still prefixes the weekly title.

---

### Task 1: The executor reads the weekly window

**Files:**
- Modify: `src/features/claude/executor/ClaudeCliExecutor.js` (`extractRateLimit`)
- Test: `test/ClaudeCliExecutor.parse.test.js`

**Interfaces:**
- Produces: `rateLimit.weekly: {utilization: number|null, resetsAt: Date|null} | null`; `rateLimit.limitType: string|null`.

- [ ] **Step 1: Write the failing tests** (append; `OBSERVED_EVENT`, `SEVEN_DAY_RESET`, `rateLimitLine`, `stream`, `SUCCESS_JSON` already exist in the file)

```js
test("reads the weekly window reported by a pulse", () => {
  const r = ClaudeCliExecutor.parseResult({
    stdout: stream(rateLimitLine(OBSERVED_EVENT), SUCCESS_JSON),
    stderr: "",
    exitCode: 0,
  });

  assert.equal(r.rateLimit.weekly.utilization, 0.2);
  assert.equal(r.rateLimit.weekly.resetsAt.getTime(), SEVEN_DAY_RESET * 1000);
  assert.equal(r.rateLimit.limitType, "five_hour");
});

test("reports no weekly window when the event has none", () => {
  const r = ClaudeCliExecutor.parseResult({
    stdout: stream(rateLimitLine({ status: "allowed", resetsAt: FIVE_HOUR_RESET }), SUCCESS_JSON),
    stderr: "",
    exitCode: 0,
  });

  assert.equal(r.rateLimit.weekly, null);
  assert.equal(r.rateLimit.limitType, null);
});

test("keeps a weekly window that reports no utilization", () => {
  const r = ClaudeCliExecutor.parseResult({
    stdout: stream(
      rateLimitLine({
        status: "allowed",
        resetsAt: FIVE_HOUR_RESET,
        unifiedWindows: { seven_day: { resetsAt: SEVEN_DAY_RESET } },
      }),
      SUCCESS_JSON,
    ),
    stderr: "",
    exitCode: 0,
  });

  assert.equal(r.rateLimit.weekly.utilization, null);
  assert.equal(r.rateLimit.weekly.resetsAt.getTime(), SEVEN_DAY_RESET * 1000);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/ClaudeCliExecutor.parse.test.js`
Expected: FAIL — `Cannot read properties of undefined (reading 'utilization')`.

- [ ] **Step 3: Implement**

Update the JSDoc `@returns` of `extractRateLimit` to
`{{status: string, resetsAt: Date|null, fiveHourResetsAt: Date|null, limitType: string|null, weekly: {utilization: number|null, resetsAt: Date|null}|null}|null}`
and extend the returned object:

```js
  const sevenDay = info.unifiedWindows?.seven_day;

  return {
    status: info.status,
    resetsAt: fromEpochSeconds(info.resetsAt),
    fiveHourResetsAt:
      fromEpochSeconds(info.unifiedWindows?.five_hour?.resetsAt) ??
      (resetsAtIsFiveHour ? fromEpochSeconds(info.resetsAt) : null),
    limitType: info.rateLimitType ?? null,
    weekly: sevenDay
      ? {
          utilization: Number.isFinite(sevenDay.utilization)
            ? sevenDay.utilization
            : null,
          resetsAt: fromEpochSeconds(sevenDay.resetsAt),
        }
      : null,
  };
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/claude/executor/ClaudeCliExecutor.js test/ClaudeCliExecutor.parse.test.js
git commit -m "feat: read the weekly window from each pulse"
```

### Task 2: Notifications name the weekly limit and show weekly usage

**Files:**
- Modify: `src/core/services/windowNotification.js` (`buildWindowNotification` and helpers)
- Test: `test/windowNotification.test.js`

**Interfaces:**
- Consumes: `rateLimit.weekly`, `rateLimit.limitType` (Task 1).
- Produces: titles `"Weekly limit reached"` (WARN), `"Usage limit reached"` (WARN), `"Window open"` (SUCCESS, description may end with `\nWeekly usage: N% · resets <t:E:R>`).

- [ ] **Step 1: Write the failing tests** (append; `RESET`, `RESET_EPOCH` exist)

```js
const WEEK_RESET = new Date("2026-09-28T07:00:00.000Z");
const WEEK_EPOCH = WEEK_RESET.getTime() / 1000;

test("names the weekly limit when it is what blocks pulsing", () => {
  const payload = buildWindowNotification({
    success: false,
    rateLimit: {
      status: "rejected",
      resetsAt: WEEK_RESET,
      fiveHourResetsAt: null,
      limitType: "seven_day",
      weekly: { utilization: 1, resetsAt: WEEK_RESET },
    },
  });

  assert.equal(payload.title, "Weekly limit reached");
  assert.equal(payload.level, "WARN");
  // Days away, so the date matters as much as the countdown
  assert.match(payload.description, new RegExp(`<t:${WEEK_EPOCH}:F>`));
  assert.match(payload.description, new RegExp(`<t:${WEEK_EPOCH}:R>`));
});

test("recognises a weekly rejection by its reset time alone", () => {
  const payload = buildWindowNotification({
    success: false,
    rateLimit: {
      status: "rejected",
      resetsAt: WEEK_RESET,
      fiveHourResetsAt: null,
      limitType: null,
      weekly: { utilization: 1, resetsAt: WEEK_RESET },
    },
  });

  assert.equal(payload.title, "Weekly limit reached");
});

test("a 5-hour rejection is not the weekly limit", () => {
  const payload = buildWindowNotification({
    success: false,
    rateLimit: {
      status: "rejected",
      resetsAt: RESET,
      fiveHourResetsAt: RESET,
      limitType: "five_hour",
      weekly: { utilization: 0.4, resetsAt: WEEK_RESET },
    },
  });

  assert.equal(payload.title, "Usage limit reached");
});

test("an open window shows weekly usage", () => {
  const payload = buildWindowNotification({
    success: true,
    rateLimit: {
      status: "allowed",
      resetsAt: RESET,
      fiveHourResetsAt: RESET,
      weekly: { utilization: 0.2, resetsAt: WEEK_RESET },
    },
  });

  assert.match(payload.description, new RegExp(`Weekly usage: 20% · resets <t:${WEEK_EPOCH}:R>`));
});

test("shows weekly usage above the limit as reported", () => {
  const payload = buildWindowNotification({
    success: true,
    rateLimit: {
      status: "allowed",
      resetsAt: RESET,
      fiveHourResetsAt: RESET,
      weekly: { utilization: 1.04, resetsAt: WEEK_RESET },
    },
  });

  assert.match(payload.description, /Weekly usage: 104%/);
});

test("leaves weekly usage out when it is unknown", () => {
  const payload = buildWindowNotification({
    success: true,
    rateLimit: {
      status: "allowed",
      resetsAt: RESET,
      fiveHourResetsAt: RESET,
      weekly: { utilization: null, resetsAt: WEEK_RESET },
    },
  });

  assert.doesNotMatch(payload.description, /Weekly usage/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/windowNotification.test.js`
Expected: FAIL — title `Usage limit reached` for the weekly cases; no `Weekly usage` line.

- [ ] **Step 3: Implement** in `windowNotification.js`

Add helpers after `isValidDate`:

```js
/** Discord markup for a date and time days away: full date, then countdown. */
function discordDateTime(date) {
  const epoch = Math.floor(date.getTime() / 1000);
  return `<t:${epoch}:F> (<t:${epoch}:R>)`;
}

/**
 * Whether a rejected pulse is blocked by the weekly limit. The limit type is
 * undocumented, so a reset matching the weekly window's also counts.
 * @param {Object} rateLimit
 * @returns {boolean}
 */
function isWeeklyRejection(rateLimit) {
  if (rateLimit.limitType === "seven_day") {
    return true;
  }
  const weeklyReset = rateLimit.weekly?.resetsAt;
  return (
    isValidDate(weeklyReset) &&
    isValidDate(rateLimit.resetsAt) &&
    weeklyReset.getTime() === rateLimit.resetsAt.getTime()
  );
}

/**
 * A line showing weekly usage, or "" when the weekly window is unknown.
 * @param {?{utilization: ?number, resetsAt: ?Date}} weekly
 * @returns {string}
 */
function weeklyUsageLine(weekly) {
  if (!Number.isFinite(weekly?.utilization) || !isValidDate(weekly.resetsAt)) {
    return "";
  }
  const percent = Math.round(weekly.utilization * 100);
  const epoch = Math.floor(weekly.resetsAt.getTime() / 1000);
  return `\nWeekly usage: ${percent}% · resets <t:${epoch}:R>`;
}
```

In `buildWindowNotification`, inside the `rejected` branch, after the `isValidDate(rateLimit.resetsAt)` guard:

```js
    if (isWeeklyRejection(rateLimit)) {
      return {
        title: "Weekly limit reached",
        description: `Pulsing resumes when the weekly limit lifts on ${discordDateTime(rateLimit.resetsAt)}.`,
        level: "WARN",
      };
    }
```

and in the "Window open" return:

```js
    description: `The current window resets at ${discordTime(windowReset)}.${weeklyUsageLine(rateLimit.weekly)}`,
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/services/windowNotification.js test/windowNotification.test.js
git commit -m "feat: announce the weekly limit and show weekly usage"
```

### Task 3: The pulse log shows weekly usage

**Files:**
- Modify: `src/features/scheduling/automation/scheduler.js` (`_sendPulse` success log)
- Modify: `src/core/utils/logger.js` (`pulse` case of `_formatDataForInline`)
- Test: `test/logger.pulse-format.test.js`

**Interfaces:**
- Consumes: `rateLimit.weekly.utilization` (Task 1).
- Produces: pulse log field `weeklyUsage: number|undefined`, formatted `weekly=20%`.

- [ ] **Step 1: Write the failing test** (append)

```js
test("shows weekly usage after a successful pulse", () => {
  const line = formatPulse({
    windowResetsAt: "2026-09-24T13:50:00.000Z",
    weeklyUsage: 0.2,
  });

  assert.match(line, /weekly=20%/);
});

test("leaves weekly usage out when unknown", () => {
  assert.doesNotMatch(formatPulse({ weeklyUsage: undefined }), /weekly=/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test test/logger.pulse-format.test.js`
Expected: FAIL on `/weekly=20%/`.

- [ ] **Step 3: Implement**

In the `pulse` case of `_formatDataForInline`, before `if (data.cost !== undefined)`:

```js
        if (Number.isFinite(data.weeklyUsage)) {
          parts.push(`weekly=${Math.round(data.weeklyUsage * 100)}%`);
        }
```

In `scheduler.js` `_sendPulse`, add to the "Pulse successful" data:

```js
          weeklyUsage: result.rateLimit?.weekly?.utilization ?? undefined,
```

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/utils/logger.js src/features/scheduling/automation/scheduler.js test/logger.pulse-format.test.js
git commit -m "feat: log weekly usage with each successful pulse"
```

### Task 4: Document weekly limit behaviour

**Files:**
- Modify: `README.md` (Features "Window Notifications" row; Operating example log line)
- Modify: `ENVIRONMENT.md` (`DISCORD_WINDOW_WEBHOOK_URL` section)

- [ ] **Step 1: README**

Features row becomes:

```markdown
| **Window Notifications**    | Optional Discord message each time a window opens (with weekly usage) or a 5-hour or weekly limit is reached, with reset times in your local time zone |
```

Operating example line becomes:

```text
# [INFO] [PULSE] Pulse successful (window_resets=…, weekly=20%, cost=…)
```

- [ ] **Step 2: ENVIRONMENT.md** — in the `DISCORD_WINDOW_WEBHOOK_URL` behaviour list, replace the "Usage limit reached" bullet with:

```markdown
- When a pulse is refused, posts "Usage limit reached" with the time the
  limit lifts, or "Weekly limit reached" with the date and time the weekly
  limit lifts. Pulsing resumes on its own at that time.
- "Window open" also shows weekly usage and when the weekly window resets.
```

- [ ] **Step 3: Verify and commit**

Run: `npm test`
Expected: all PASS.

```bash
git add README.md ENVIRONMENT.md
git commit -m "docs: describe weekly limit notifications"
```
