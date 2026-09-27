# Rate-Limit Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface any rate-limit field ClaudePulse does not understand yet, so the next real limit event shows whether extra usage (paid credits) is in play, before deciding how to react to it.

**Architecture:** The executor keeps the unknown `rate_limit_info` fields as `rateLimit.unrecognised`. The scheduler logs each distinct set of unknown field names once, at WARN. No pulse behaviour changes.

**Tech Stack:** Node.js 22 ESM, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-27-scheduling-and-alerts-design.md` §5

## Global Constraints

- Node ≥ 22, no runtime npm dependencies; tests use `node:test` and `node:assert/strict` only.
- Branch `feat/rate-limit-probe` from `main`; one PR; conventional commits.
- Known fields: `status`, `resetsAt`, `utilization`, `rateLimitType`, `unifiedWindows`.
- Logged at WARN, never ERROR: an unknown field is information, not an outage, and ERROR posts to Discord.
- Comments and docs describe what the code does now.

## Review Focus

- The same unknown fields on every pulse → one log line, not one per pulse.
- The same field names with different values → still one line (names decide).
- An event with only known fields → `unrecognised` is null and nothing is logged.
- A pulse that failed before reporting any rate-limit state → no crash.
- Nested values (objects) in an unknown field → logged as JSON, not `[object Object]`.

---

### Task 1: The executor keeps unknown rate-limit fields

**Files:**
- Modify: `src/features/claude/executor/ClaudeCliExecutor.js` (`extractRateLimit`)
- Test: `test/ClaudeCliExecutor.parse.test.js`

**Interfaces:**
- Produces: `rateLimit.unrecognised: Object | null` — unknown field names to their raw values.

- [ ] **Step 1: Write the failing tests** (append)

```js
test("keeps rate-limit fields it does not know", () => {
  const r = ClaudeCliExecutor.parseResult({
    stdout: stream(
      rateLimitLine({
        ...OBSERVED_EVENT,
        isUsingOverage: true,
        overageResetsAt: SEVEN_DAY_RESET,
      }),
      SUCCESS_JSON,
    ),
    stderr: "",
    exitCode: 0,
  });

  assert.deepEqual(r.rateLimit.unrecognised, {
    isUsingOverage: true,
    overageResetsAt: SEVEN_DAY_RESET,
  });
});

test("reports no unknown fields for the observed event", () => {
  const r = ClaudeCliExecutor.parseResult({
    stdout: stream(rateLimitLine(OBSERVED_EVENT), SUCCESS_JSON),
    stderr: "",
    exitCode: 0,
  });

  assert.equal(r.rateLimit.unrecognised, null);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/ClaudeCliExecutor.parse.test.js`
Expected: FAIL — `unrecognised` is undefined.

- [ ] **Step 3: Implement**

Above `extractRateLimit`:

```js
/** rate_limit_info fields ClaudePulse understands. */
const KNOWN_RATE_LIMIT_FIELDS = new Set([
  "status",
  "resetsAt",
  "utilization",
  "rateLimitType",
  "unifiedWindows",
]);

/**
 * The rate_limit_info fields ClaudePulse does not understand, with their
 * values, or null when there are none.
 * @param {Object} info
 * @returns {Object|null}
 */
function unrecognisedFields(info) {
  const entries = Object.entries(info).filter(
    ([name]) => !KNOWN_RATE_LIMIT_FIELDS.has(name),
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}
```

Add to the object `extractRateLimit` returns: `unrecognised: unrecognisedFields(info),` and to its JSDoc `@returns`: `unrecognised: Object|null`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/claude/executor/ClaudeCliExecutor.js test/ClaudeCliExecutor.parse.test.js
git commit -m "feat: keep rate-limit fields the executor does not understand"
```

### Task 2: The scheduler logs each set of unknown fields once

**Files:**
- Modify: `src/features/scheduling/automation/scheduler.js` (constructor, `_processPulseResult`, new `_reportUnrecognisedFields`)
- Test: create `test/scheduler.probe.test.js`

**Interfaces:**
- Consumes: `rateLimit.unrecognised` (Task 1).
- Produces: WARN log `"Unrecognised rate-limit fields"` with data `{ fields: <JSON string> }`, category `ratelimit`.

- [ ] **Step 1: Write the failing tests** (`test/scheduler.probe.test.js`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import { PulseScheduler } from "../src/features/scheduling/automation/scheduler.js";

function buildScheduler() {
  const warnings = [];
  const logger = {
    info() {},
    warn: (_category, message, data) => warnings.push({ message, data }),
    debug() {},
    error() {},
    startTimer: () => ({}),
    endTimer: () => ({ ms: 1 }),
    logScheduler() {},
    child() {
      return logger;
    },
  };
  const scheduler = new PulseScheduler({
    executor: { pulse: async () => ({}) },
    logger,
    config: { PROMPT_TEXT: "pulse check" },
  });
  return { scheduler, warnings };
}

function pulseWith(unrecognised) {
  return {
    success: true,
    rateLimit: { status: "allowed", resetsAt: null, fiveHourResetsAt: null, unrecognised },
  };
}

const probeWarnings = (warnings) =>
  warnings.filter((w) => w.message === "Unrecognised rate-limit fields");

test("logs unknown rate-limit fields once per set of names", () => {
  const { scheduler, warnings } = buildScheduler();

  scheduler._processPulseResult(pulseWith({ isUsingOverage: true }));
  scheduler._processPulseResult(pulseWith({ isUsingOverage: false }));
  scheduler._processPulseResult(pulseWith({ isUsingOverage: true, overageResetsAt: 1 }));

  assert.equal(probeWarnings(warnings).length, 2);
});

test("logs nested values as JSON", () => {
  const { scheduler, warnings } = buildScheduler();

  scheduler._processPulseResult(pulseWith({ overage: { status: "on" } }));

  assert.equal(probeWarnings(warnings)[0].data.fields, '{"overage":{"status":"on"}}');
});

test("logs nothing when every field is known", () => {
  const { scheduler, warnings } = buildScheduler();

  scheduler._processPulseResult(pulseWith(null));
  scheduler._processPulseResult({ success: false, rateLimit: null });

  assert.deepEqual(probeWarnings(warnings), []);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/scheduler.probe.test.js`
Expected: FAIL — no warnings logged.

- [ ] **Step 3: Implement**

Constructor state, after `this.rateLimit = null;`:

```js
    // Names of unknown rate-limit field sets already logged
    this.reportedFieldSets = new Set();
```

In `_processPulseResult`, after the `if (pulseResult.rateLimit)` block: `this._reportUnrecognisedFields(pulseResult.rateLimit);`

New method:

```js
  /**
   * Log rate-limit fields ClaudePulse does not understand, once per distinct
   * set of names. They show what a pulse reports in situations not yet
   * handled, such as extra usage.
   * @param {?{unrecognised: ?Object}} rateLimit
   */
  _reportUnrecognisedFields(rateLimit) {
    const fields = rateLimit?.unrecognised;
    if (!fields) {
      return;
    }
    const key = Object.keys(fields).sort().join(",");
    if (this.reportedFieldSets.has(key)) {
      return;
    }
    this.reportedFieldSets.add(key);
    this.logger.warn("ratelimit", "Unrecognised rate-limit fields", {
      fields: JSON.stringify(fields),
    });
  }
```

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/scheduling/automation/scheduler.js test/scheduler.probe.test.js
git commit -m "feat: log unrecognised rate-limit fields once"
```

### Task 3: Document what to do with the log line

**Files:**
- Modify: `ENVIRONMENT.md` (Troubleshooting: new "Unrecognised Rate-Limit Fields" entry)

- [ ] **Step 1: Add the entry**

````markdown
### Unrecognised Rate-Limit Fields

**Symptoms:** `[WARN] [RATELIMIT] Unrecognised rate-limit fields (…)` in the logs.
**Meaning:** A pulse reported rate-limit data ClaudePulse does not use yet,
for example about extra usage. Pulsing is unaffected. Each set of fields is
logged once per container start.

```bash
docker logs claudepulse | grep -i "Unrecognised rate-limit fields"
```

Please open an issue with that line, so the next version can act on it.
````

- [ ] **Step 2: Verify and commit**

Run: `npm test`
Expected: all PASS.

```bash
git add ENVIRONMENT.md
git commit -m "docs: explain the unrecognised rate-limit fields log line"
```

### After merge (not code)

- [ ] Watch production logs after the next limit is reached with extra usage enabled on the account, and write the follow-up design for T48 from the fields that appear.
