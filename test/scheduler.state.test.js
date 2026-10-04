import { test } from "node:test";
import assert from "node:assert/strict";

import { PulseScheduler } from "../src/features/scheduling/automation/scheduler.js";

const HOUR_MS = 60 * 60 * 1000;

function allowedPulse(windowReset) {
  return {
    success: true,
    authFailure: false,
    message: { total_cost_usd: 0, duration_ms: 1, session_id: "s" },
    rateLimit: { status: "allowed", resetsAt: windowReset, fiveHourResetsAt: windowReset },
  };
}

function buildScheduler({ stateStore, workHours, stateFingerprint = "fp", stateSaveTimeoutMs }) {
  const record = { attempts: 0, scheduled: [], warnings: [] };
  const logger = {
    info() {},
    warn: (_category, message) => record.warnings.push(message),
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
        return allowedPulse(new Date(Date.now() + 3 * HOUR_MS));
      },
    },
    logger,
    config: { PROMPT_TEXT: "pulse check", MAX_RETRIES: 3 },
    stateStore,
    stateFingerprint,
    stateSaveTimeoutMs,
    workHours,
  });
  return { scheduler, record };
}

async function startAndStop(scheduler) {
  try {
    await scheduler.start();
  } finally {
    await scheduler.shutdown();
  }
}

function memoryStore(initial) {
  return {
    saved: null,
    load: async () => initial,
    async save(state) {
      this.saved = state;
    },
  };
}

test("saves the next planned pulse", async () => {
  const store = memoryStore(null);
  const { scheduler, record } = buildScheduler({ stateStore: store });

  await startAndStop(scheduler);

  assert.equal(
    store.saved.nextPulseAt.getTime(),
    new Date(record.scheduled.at(-1).nextRunTime).getTime(),
  );
  assert.equal(store.saved.rateLimit.status, "allowed");
});

test("resumes a saved future pulse instead of pulsing at startup", async () => {
  // Arrange
  const nextPulseAt = new Date(Date.now() + 2 * HOUR_MS);
  const rateLimit = { status: "allowed", resetsAt: nextPulseAt, fiveHourResetsAt: nextPulseAt };
  const { scheduler, record } = buildScheduler({
    stateStore: memoryStore(savedState({ nextPulseAt, rateLimit })),
  });

  // Act
  await startAndStop(scheduler);

  // Assert
  assert.equal(record.attempts, 0);
  assert.equal(record.scheduled.at(-1).strategy, "restored");
  assert.equal(new Date(record.scheduled.at(-1).nextRunTime).getTime(), nextPulseAt.getTime());
  assert.equal(scheduler.rateLimit.status, "allowed");
});

test("ignores a saved pulse that is already past", async () => {
  const { scheduler, record } = buildScheduler({
    stateStore: memoryStore(savedState({ nextPulseAt: new Date(Date.now() - HOUR_MS) })),
  });

  await startAndStop(scheduler);

  assert.equal(record.attempts, 1);
});

test("ignores an unreadable state with a warning", async () => {
  const { scheduler, record } = buildScheduler({
    stateStore: {
      load: async () => {
        throw new Error("Unexpected end of JSON input");
      },
      save: async () => {},
    },
  });

  await startAndStop(scheduler);

  assert.equal(record.attempts, 1);
  assert.ok(record.warnings.some((m) => /state/i.test(m)));
});

test("keeps scheduling when the state cannot be saved", async () => {
  const { scheduler, record } = buildScheduler({
    stateStore: {
      load: async () => null,
      save: async () => {
        throw new Error("EROFS: read-only file system");
      },
    },
  });

  await startAndStop(scheduler);

  assert.equal(record.scheduled.length, 1);
  assert.ok(record.warnings.some((m) => /state/i.test(m)));
});

test("a restored pulse outside work hours waits for the working day", async () => {
  // Work hours report "active" now, so only the restore explains why no
  // startup pulse is sent; the restored time itself is still outside them
  const nextMorning = new Date(Date.now() + 10 * HOUR_MS);
  const { scheduler, record } = buildScheduler({
    stateStore: memoryStore(savedState({ nextPulseAt: new Date(Date.now() + 2 * HOUR_MS) })),
    workHours: { nextAllowed: () => nextMorning, isActive: () => true },
  });

  await startAndStop(scheduler);

  assert.equal(record.attempts, 0);
  assert.equal(record.scheduled.at(-1).strategy, "work_hours");
  assert.equal(new Date(record.scheduled.at(-1).nextRunTime).getTime(), nextMorning.getTime());
});

test("without a state store, behaves exactly as before", async () => {
  const { scheduler, record } = buildScheduler({});

  await startAndStop(scheduler);

  assert.equal(record.attempts, 1);
  assert.notEqual(record.scheduled.at(-1).strategy, "restored");
});

test("a dry run reads the state but never writes it", async () => {
  const calls = [];
  const store = {
    load: async () => {
      calls.push("load");
      return null;
    },
    save: async () => {
      calls.push("save");
    },
  };
  const { scheduler } = buildScheduler({ stateStore: store });
  scheduler.config.dryRun = true;

  await scheduler.start();

  assert.deepEqual(calls, ["load"]);
});

/** Run a dry run and return the data of its "Scheduling Analysis" line. */
async function dryRunAnalysis(options) {
  const { scheduler, record } = buildScheduler(options);
  const analyses = [];
  scheduler.logger.info = (_category, message, data) => {
    if (message === "Scheduling Analysis") analyses.push(data);
  };
  scheduler.config.dryRun = true;

  await scheduler.start();

  return { analysis: analyses[0], record };
}

test("a dry run reports the saved schedule a real start would resume", async () => {
  const saved = savedState({ nextPulseAt: new Date(Date.now() + 2 * HOUR_MS) });
  const store = memoryStore(saved);

  const { analysis, record } = await dryRunAnalysis({ stateStore: store });

  assert.equal(analysis.optimalSchedule, saved.nextPulseAt.toISOString());
  assert.equal(analysis.resumedFromState, true);
  assert.equal(store.saved, null);
  assert.equal(record.attempts, 0);
});

test("a dry run reports the computed schedule when the saved one would not be resumed", async () => {
  const saved = savedState({ fingerprint: "other-settings" });

  const { analysis } = await dryRunAnalysis({ stateStore: memoryStore(saved) });

  assert.equal(analysis.resumedFromState, false);
  assert.notEqual(analysis.optimalSchedule, saved.nextPulseAt.toISOString());
});

test("a dry run reports the working day when the saved time is outside work hours", async () => {
  const nextMorning = new Date(Date.now() + 10 * HOUR_MS);

  const { analysis } = await dryRunAnalysis({
    stateStore: memoryStore(savedState({ nextPulseAt: new Date(Date.now() + 2 * HOUR_MS) })),
    workHours: { nextAllowed: () => nextMorning, isActive: () => true },
  });

  assert.equal(analysis.optimalSchedule, nextMorning.toISOString());
});

/** A saved state as the store loads it, matching the scheduler's settings. */
function savedState(overrides = {}) {
  return {
    nextPulseAt: new Date(Date.now() + 2 * HOUR_MS),
    rateLimit: null,
    strategy: "window_reset",
    fingerprint: "fp",
    ...overrides,
  };
}

test("saves the strategy and settings fingerprint with the schedule", async () => {
  const store = memoryStore(null);
  const { scheduler } = buildScheduler({ stateStore: store, stateFingerprint: "fp-now" });

  await startAndStop(scheduler);

  assert.equal(store.saved.fingerprint, "fp-now");
  assert.equal(typeof store.saved.strategy, "string");
});

test("saves the strategy the time was based on, not the work-hours move", async () => {
  const store = memoryStore(null);
  const { scheduler, record } = buildScheduler({
    stateStore: store,
    workHours: { nextAllowed: () => new Date(Date.now() + 20 * HOUR_MS), isActive: () => true },
  });

  await startAndStop(scheduler);

  assert.equal(record.scheduled.at(-1).strategy, "work_hours");
  assert.equal(store.saved.strategy, "window_reset");
});

test("ignores a schedule saved under other settings", async () => {
  // Turning work hours off must not leave the old, later pulse in place
  const { scheduler, record } = buildScheduler({
    stateStore: memoryStore(savedState({ fingerprint: "other-settings" })),
  });

  await startAndStop(scheduler);

  assert.equal(record.attempts, 1);
  assert.notEqual(record.scheduled.at(-1).strategy, "restored");
});

test("ignores a schedule saved without a fingerprint", async () => {
  const { scheduler, record } = buildScheduler({
    stateStore: memoryStore(savedState({ fingerprint: null })),
  });

  await startAndStop(scheduler);

  assert.equal(record.attempts, 1);
});

test("ignores a saved schedule that was only a guess", async () => {
  // After a failed cycle no window is known and the next hour is a guess;
  // a restart with a fixed token must pulse to learn the window
  const { scheduler, record } = buildScheduler({
    stateStore: memoryStore(savedState({ strategy: "discovery" })),
  });

  await startAndStop(scheduler);

  assert.equal(record.attempts, 1);
});

test("says why a saved schedule is not resumed", async () => {
  const infos = [];
  const { scheduler } = buildScheduler({
    stateStore: memoryStore(savedState({ fingerprint: "other-settings" })),
  });
  scheduler.logger.info = (_category, message) => infos.push(message);

  await startAndStop(scheduler);

  assert.ok(infos.some((m) => /settings changed/i.test(m)), infos.join("\n"));
});

test("a state write that never finishes does not stop the next pulse being scheduled", async () => {
  // A hung network volume must not stall pulsing
  const { scheduler, record } = buildScheduler({
    stateStore: { load: async () => null, save: () => new Promise(() => {}) },
    stateSaveTimeoutMs: 20,
  });

  await startAndStop(scheduler);

  assert.equal(record.scheduled.length, 1);
  assert.ok(record.warnings.some((m) => /state/i.test(m)), record.warnings.join("\n"));
});

test("a state write that fails after the wait is not an unhandled rejection", async () => {
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  try {
    const { scheduler } = buildScheduler({
      stateStore: {
        load: async () => null,
        save: () => new Promise((_, reject) => setTimeout(() => reject(new Error("late")), 60)),
      },
      stateSaveTimeoutMs: 10,
    });

    await startAndStop(scheduler);
    await new Promise((resolve) => setTimeout(resolve, 120));
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }

  assert.deepEqual(unhandled, []);
});

const DAY_MS = 24 * HOUR_MS;

test("ignores a saved pulse further ahead than any real schedule", async () => {
  // A weekly lift plus a day off is about two weeks; 20 days is a hand edit
  // or a clock that was set ahead
  const { scheduler, record } = buildScheduler({
    stateStore: memoryStore(savedState({ nextPulseAt: new Date(Date.now() + 20 * DAY_MS) })),
  });

  await startAndStop(scheduler);

  assert.equal(record.attempts, 1);
  assert.ok(record.warnings.some((m) => /too far ahead/i.test(m)), record.warnings.join("\n"));
});

test("resumes a saved pulse about two weeks ahead", async () => {
  const { scheduler, record } = buildScheduler({
    stateStore: memoryStore(savedState({ nextPulseAt: new Date(Date.now() + 14 * DAY_MS) })),
  });

  await startAndStop(scheduler);

  assert.equal(record.attempts, 0);
  assert.equal(record.scheduled.at(-1).strategy, "restored");
});

test("uses a restored pulse time once, then follows the window", async () => {
  // Arrange: a saved schedule whose window resets in 3 hours
  const windowReset = new Date(Date.now() + 3 * HOUR_MS);
  const rateLimit = { status: "allowed", resetsAt: windowReset, fiveHourResetsAt: windowReset };
  const { scheduler, record } = buildScheduler({
    stateStore: memoryStore(savedState({ rateLimit })),
  });

  // Act: the startup schedule, then the next one
  try {
    await scheduler.start();
    await scheduler._scheduleNext();
  } finally {
    await scheduler.shutdown();
  }

  // Assert
  assert.equal(record.scheduled[0].strategy, "restored");
  assert.equal(record.scheduled[1].strategy, "window_reset");
});

test("forgets a restored time that was never used", async () => {
  const { scheduler } = buildScheduler({ stateStore: memoryStore(null) });
  scheduler.restoredNextPulseAt = new Date(Date.now() + HOUR_MS);

  await scheduler._restoreState();

  assert.equal(scheduler.restoredNextPulseAt, null);
});
