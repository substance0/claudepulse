import { test } from "node:test";
import assert from "node:assert/strict";

import { PulseScheduler } from "../src/features/scheduling/automation/scheduler.js";
import { DateUtility } from "../src/core/utils/DateUtility.js";

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

test("names the working day's first pulse when skipping the startup pulse", async () => {
  const firstPulse = new Date(Date.now() + 4 * HOUR_MS);
  const { scheduler, record } = buildScheduler({
    workHours: { nextAllowed: () => firstPulse, isActive: () => false },
    pulseResult: allowedPulse(new Date(Date.now() + 3 * HOUR_MS)),
  });

  try {
    await scheduler.start();
  } finally {
    await scheduler.shutdown();
  }

  assert.ok(
    record.infos.some(
      (m) => /outside work hours/i.test(m) && m.includes(DateUtility.formatLocalIso(firstPulse)),
    ),
    record.infos.join("\n"),
  );
});

test("says when work hours move a planned pulse", async () => {
  const nextMorning = new Date(Date.now() + 20 * HOUR_MS);
  const { scheduler, record } = buildScheduler({
    workHours: { nextAllowed: () => nextMorning, isActive: () => true },
    pulseResult: allowedPulse(new Date(Date.now() + 3 * HOUR_MS)),
  });
  scheduler.running = true;

  try {
    await scheduler._executePulseCycle();
    await scheduler._scheduleNext();
  } finally {
    await scheduler.shutdown();
  }

  assert.ok(
    record.infos.some(
      (m) => /work hours: next pulse moved/i.test(m) && m.includes(DateUtility.formatLocalIso(nextMorning)),
    ),
    record.infos.join("\n"),
  );
});

test("stops retrying once work hours are over", async () => {
  // Arrange: a failing pulse, and work hours that end during the backoff
  const { scheduler, record } = buildScheduler({
    workHours: { nextAllowed: (t) => new Date(t), isActive: () => false },
    pulseResult: {
      success: false,
      authFailure: false,
      error: "API Error: 503 upstream temporarily unavailable",
      rateLimit: null,
    },
  });
  scheduler.running = true;

  // Act
  try {
    await scheduler._executePulseCycle();
  } finally {
    await scheduler.shutdown();
  }

  // Assert: one attempt, and the failed cycle still counts toward alerts
  assert.equal(record.attempts, 1);
  assert.equal(scheduler.consecutiveFailures, 1);
});
