import { test } from "node:test";
import assert from "node:assert/strict";

import { PulseScheduler } from "../src/features/scheduling/automation/scheduler.js";

const HOUR_MS = 60 * 60 * 1000;
const BUFFER_MS = 10 * 1000;

/**
 * Build a scheduler whose executor returns the given pulse result, recording
 * how many pulses were sent, which alerts fired, and what got scheduled.
 */
function buildScheduler(pulseResult) {
  const record = { attempts: 0, alerts: [], scheduled: [] };

  const logger = {
    info() {},
    warn() {},
    debug() {},
    error: (_category, message) => record.alerts.push(message),
    startTimer: () => ({ end() {} }),
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
  });
  scheduler._sleep = async () => {};
  scheduler.running = true;

  return { scheduler, record };
}

/** Run one pulse cycle, schedule the next, and stop the scheduler's timer. */
async function cycleAndSchedule(scheduler) {
  try {
    await scheduler._executePulseCycle();
    await scheduler._scheduleNext();
  } finally {
    await scheduler.shutdown();
  }
}

function allowedPulse(windowReset) {
  return {
    success: true,
    authFailure: false,
    message: { total_cost_usd: 0.0076, duration_ms: 10, session_id: "s" },
    rateLimit: {
      status: "allowed",
      resetsAt: windowReset,
      fiveHourResetsAt: windowReset,
    },
  };
}

function rejectedPulse(blockedUntil) {
  return {
    success: false,
    authFailure: false,
    error: "You've hit your session limit · resets 3:45pm",
    rateLimit: {
      status: "rejected",
      resetsAt: blockedUntil,
      fiveHourResetsAt: blockedUntil,
    },
  };
}

test("does not require a session tracker", () => {
  assert.doesNotThrow(() => buildScheduler(allowedPulse(new Date())));
});

test("schedules the next pulse just after the reported window reset", async () => {
  // Arrange
  const windowReset = new Date(Date.now() + 3 * HOUR_MS);
  const { scheduler, record } = buildScheduler(allowedPulse(windowReset));

  // Act
  await cycleAndSchedule(scheduler);

  // Assert
  assert.equal(record.scheduled.at(-1).strategy, "window_reset");
  assert.equal(
    new Date(record.scheduled.at(-1).nextRunTime).getTime(),
    windowReset.getTime() + BUFFER_MS,
  );
});

test("a rejected pulse is sent once, not retried", async () => {
  const { scheduler, record } = buildScheduler(
    rejectedPulse(new Date(Date.now() + HOUR_MS)),
  );

  await cycleAndSchedule(scheduler);

  assert.equal(record.attempts, 1);
});

test("a rejected pulse does not count as a failure", async () => {
  const { scheduler } = buildScheduler(
    rejectedPulse(new Date(Date.now() + HOUR_MS)),
  );

  await cycleAndSchedule(scheduler);

  // The allowance is in use; ClaudePulse is not broken
  assert.equal(scheduler.consecutiveFailures, 0);
});

test("a rejected pulse raises no alert", async () => {
  const { scheduler, record } = buildScheduler(
    rejectedPulse(new Date(Date.now() + HOUR_MS)),
  );

  await cycleAndSchedule(scheduler);

  assert.deepEqual(record.alerts, []);
});

test("a rejected pulse schedules the next one after the blocking reset", async () => {
  // Arrange
  const blockedUntil = new Date(Date.now() + 2 * HOUR_MS);
  const { scheduler, record } = buildScheduler(rejectedPulse(blockedUntil));

  // Act
  await cycleAndSchedule(scheduler);

  // Assert
  assert.equal(record.scheduled.at(-1).strategy, "window_reset");
  assert.equal(
    new Date(record.scheduled.at(-1).nextRunTime).getTime(),
    blockedUntil.getTime() + BUFFER_MS,
  );
});

const TRANSIENT_FAILURE = {
  success: false,
  authFailure: false,
  error: "API Error: 503 upstream temporarily unavailable",
  rateLimit: null,
};

test("counts a failed cycle once, however many attempts it made", async () => {
  const { scheduler, record } = buildScheduler(TRANSIENT_FAILURE);

  await cycleAndSchedule(scheduler);

  assert.equal(record.attempts, 3);
  assert.equal(scheduler.consecutiveFailures, 1);
});

test("alerts on the first cycle that exhausts its retries", async () => {
  // Counting attempts put the count at 3, 6, 9... after each cycle - never a
  // power of two - so a sustained transient outage never alerted.
  const { scheduler, record } = buildScheduler(TRANSIENT_FAILURE);

  await cycleAndSchedule(scheduler);

  assert.deepEqual(record.alerts, ["All retry attempts exhausted"]);
});

test("alerts when the startup pulse fails", async () => {
  // A container restarted with a dead token should say so immediately
  const { scheduler, record } = buildScheduler({
    success: false,
    authFailure: true,
    error: "API Error: 401 authentication_error",
    rateLimit: null,
  });

  await scheduler._sendInitialPulse();

  assert.equal(scheduler.consecutiveFailures, 1);
  assert.equal(record.alerts.length, 1);
});

test("falls back to hourly discovery after a pulse that reported no window", async () => {
  const { scheduler, record } = buildScheduler({
    success: false,
    authFailure: false,
    error: "API Error: 503 upstream temporarily unavailable",
    rateLimit: null,
  });

  await cycleAndSchedule(scheduler);

  assert.equal(record.scheduled.at(-1).strategy, "discovery");
});
