import { test } from "node:test";
import assert from "node:assert/strict";

import { PulseScheduler } from "../src/features/scheduling/automation/scheduler.js";

const HOUR_MS = 60 * 60 * 1000;

function buildScheduler(limit, workHours) {
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
    workHours,
  });
  scheduler.running = true;
  scheduler.rateLimit = limit;
  return scheduler;
}

// Martin's night: the window ends in 3 hours, the weekly limit resets 30
// minutes after it, and work hours hold the next pulse until 4 hours from now,
// inside 5 hours of the weekly reset. Neither Oct 13 nor Oct 20 shifted a
// window when the weekly limit reset, so the pulse stays where it is planned.
test("a weekly reset before the next pulse does not move the pulse", async () => {
  const now = Date.now();
  const workStart = now + 4 * HOUR_MS;
  const scheduler = buildScheduler(
    {
      status: "allowed",
      resetsAt: new Date(now + 3 * HOUR_MS),
      fiveHourResetsAt: new Date(now + 3 * HOUR_MS),
      weekly: { utilization: 0.4, resetsAt: new Date(now + 3.5 * HOUR_MS) },
    },
    { nextAllowed: (t) => (t.getTime() < workStart ? new Date(workStart) : t) },
  );

  await scheduler._scheduleNext();
  clearTimeout(scheduler.timer);

  assert.equal(scheduler.lastScheduledTime.getTime(), workStart);
});

test("a weekly reset exactly at the end of the window does not move the pulse", async () => {
  const now = Date.now();
  const windowEnd = now + 3 * HOUR_MS;
  const scheduler = buildScheduler({
    status: "allowed",
    resetsAt: new Date(windowEnd),
    fiveHourResetsAt: new Date(windowEnd),
    weekly: { utilization: 0.06, resetsAt: new Date(windowEnd) },
  });

  await scheduler._scheduleNext();
  clearTimeout(scheduler.timer);

  assert.equal(scheduler.lastScheduledTime.getTime(), windowEnd + 10 * 1000);
});
