# Work Hours Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pulse only during working hours, and open the first window of each working day early enough that it has `HOURS_LEFT_AT_START` hours left when work starts.

**Architecture:** A pure `workHours` module turns the settings into two functions, `nextAllowed(t)` and `isActive(t)`. The scheduler receives it by injection: every planned pulse time passes through `nextAllowed`, and the startup pulse is skipped outside an active period. Strategies are unchanged.

**Tech Stack:** Node.js 22 ESM, local-time `Date` arithmetic (container `TZ`), `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-27-scheduling-and-alerts-design.md` §2

## Global Constraints

- Node ≥ 22, no runtime npm dependencies; tests use `node:test` and `node:assert/strict` only.
- Branch `feat/work-hours` from `main` (after the account-label PR merged); one PR; conventional commits.
- All clock times are local time in the container's `TZ`.
- Day-start pulse: target reset = `WORK_START + HOURS_LEFT_AT_START` rounded **up** to the hour; pulse at target − 5 h, second `:10`.
- Active period: [day-start pulse, `WORK_END`) of each day in `WORK_DAYS`; `WORK_END` exclusive.
- `HOURS_LEFT_AT_START` integer 1–5, default 5. `WORK_DAYS` default every day.
- `nextAllowed(t)` never returns a time earlier than `t`.
- Comments and docs describe what the code does now.

## Review Focus

- A daylight-saving change between two working days (Europe/Paris, Sun 25 Oct 2026) → the Monday day-start pulse is still 06:00:10 local, not 05:00 or 07:00.
- `WORK_START` early enough that the day-start pulse falls on the previous calendar day (01:00 + 1 h → 21:00:10 the day before) → that evening is active for the next working day.
- A rejected pulse whose limit lifts after `WORK_END` → the pulse moves to the next working day, never before the lift.
- `WORK_DAYS` written in lower case or as a wrapping range (`fri-mon`) → accepted.
- A container started at 02:00 → no startup pulse; the log names the next day-start pulse.

---

### Task 1: `workHours` module — parsing and validation

**Files:**
- Create: `src/features/scheduling/workHours.js`
- Test: create `test/workHours.test.js`

**Interfaces:**
- Produces:
  - `parseClock(text: string | undefined): {hour: number, minute: number} | null`
  - `parseWorkDays(text: string): Set<number> | null` (0 = Sunday … 6 = Saturday)
  - `workHoursErrors(config: Object): string[]` (reads `WORK_START`, `WORK_END`, `WORK_DAYS`, `HOURS_LEFT_AT_START`, `SCHEDULED_START_HOUR`)

- [ ] **Step 1: Write the failing tests** (`test/workHours.test.js`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseClock,
  parseWorkDays,
  workHoursErrors,
} from "../src/features/scheduling/workHours.js";

test("reads a 24-hour clock time", () => {
  assert.deepEqual(parseClock("09:30"), { hour: 9, minute: 30 });
  assert.deepEqual(parseClock("00:00"), { hour: 0, minute: 0 });
});

test("rejects a clock time that is not HH:MM", () => {
  for (const text of ["9:30", "24:00", "09:60", "0930", "", undefined]) {
    assert.equal(parseClock(text), null, String(text));
  }
});

test("reads day ranges and lists in any case", () => {
  assert.deepEqual([...parseWorkDays("Mon-Fri")].sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual([...parseWorkDays("mon,wed")].sort(), [1, 3]);
  assert.deepEqual([...parseWorkDays("Mon-Thu,Sat")].sort(), [1, 2, 3, 4, 6]);
});

test("a range can wrap over the weekend", () => {
  assert.deepEqual([...parseWorkDays("Fri-Mon")].sort(), [0, 1, 5, 6]);
});

test("rejects an unknown day name", () => {
  assert.equal(parseWorkDays("Mon-Funday"), null);
  assert.equal(parseWorkDays(""), null);
});

test("accepts a complete work-hours configuration", () => {
  const errors = workHoursErrors({
    WORK_START: "09:00",
    WORK_END: "19:00",
    HOURS_LEFT_AT_START: "2",
    WORK_DAYS: "Mon-Fri",
  });

  assert.deepEqual(errors, []);
});

test("accepts no work-hours configuration at all", () => {
  assert.deepEqual(workHoursErrors({}), []);
});

test("explains each invalid work-hours setting", () => {
  const cases = [
    [{ WORK_START: "9h", WORK_END: "19:00" }, /WORK_START must be HH:MM/],
    [{ WORK_START: "09:00" }, /WORK_END is required/],
    [{ WORK_START: "09:00", WORK_END: "7pm" }, /WORK_END must be HH:MM/],
    [{ WORK_START: "19:00", WORK_END: "09:00" }, /WORK_END must be later than WORK_START/],
    [{ WORK_START: "09:00", WORK_END: "19:00", HOURS_LEFT_AT_START: "6" }, /HOURS_LEFT_AT_START must be a whole number from 1 to 5/],
    [{ WORK_START: "09:00", WORK_END: "19:00", HOURS_LEFT_AT_START: "2.5" }, /HOURS_LEFT_AT_START/],
    [{ WORK_START: "09:00", WORK_END: "19:00", WORK_DAYS: "Weekdays" }, /WORK_DAYS must list days/],
    [{ WORK_END: "19:00" }, /require WORK_START/],
    [{ WORK_START: "09:00", WORK_END: "19:00", SCHEDULED_START_HOUR: 6 }, /not both/],
  ];

  for (const [config, expected] of cases) {
    assert.match(workHoursErrors(config).join("\n"), expected, JSON.stringify(config));
  }
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/workHours.test.js`
Expected: FAIL — `Cannot find module '…/workHours.js'`.

- [ ] **Step 3: Implement** (`src/features/scheduling/workHours.js`)

```js
/**
 * Work hours: when pulses are allowed, and when the first window of a working
 * day opens.
 *
 * A window ends at its first prompt's hour, rounded down, plus 5 hours. To
 * have HOURS_LEFT_AT_START hours left when work starts, the day's first pulse
 * fires 5 hours before WORK_START + HOURS_LEFT_AT_START, rounded up to the
 * hour. All times are local to the container's TZ.
 */

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * Parse a 24-hour HH:MM clock time.
 * @param {string|undefined} text
 * @returns {{hour: number, minute: number}|null}
 */
export function parseClock(text) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text ?? "");
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
}

/**
 * Parse a list of days and day ranges, such as "Mon-Fri" or "Mon-Thu,Sat".
 * A range may wrap over the weekend ("Fri-Mon").
 * @param {string} text
 * @returns {Set<number>|null} Days as 0 (Sunday) to 6 (Saturday)
 */
export function parseWorkDays(text) {
  const days = new Set();

  for (const part of String(text).split(",")) {
    const [from, to = from] = part.trim().toLowerCase().split("-");
    const first = DAY_NAMES.indexOf(from);
    const last = DAY_NAMES.indexOf(to);
    if (first < 0 || last < 0) {
      return null;
    }
    for (let day = first; ; day = (day + 1) % 7) {
      days.add(day);
      if (day === last) break;
    }
  }

  return days;
}

/**
 * Validation errors for the work-hours settings, empty when they are valid
 * or unset.
 * @param {Object} config - Loaded configuration
 * @returns {string[]}
 */
export function workHoursErrors(config) {
  const errors = [];
  const { WORK_START, WORK_END, WORK_DAYS, HOURS_LEFT_AT_START } = config;

  if (WORK_START === undefined) {
    if ([WORK_END, WORK_DAYS, HOURS_LEFT_AT_START].some((v) => v !== undefined)) {
      errors.push("WORK_END, WORK_DAYS and HOURS_LEFT_AT_START require WORK_START");
    }
    return errors;
  }

  const start = parseClock(WORK_START);
  if (!start) {
    errors.push("WORK_START must be HH:MM (24-hour), e.g. 09:00");
  }

  if (WORK_END === undefined) {
    errors.push("WORK_END is required with WORK_START");
  } else {
    const end = parseClock(WORK_END);
    if (!end) {
      errors.push("WORK_END must be HH:MM (24-hour), e.g. 19:00");
    } else if (start && end.hour * 60 + end.minute <= start.hour * 60 + start.minute) {
      errors.push("WORK_END must be later than WORK_START on the same day");
    }
  }

  if (HOURS_LEFT_AT_START !== undefined && !/^[1-5]$/.test(String(HOURS_LEFT_AT_START))) {
    errors.push("HOURS_LEFT_AT_START must be a whole number from 1 to 5");
  }

  if (WORK_DAYS !== undefined && !parseWorkDays(WORK_DAYS)) {
    errors.push("WORK_DAYS must list days or ranges, e.g. Mon-Fri or Mon-Thu,Sat");
  }

  if (config.SCHEDULED_START_HOUR !== undefined) {
    errors.push("Set WORK_START or SCHEDULED_START_HOUR, not both");
  }

  return errors;
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/workHours.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/scheduling/workHours.js test/workHours.test.js
git commit -m "feat: parse and validate work-hours settings"
```

### Task 2: `workHours` module — day-start pulse and `nextAllowed`

**Files:**
- Modify: `src/features/scheduling/workHours.js`
- Test: create `test/workHours.schedule.test.js`

**Interfaces:**
- Consumes: `parseClock`, `parseWorkDays` (Task 1).
- Produces:
  - `createWorkHours({start, end, hoursLeft, days}): {nextAllowed(t: Date): Date, isActive(t: Date): boolean}`
  - `createWorkHoursFromConfig(config): ReturnType<createWorkHours> | null` (null when `WORK_START` unset; assumes `workHoursErrors(config)` is empty)

- [ ] **Step 1: Write the failing tests** (`test/workHours.schedule.test.js`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";

// Europe/Paris switches from summer to winter time on Sun 25 Oct 2026.
process.env.TZ = "Europe/Paris";

const { createWorkHoursFromConfig } = await import(
  "../src/features/scheduling/workHours.js"
);

/** A local time; month is 1-12. */
const local = (month, day, hour, minute = 0, second = 0) =>
  new Date(2026, month - 1, day, hour, minute, second);

// Mon 28 Sep 2026 … Sun 4 Oct 2026, then Mon 5 Oct.
const weekdays = createWorkHoursFromConfig({
  WORK_START: "09:00",
  WORK_END: "19:00",
  HOURS_LEFT_AT_START: "2",
  WORK_DAYS: "Mon-Fri",
});

test("keeps a pulse planned during working hours", () => {
  const t = local(9, 30, 11, 0, 10); // Wed 11:00:10

  assert.equal(weekdays.nextAllowed(t).getTime(), t.getTime());
  assert.equal(weekdays.isActive(t), true);
});

test("opens the working day so 2 hours are left at 09:00", () => {
  // Wed 03:00 → Wed 06:00:10, whose window resets at 11:00
  assert.deepEqual(weekdays.nextAllowed(local(9, 30, 3)), local(9, 30, 6, 0, 10));
});

test("moves an evening pulse to the next working day", () => {
  assert.deepEqual(weekdays.nextAllowed(local(9, 30, 21, 0, 10)), local(10, 1, 6, 0, 10));
});

test("skips the weekend", () => {
  assert.deepEqual(weekdays.nextAllowed(local(10, 2, 21, 0, 10)), local(10, 5, 6, 0, 10));
  assert.deepEqual(weekdays.nextAllowed(local(10, 3, 10)), local(10, 5, 6, 0, 10));
});

test("WORK_END is exclusive", () => {
  const justBefore = local(9, 30, 18, 59, 59);

  assert.equal(weekdays.nextAllowed(justBefore).getTime(), justBefore.getTime());
  assert.deepEqual(weekdays.nextAllowed(local(9, 30, 19)), local(10, 1, 6, 0, 10));
});

test("the time before the day-start pulse is not active", () => {
  assert.equal(weekdays.isActive(local(9, 30, 5, 59)), false);
});

test("rounds the target reset up to the hour", () => {
  const halfPast = createWorkHoursFromConfig({
    WORK_START: "09:30",
    WORK_END: "19:00",
    HOURS_LEFT_AT_START: "2",
  });

  // 09:30 + 2 h = 11:30 → reset 12:00 → pulse 07:00:10 (2.5 h left at 09:30)
  assert.deepEqual(halfPast.nextAllowed(local(9, 30, 3)), local(9, 30, 7, 0, 10));
});

test("defaults to opening the window when work starts", () => {
  const atStart = createWorkHoursFromConfig({ WORK_START: "09:00", WORK_END: "19:00" });

  assert.deepEqual(atStart.nextAllowed(local(9, 30, 3)), local(9, 30, 9, 0, 10));
});

test("keeps the local day-start time across a daylight-saving change", () => {
  // Sun 25 Oct is the switch; Monday's pulse is still 06:00:10 local
  const next = weekdays.nextAllowed(local(10, 25, 21));

  assert.equal(next.getDate(), 26);
  assert.equal(next.getHours(), 6);
  assert.equal(next.getMinutes(), 0);
});

test("a day-start pulse can fall on the previous evening", () => {
  const early = createWorkHoursFromConfig({
    WORK_START: "01:00",
    WORK_END: "10:00",
    HOURS_LEFT_AT_START: "1",
  });

  // 01:00 + 1 h = 02:00 reset → pulse 21:00:10 the evening before
  assert.deepEqual(early.nextAllowed(local(9, 29, 12)), local(9, 29, 21, 0, 10));
  assert.equal(early.isActive(local(9, 29, 22)), true);
});

test("never returns a time earlier than asked", () => {
  for (let hour = 0; hour < 24 * 7; hour += 1) {
    const t = local(9, 28, 0 + hour);
    assert.ok(weekdays.nextAllowed(t) >= t, t.toString());
  }
});

test("is off without WORK_START", () => {
  assert.equal(createWorkHoursFromConfig({}), null);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/workHours.schedule.test.js`
Expected: FAIL — `createWorkHoursFromConfig is not a function`.

- [ ] **Step 3: Implement** (append to `src/features/scheduling/workHours.js`)

```js
const HOUR_MS = 60 * 60 * 1000;
const WINDOW_HOURS = 5;
/** Second of the minute pulses fire at, clear of the reset boundary. */
const PULSE_SECOND = 10;
/** Working days searched ahead: enough to reach any day of the week. */
const SEARCH_DAYS = 8;

/** The given day at a clock time. */
function atClock(day, clock) {
  const d = new Date(day);
  d.setHours(clock.hour, clock.minute, 0, 0);
  return d;
}

/** Round up to the next full hour, unless already on one. */
function ceilToHour(date) {
  const d = new Date(date);
  if (d.getMinutes() || d.getSeconds() || d.getMilliseconds()) {
    d.setHours(d.getHours() + 1, 0, 0, 0);
  }
  return d;
}

/**
 * Build the work-hours rules.
 * @param {{start: {hour, minute}, end: {hour, minute}, hoursLeft: number, days: Set<number>}} settings
 * @returns {{nextAllowed: (t: Date) => Date, isActive: (t: Date) => boolean}}
 */
export function createWorkHours({ start, end, hoursLeft, days }) {
  /** First pulse of a working day, so hoursLeft hours remain at start. */
  function dayStartPulse(workDay) {
    const targetReset = ceilToHour(
      new Date(atClock(workDay, start).getTime() + hoursLeft * HOUR_MS),
    );
    const pulse = new Date(targetReset);
    pulse.setHours(pulse.getHours() - WINDOW_HOURS, 0, PULSE_SECOND, 0);
    return pulse;
  }

  /**
   * The earliest time at or after t inside an active period.
   * @param {Date} t
   * @returns {Date}
   */
  function nextAllowed(t) {
    for (let offset = -1; offset <= SEARCH_DAYS; offset++) {
      const workDay = new Date(t);
      workDay.setHours(12, 0, 0, 0);
      workDay.setDate(workDay.getDate() + offset);
      if (!days.has(workDay.getDay())) continue;

      const periodStart = dayStartPulse(workDay);
      const periodEnd = atClock(workDay, end);
      if (t < periodEnd) {
        return t >= periodStart ? new Date(t) : periodStart;
      }
    }
    throw new Error("No working day found in WORK_DAYS");
  }

  return {
    nextAllowed,
    isActive: (t) => nextAllowed(t).getTime() === t.getTime(),
  };
}

/**
 * Build the work-hours rules from validated configuration.
 * @param {Object} config - Configuration that passed workHoursErrors()
 * @returns {ReturnType<typeof createWorkHours>|null} Null when WORK_START is unset
 */
export function createWorkHoursFromConfig(config) {
  if (config.WORK_START === undefined) {
    return null;
  }
  return createWorkHours({
    start: parseClock(config.WORK_START),
    end: parseClock(config.WORK_END),
    hoursLeft: Number(config.HOURS_LEFT_AT_START ?? WINDOW_HOURS),
    days: parseWorkDays(config.WORK_DAYS ?? "Mon-Sun"),
  });
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `node --test test/workHours.schedule.test.js test/workHours.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/scheduling/workHours.js test/workHours.schedule.test.js
git commit -m "feat: compute the day-start pulse and the next allowed pulse time"
```

### Task 3: Config loads and validates the work-hours settings

**Files:**
- Modify: `src/core/config/index.js`
- Test: `test/config.redaction.test.js`

**Interfaces:**
- Consumes: `workHoursErrors` (Task 1).
- Produces: `config.WORK_START`, `WORK_END`, `WORK_DAYS`, `HOURS_LEFT_AT_START` as strings or `undefined` (empty → `undefined`); `validateConfig` throws with the work-hours messages.

- [ ] **Step 1: Write the failing tests** (append)

```js
test("reads the work-hours settings", async () => {
  const { loadConfig } = await import("../src/core/config/index.js");
  Object.assign(process.env, {
    WORK_START: "09:00",
    WORK_END: "19:00",
    WORK_DAYS: "Mon-Fri",
    HOURS_LEFT_AT_START: "2",
  });

  try {
    const config = loadConfig();
    assert.equal(config.WORK_START, "09:00");
    assert.equal(config.WORK_END, "19:00");
    assert.equal(config.WORK_DAYS, "Mon-Fri");
    assert.equal(config.HOURS_LEFT_AT_START, "2");
  } finally {
    for (const key of ["WORK_START", "WORK_END", "WORK_DAYS", "HOURS_LEFT_AT_START"]) {
      delete process.env[key];
    }
  }
});

test("rejects work hours that end before they start", async () => {
  const { loadConfig, validateConfig } = await import("../src/core/config/index.js");
  const config = { ...loadConfig(), WORK_START: "19:00", WORK_END: "09:00" };

  assert.throws(() => validateConfig(config), /WORK_END must be later than WORK_START/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/config.redaction.test.js`
Expected: FAIL (`undefined !== "09:00"`, no throw).

- [ ] **Step 3: Implement**

At the top of `src/core/config/index.js`:

```js
import { workHoursErrors } from "../../features/scheduling/workHours.js";
```

`DEFAULT_CONFIG`: add `WORK_START: undefined, WORK_END: undefined, WORK_DAYS: undefined, HOURS_LEFT_AT_START: undefined,`.
`parseEnvironmentVariables`: add

```js
    WORK_START: process.env.WORK_START || undefined,
    WORK_END: process.env.WORK_END || undefined,
    WORK_DAYS: process.env.WORK_DAYS || undefined,
    HOURS_LEFT_AT_START: process.env.HOURS_LEFT_AT_START || undefined,
```

`validateConfig`, before the `errors.length` check: `errors.push(...workHoursErrors(config));`

- [ ] **Step 4: Run to verify they pass**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/config/index.js test/config.redaction.test.js
git commit -m "feat: load and validate the work-hours settings"
```

### Task 4: Scheduler respects work hours

**Files:**
- Modify: `src/features/scheduling/automation/scheduler.js` (constructor, `_scheduleNext`, `dryRunAnalysis`, `start`)
- Modify: `src/index.js` (inject `workHours`)
- Test: create `test/scheduler.workHours.test.js`

**Interfaces:**
- Consumes: `createWorkHoursFromConfig(config)` (Task 2) — the scheduler only calls `nextAllowed(t)` and `isActive(t)`.
- Produces: `new PulseScheduler({ …, workHours })`; scheduled strategy `"work_hours"` when a time was moved.

- [ ] **Step 1: Write the failing tests** (`test/scheduler.workHours.test.js`)

```js
import { test } from "node:test";
import assert from "node:assert/strict";

import { PulseScheduler } from "../src/features/scheduling/automation/scheduler.js";

const HOUR_MS = 60 * 60 * 1000;

function buildScheduler({ workHours, pulseResult }) {
  const record = { attempts: 0, scheduled: [], infos: [] };
  const logger = {
    info: (_category, message) => record.infos.push(message),
    warn() {},
    debug() {},
    error() {},
    startTimer: () => ({}),
    endTimer: () => ({ ms: 1 }),
    logScheduler: (event, data) => {
      if (event === "next_pulse_scheduled") record.scheduled.push(data);
    },
    child() {
      return logger;
    },
  };
  const scheduler = new PulseScheduler({
    executor: {
      pulse: async () => {
        record.attempts += 1;
        return pulseResult;
      },
    },
    logger,
    config: { PROMPT_TEXT: "pulse check", MAX_RETRIES: 3 },
    workHours,
  });
  scheduler._sleep = async () => {};
  return { scheduler, record };
}

function allowedPulse(windowReset) {
  return {
    success: true,
    authFailure: false,
    message: { total_cost_usd: 0, duration_ms: 1, session_id: "s" },
    rateLimit: { status: "allowed", resetsAt: windowReset, fiveHourResetsAt: windowReset },
  };
}

const identity = { nextAllowed: (t) => new Date(t), isActive: () => true };

test("moves a pulse planned outside work hours to the next working day", async () => {
  // Arrange
  const nextMorning = new Date(Date.now() + 20 * HOUR_MS);
  const { scheduler, record } = buildScheduler({
    workHours: { nextAllowed: () => nextMorning, isActive: () => true },
    pulseResult: allowedPulse(new Date(Date.now() + 3 * HOUR_MS)),
  });
  scheduler.running = true;

  // Act
  try {
    await scheduler._executePulseCycle();
    await scheduler._scheduleNext();
  } finally {
    await scheduler.shutdown();
  }

  // Assert
  assert.equal(record.scheduled.at(-1).strategy, "work_hours");
  assert.equal(new Date(record.scheduled.at(-1).nextRunTime).getTime(), nextMorning.getTime());
});

test("keeps a pulse planned inside work hours", async () => {
  const { scheduler, record } = buildScheduler({
    workHours: identity,
    pulseResult: allowedPulse(new Date(Date.now() + 3 * HOUR_MS)),
  });
  scheduler.running = true;

  try {
    await scheduler._executePulseCycle();
    await scheduler._scheduleNext();
  } finally {
    await scheduler.shutdown();
  }

  assert.equal(record.scheduled.at(-1).strategy, "window_reset");
});

test("skips the startup pulse outside work hours", async () => {
  const { scheduler, record } = buildScheduler({
    workHours: {
      nextAllowed: () => new Date(Date.now() + 4 * HOUR_MS),
      isActive: () => false,
    },
    pulseResult: allowedPulse(new Date(Date.now() + 3 * HOUR_MS)),
  });

  try {
    await scheduler.start();
  } finally {
    await scheduler.shutdown();
  }

  assert.equal(record.attempts, 0);
  assert.ok(record.infos.some((m) => /outside work hours/i.test(m)));
});

test("sends the startup pulse inside work hours", async () => {
  const { scheduler, record } = buildScheduler({
    workHours: identity,
    pulseResult: allowedPulse(new Date(Date.now() + 3 * HOUR_MS)),
  });

  try {
    await scheduler.start();
  } finally {
    await scheduler.shutdown();
  }

  assert.equal(record.attempts, 1);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/scheduler.workHours.test.js`
Expected: FAIL — strategy `window_reset` instead of `work_hours`; startup attempts 1 instead of 0.

- [ ] **Step 3: Implement** in `scheduler.js`

Constructor JSDoc: add `@param {{nextAllowed: Function, isActive: Function}} [options.workHours] - Limits pulses to working hours`. After `this.notifier = options.notifier;`:

```js
    this.workHours = options.workHours ?? null;
```

In `_scheduleNext`, change `const { time: planned, strategy }` to `let { time: planned, strategy }`, and after the roll-forward loop, before `this.lastScheduledTime = finalTime;`:

```js
    // Outside working hours, the pulse waits for the next working day.
    if (this.workHours) {
      const allowed = this.workHours.nextAllowed(finalTime);
      if (allowed.getTime() !== finalTime.getTime()) {
        finalTime = allowed;
        strategy = "work_hours";
      }
    }
```

In `dryRunAnalysis`, replace the `optimalNextRun` computation:

```js
    const firstPulse =
      this._nextFromInitialPulseHourPlusTen() ?? this._nextHourPlusTen();
    const optimalNextRun = this.workHours
      ? this.workHours.nextAllowed(firstPulse)
      : firstPulse;
```

In `start`, replace the `immediatePulseAfterAuth` block:

```js
    // The first pulse reports the current window, which every later pulse is
    // scheduled from. Outside working hours it would open a window nobody
    // uses, so the working day's first pulse is left to the schedule.
    if (this.config.immediatePulseAfterAuth) {
      if (this.workHours && !this.workHours.isActive(new Date())) {
        this.logger.info(
          "startup",
          "Outside work hours - no startup pulse, waiting for the working day",
        );
      } else {
        await this._sendInitialPulse();
      }
    }
```

In `src/index.js`: `import { createWorkHoursFromConfig } from "./features/scheduling/workHours.js";` and pass `workHours: createWorkHoursFromConfig(config),` to `new PulseScheduler({…})`.

- [ ] **Step 4: Run the suite and a dry run**

Run: `npm test`
Expected: all PASS.

Run: `DRY_RUN=true WORK_START=09:00 WORK_END=19:00 HOURS_LEFT_AT_START=2 WORK_DAYS=Mon-Fri CLAUDE_CODE_OAUTH_TOKEN=placeholder NO_COLOR=1 node src/index.js | grep "Scheduling Analysis"`
Expected: `scheduled_for=` the next hour when run on a weekday between 06:00 and 19:00, otherwise the next working day at `06:00:10`.

- [ ] **Step 5: Commit**

```bash
git add src/features/scheduling/automation/scheduler.js src/index.js test/scheduler.workHours.test.js
git commit -m "feat: pulse only during work hours and open the working day early"
```

### Task 5: Document work hours

**Files:**
- Modify: `README.md` (How It Works step 3; Settings table; replace the `SCHEDULED_START_HOUR` row's description to say it is for a single first pulse)
- Modify: `ENVIRONMENT.md` (Quick Reference rows; new "Work Hours" section after `SCHEDULED_START_HOUR`)

- [ ] **Step 1: README**

How It Works, step 3 becomes:

```markdown
3. **Work hours** (optional): with `WORK_START`, `WORK_END` and `HOURS_LEFT_AT_START`, the first pulse of each working day lands so the window has that many hours left when you start, and no pulse is sent at night or on days off. Without them, ClaudePulse pulses right away at startup to learn the current window, and pulses around the clock.
```

Settings rows (after `TZ`):

```markdown
| `WORK_START`                 | unset         | When your working day starts (`HH:MM`); turns work hours on            |
| `WORK_END`                   | unset         | No window starts at or after this time (`HH:MM`); required with `WORK_START` |
| `HOURS_LEFT_AT_START`        | `5`           | Hours left in the window at `WORK_START` (1-5)                         |
| `WORK_DAYS`                  | every day     | Working days, e.g. `Mon-Fri` or `Mon-Thu,Sat`                          |
```

- [ ] **Step 2: ENVIRONMENT.md section**

````markdown
### Work Hours

**Purpose:** Pulse only during your working day, and open its first window
early so part of it is left when you start, followed soon by a fresh one.

| Setting               | Format         | Default   |
| --------------------- | -------------- | --------- |
| `WORK_START`          | `HH:MM`        | unset     |
| `WORK_END`            | `HH:MM`        | required with `WORK_START` |
| `HOURS_LEFT_AT_START` | 1-5            | `5`       |
| `WORK_DAYS`           | `Mon-Fri`, `Mon-Thu,Sat`, `Fri-Mon` | every day |

A window ends at its first prompt's hour, rounded down, plus 5 hours. With
`WORK_START=09:00` and `HOURS_LEFT_AT_START=2`, the day's first pulse fires at
06:00:10: its window resets at 11:00, leaving 2 hours at 09:00, and the next
window opens at 11:00. Pulses then follow each reset until `WORK_END`; none
is sent at night or on other days, and none at startup outside these hours.

With a start that is not on the hour, the window has at least
`HOURS_LEFT_AT_START` hours left: `09:30` with 2 opens at 07:00:10, leaving
2.5 hours.

`WORK_START` and `SCHEDULED_START_HOUR` cannot both be set.

```bash
WORK_START=09:00
WORK_END=19:00
HOURS_LEFT_AT_START=2
WORK_DAYS=Mon-Fri
```
````

- [ ] **Step 3: Verify**

Run: `npx --yes markdown-link-check -q README.md && npm test`
Expected: no dead links; all PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md ENVIRONMENT.md
git commit -m "docs: explain work hours and the day-start pulse"
```
