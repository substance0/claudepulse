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

test("a weekly reset that lands before the next pulse shifts the next window", () => {
  const shift = weeklyResetShift(rateLimit(), at("07:30"));

  assert.deepEqual(shift, {
    weeklyResetAt: at("04:00"),
    windowEnd: at("09:00"),
  });
});

test("no shift when the next pulse comes before the weekly reset", () => {
  assert.equal(weeklyResetShift(rateLimit(), at("03:30")), null);
});

test("no shift when the window the weekly reset would open has ended by the next pulse", () => {
  assert.equal(weeklyResetShift(rateLimit(), at("09:00")), null);
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

const SHIFT = { weeklyResetAt: at("04:00"), windowEnd: at("09:00") };
const epoch = (date) => date.getTime() / 1000;

test("the heads-up names the weekly reset, the window it would open and the pulse it displaces", () => {
  const payload = buildWeeklyShiftNotification({
    ...SHIFT,
    nextPulseAt: at("07:30"),
  });

  assert.equal(payload.level, "WARN");
  assert.match(payload.title, /shift/i);
  assert.match(payload.description, new RegExp(`<t:${epoch(SHIFT.weeklyResetAt)}:f>`));
  assert.match(payload.description, new RegExp(`<t:${epoch(SHIFT.windowEnd)}:t>`));
  assert.match(payload.description, new RegExp(`<t:${epoch(at("07:30"))}:t>`));
  // Absolute times only: a countdown goes stale in the channel history
  assert.doesNotMatch(payload.description, /:R>/);
});

test("the window notifier posts the heads-up to its webhook", async () => {
  const sent = [];
  const notifier = createWindowNotifier("https://example.test/hook", {
    send: async (payload, url) => sent.push({ payload, url }),
    label: "Martin",
  });

  await notifier.notifyWeeklyShift({ ...SHIFT, nextPulseAt: at("07:30") });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://example.test/hook");
  assert.match(sent[0].payload.title, /^Martin · /);
});

function buildScheduler(notifier, limit) {
  const logger = {
    info() {},
    warn() {},
    debug() {},
    error() {},
    startTimer: () => ({ end() {} }),
    endTimer: () => ({ ms: 1 }),
    logScheduler() {},
    child() {
      return logger;
    },
  };
  const scheduler = new PulseScheduler({
    executor: { pulse: async () => ({ success: true }) },
    logger,
    config: { PROMPT_TEXT: "p", MAX_RETRIES: 1 },
    notifier,
  });
  scheduler.running = true;
  scheduler.rateLimit = limit;
  return scheduler;
}

// A weekly reset 4 hours ahead and a window ending 3 hours ahead: the pulse
// that follows the window falls inside the window the weekly reset opens.
function shiftingLimit() {
  const now = Date.now();
  return {
    status: "allowed",
    resetsAt: new Date(now + 3 * HOUR_MS),
    fiveHourResetsAt: new Date(now + 3 * HOUR_MS),
    weekly: { utilization: 0.4, resetsAt: new Date(now + 3.5 * HOUR_MS) },
  };
}

test("the scheduler warns once per weekly reset when the next pulse would land in its window", async () => {
  const warned = [];
  const scheduler = buildScheduler(
    { notify: async () => {}, notifyWeeklyShift: async (s) => warned.push(s) },
    shiftingLimit(),
  );
  scheduler.workHours = { nextAllowed: (t) => new Date(t.getTime() + HOUR_MS) };

  await scheduler._scheduleNext();
  await scheduler._scheduleNext();
  clearTimeout(scheduler.timer);

  assert.equal(warned.length, 1);
  assert.ok(warned[0].nextPulseAt instanceof Date);
});

test("the scheduler stays quiet when the weekly reset does not shift the next pulse", async () => {
  const warned = [];
  const limit = shiftingLimit();
  limit.weekly.resetsAt = new Date(Date.now() + 40 * HOUR_MS);
  const scheduler = buildScheduler(
    { notify: async () => {}, notifyWeeklyShift: async (s) => warned.push(s) },
    limit,
  );

  await scheduler._scheduleNext();
  clearTimeout(scheduler.timer);

  assert.equal(warned.length, 0);
});

test("a window notifier without the heads-up method does not break scheduling", async () => {
  const scheduler = buildScheduler({ notify: async () => {} }, shiftingLimit());

  await assert.doesNotReject(scheduler._scheduleNext());
  clearTimeout(scheduler.timer);
});
