import { test } from "node:test";
import assert from "node:assert/strict";

import { PulseScheduler } from "../src/features/scheduling/automation/scheduler.js";

const HOUR_MS = 60 * 60 * 1000;

function buildScheduler(pulseResult, notifier) {
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
    executor: { pulse: async () => pulseResult },
    logger,
    config: { PROMPT_TEXT: "pulse check", MAX_RETRIES: 3 },
    notifier,
  });
  scheduler._sleep = async () => {};

  return scheduler;
}

const ALLOWED = {
  success: true,
  authFailure: false,
  message: { total_cost_usd: 0.01, duration_ms: 10, session_id: "s" },
  rateLimit: {
    status: "allowed",
    resetsAt: new Date(Date.now() + 5 * HOUR_MS),
    fiveHourResetsAt: new Date(Date.now() + 5 * HOUR_MS),
  },
};

test("hands every pulse result to the window notifier", async () => {
  const notified = [];
  const scheduler = buildScheduler(ALLOWED, {
    notify: async (result) => notified.push(result),
  });

  await scheduler._sendInitialPulse();

  assert.equal(notified.length, 1);
  assert.equal(notified[0].rateLimit, ALLOWED.rateLimit);
});

test("runs without a window notifier", async () => {
  const scheduler = buildScheduler(ALLOWED, undefined);

  await assert.doesNotReject(scheduler._sendInitialPulse());
});

test("a failing window notifier does not fail the pulse", async () => {
  const scheduler = buildScheduler(ALLOWED, {
    notify: async () => {
      throw new Error("discord down");
    },
  });

  await scheduler._sendInitialPulse();

  assert.equal(scheduler.consecutiveFailures, 0);
});
