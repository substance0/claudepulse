import { test } from "node:test";
import assert from "node:assert/strict";

import { PulseScheduler } from "../src/features/scheduling/automation/scheduler.js";

const NOOP_LOGGER = {
  info() {},
  warn() {},
  debug() {},
  error() {},
  startTimer: () => ({ end() {} }),
  endTimer: () => ({ ms: 1 }),
  child() {
    return NOOP_LOGGER;
  },
};

function buildScheduler(pulseImpl) {
  return new PulseScheduler({
    executor: { pulse: pulseImpl },
    logger: NOOP_LOGGER,
    config: { PROMPT_TEXT: "pulse check", MAX_RETRIES: 3 },
  });
}

test("sends the pulse through the executor", async () => {
  // Arrange
  const calls = [];
  const scheduler = buildScheduler(async (text) => {
    calls.push(text);
    return {
      success: true,
      authFailure: false,
      message: { total_cost_usd: 0.0076, duration_ms: 10, session_id: "s" },
    };
  });

  // Act
  const result = await scheduler._sendPulse();

  // Assert
  assert.deepEqual(calls, ["pulse check"]);
  assert.equal(result.success, true);
});

test("carries the executor's failure detail through", async () => {
  // Arrange
  const scheduler = buildScheduler(async () => ({
    success: false,
    authFailure: true,
    error: "API Error: 401 authentication_error",
  }));

  // Act
  const result = await scheduler._sendPulse();

  // Assert
  assert.equal(result.success, false);
  assert.match(result.error, /authentication_error/);
});
