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

function buildScheduler({ stateStore, workHours }) {
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
    stateStore: memoryStore({ nextPulseAt, rateLimit }),
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
    stateStore: memoryStore({ nextPulseAt: new Date(Date.now() - HOUR_MS), rateLimit: null }),
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
    stateStore: memoryStore({ nextPulseAt: new Date(Date.now() + 2 * HOUR_MS), rateLimit: null }),
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

test("a dry run neither reads nor writes the state", async () => {
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

  assert.deepEqual(calls, []);
});
