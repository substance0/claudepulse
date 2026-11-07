import { test } from "node:test";
import assert from "node:assert/strict";

import { weeklyResetShift } from "../src/features/scheduling/strategy/scheduling-strategies.js";
import {
  buildWeeklyShiftNotification,
  createWindowNotifier,
} from "../src/core/services/windowNotification.js";
import { PulseScheduler } from "../src/features/scheduling/automation/scheduler.js";

const HOUR_MS = 60 * 60 * 1000;
const at = (hhmm) => new Date(`2026-11-03T${hhmm}:00.000+01:00`);

// The pulse at 22:30 on 2 November: its window ends 03:30, the weekly limit
// resets 04:00, and work hours push the next pulse to 07:30.
function rateLimit(overrides = {}) {
  return {
    status: "allowed",
    resetsAt: at("03:30"),
    fiveHourResetsAt: at("03:30"),
    weekly: { utilization: 0.42, resetsAt: at("04:00") },
    ...overrides,
  };
}

test("a weekly reset that lands before the next pulse moves the pulse to the end of the window it opens", () => {
  const shift = weeklyResetShift(rateLimit(), at("07:30"));

  assert.deepEqual(shift, {
    weeklyResetAt: at("04:00"),
    windowEnd: at("09:00"),
    nextPulseAt: new Date(at("09:00").getTime() + 10 * 1000),
  });
});

test("no shift when the next pulse comes before the weekly reset", () => {
  assert.equal(weeklyResetShift(rateLimit(), at("03:30")), null);
});

test("no shift once the pulse follows the window the weekly reset opens", () => {
  assert.equal(weeklyResetShift(rateLimit(), at("09:00")), null);
  assert.equal(
    weeklyResetShift(rateLimit(), new Date(at("09:00").getTime() + 10000)),
    null,
  );
});

test("no shift when a window is still open at the weekly reset", () => {
  const limit = rateLimit({ fiveHourResetsAt: at("05:00") });

  assert.equal(weeklyResetShift(limit, at("07:30")), null);
});

test("no shift when the weekly reset or the window is unknown", () => {
  assert.equal(weeklyResetShift(null, at("07:30")), null);
  assert.equal(weeklyResetShift(rateLimit({ weekly: null }), at("07:30")), null);
  assert.equal(
    weeklyResetShift(rateLimit({ fiveHourResetsAt: null }), at("07:30")),
    null,
  );
});

const SHIFT = {
  weeklyResetAt: at("04:00"),
  windowEnd: at("09:00"),
  plannedAt: at("07:30"),
  nextPulseAt: at("09:00"),
};
const epoch = (date) => date.getTime() / 1000;

test("the heads-up names the weekly reset, the window it opens, the pulse it displaces and the new pulse", () => {
  const payload = buildWeeklyShiftNotification(SHIFT);

  assert.equal(payload.level, "WARN");
  assert.match(payload.title, /shift/i);
  assert.match(payload.description, new RegExp(`<t:${epoch(SHIFT.weeklyResetAt)}:f>`));
  assert.match(payload.description, new RegExp(`<t:${epoch(SHIFT.windowEnd)}:t>`));
  assert.match(payload.description, new RegExp(`<t:${epoch(SHIFT.plannedAt)}:t>`));
  assert.match(payload.description, new RegExp(`<t:${epoch(SHIFT.nextPulseAt)}:t>`));
  // Absolute times only: a countdown goes stale in the channel history
  assert.doesNotMatch(payload.description, /:R>/);
});

test("the window notifier posts the heads-up to its webhook", async () => {
  const sent = [];
  const notifier = createWindowNotifier("https://example.test/hook", {
    send: async (payload, url) => sent.push({ payload, url }),
    label: "Martin",
  });

  await notifier.notifyWeeklyShift(SHIFT);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://example.test/hook");
  assert.match(sent[0].payload.title, /^Martin · /);
});

function buildScheduler(notifier, limit, workHours) {
  const logger = {
    info() {},
    warn() {},
    debug() {},
    error() {},
    startTimer: () => ({ end() {} }),
    endTimer: () => ({ ms: 1 }),
    logScheduler(event, data) {
      logger.logged.push({ event, ...data });
    },
    logged: [],
    child() {
      return logger;
    },
  };
  const scheduler = new PulseScheduler({
    executor: { pulse: async () => ({ success: true }) },
    logger,
    config: { PROMPT_TEXT: "p", MAX_RETRIES: 1 },
    notifier,
    workHours,
  });
  scheduler.logged = logger.logged;
  scheduler.running = true;
  scheduler.rateLimit = limit;
  return scheduler;
}

// A window ending in 3 hours and a weekly reset 30 minutes after it. Work
// hours hold the next pulse until 4 hours from now, inside the window the
// weekly reset opens.
function scenario() {
  const now = Date.now();
  const limit = {
    status: "allowed",
    resetsAt: new Date(now + 3 * HOUR_MS),
    fiveHourResetsAt: new Date(now + 3 * HOUR_MS),
    weekly: { utilization: 0.4, resetsAt: new Date(now + 3.5 * HOUR_MS) },
  };
  const workStart = now + 4 * HOUR_MS;
  const workHours = {
    nextAllowed: (t) => (t.getTime() < workStart ? new Date(workStart) : t),
  };
  return { limit, workHours, windowEnd: now + 8.5 * HOUR_MS };
}

test("the scheduler moves the pulse to the end of the window the weekly reset opens and says so", async () => {
  const warned = [];
  const { limit, workHours, windowEnd } = scenario();
  const scheduler = buildScheduler(
    { notify: async () => {}, notifyWeeklyShift: async (s) => warned.push(s) },
    limit,
    workHours,
  );

  await scheduler._scheduleNext();
  clearTimeout(scheduler.timer);

  assert.equal(scheduler.lastScheduledTime.getTime(), windowEnd + 10 * 1000);
  assert.equal(warned.length, 1);
  assert.equal(warned[0].nextPulseAt.getTime(), windowEnd + 10 * 1000);
  assert.equal(scheduler.logged.at(-1).strategy, "weekly_reset");
  assert.ok(warned[0].plannedAt instanceof Date);
});

test("the scheduler warns once per weekly reset", async () => {
  const warned = [];
  const { limit, workHours } = scenario();
  const scheduler = buildScheduler(
    { notify: async () => {}, notifyWeeklyShift: async (s) => warned.push(s) },
    limit,
    workHours,
  );

  await scheduler._scheduleNext();
  await scheduler._scheduleNext();
  clearTimeout(scheduler.timer);

  assert.equal(warned.length, 1);
});

test("the scheduler does not shift a pulse refused at the weekly limit", async () => {
  const warned = [];
  const now = Date.now();
  const resetsAt = new Date(now + 3.5 * HOUR_MS);
  const limit = {
    status: "rejected",
    resetsAt,
    fiveHourResetsAt: new Date(now + 3 * HOUR_MS),
    weekly: { utilization: 1, resetsAt },
  };
  const scheduler = buildScheduler(
    { notify: async () => {}, notifyWeeklyShift: async (s) => warned.push(s) },
    limit,
  );

  await scheduler._scheduleNext();
  clearTimeout(scheduler.timer);

  assert.equal(scheduler.lastScheduledTime.getTime(), resetsAt.getTime() + 10 * 1000);
  assert.equal(warned.length, 0);
});

test("the scheduler shifts a weekly-limit refusal that work hours moved into the opened window", async () => {
  const now = Date.now();
  const resetsAt = new Date(now + 3.5 * HOUR_MS);
  const limit = {
    status: "rejected",
    resetsAt,
    fiveHourResetsAt: new Date(now + 3 * HOUR_MS),
    weekly: { utilization: 1, resetsAt },
  };
  const workStart = now + 4 * HOUR_MS;
  const workHours = {
    nextAllowed: (t) => (t.getTime() < workStart ? new Date(workStart) : t),
  };
  const scheduler = buildScheduler({ notify: async () => {} }, limit, workHours);

  await scheduler._scheduleNext();
  clearTimeout(scheduler.timer);

  assert.equal(
    scheduler.lastScheduledTime.getTime(),
    resetsAt.getTime() + 5 * HOUR_MS + 10 * 1000,
  );
});

test("the shifted time is held to work hours too", async () => {
  const { limit, windowEnd } = scenario();
  const nextMorning = windowEnd + 12 * HOUR_MS;
  const workHours = {
    nextAllowed: (t) => (t.getTime() < windowEnd + 60 * 1000 ? new Date(nextMorning) : t),
  };
  const scheduler = buildScheduler({ notify: async () => {} }, limit, workHours);

  await scheduler._scheduleNext();
  clearTimeout(scheduler.timer);

  assert.equal(scheduler.lastScheduledTime.getTime(), nextMorning);
});

test("the scheduler leaves the pulse alone when the weekly reset does not reach it", async () => {
  const warned = [];
  const { limit, workHours } = scenario();
  limit.weekly.resetsAt = new Date(Date.now() + 40 * HOUR_MS);
  const scheduler = buildScheduler(
    { notify: async () => {}, notifyWeeklyShift: async (s) => warned.push(s) },
    limit,
    workHours,
  );

  await scheduler._scheduleNext();
  clearTimeout(scheduler.timer);

  assert.equal(warned.length, 0);
  // Held by work hours to 4 hours from now, not moved past the weekly window
  const wait = scheduler.lastScheduledTime.getTime() - Date.now();
  assert.ok(Math.abs(wait - 4 * HOUR_MS) < 5000);
});

test("a window notifier without the heads-up method does not break scheduling", async () => {
  const { limit, workHours } = scenario();
  const scheduler = buildScheduler({ notify: async () => {} }, limit, workHours);

  await assert.doesNotReject(scheduler._scheduleNext());
  clearTimeout(scheduler.timer);
});
