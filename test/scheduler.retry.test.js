import { test } from "node:test";
import assert from "node:assert/strict";

import { PulseScheduler } from "../src/features/scheduling/automation/scheduler.js";

const NOOP_LOGGER = {
  info() {},
  warn() {},
  debug() {},
  error() {},
  startTimer: () => ({ end() {} }),
  child() {
    return NOOP_LOGGER;
  },
};

/** Error payload the Claude CLI returns once its OAuth token has expired. */
const EXPIRED_TOKEN_ERROR = JSON.stringify({
  type: "result",
  is_error: true,
  result:
    'API Error: 401 {"type":"error","error":{"type":"authentication_error",' +
    '"message":"OAuth access token has expired. Re-authenticate to continue."}} ' +
    "· Please run /login",
});

/** Error the server returns when a credential is not accepted for this use. */
const UNAUTHORIZED_CREDENTIAL_ERROR = JSON.stringify({
  type: "result",
  is_error: true,
  result:
    'API Error: 400 {"type":"error","error":{"type":"invalid_request_error",' +
    '"message":"This credential is only authorized for use with Claude Code ' +
    'and cannot be used for other API requests."}}',
});

/** Error the token endpoint returns when a refresh token is rejected. */
const INVALID_GRANT_ERROR = JSON.stringify({
  type: "result",
  is_error: true,
  result: 'API Error: 400 {"error":"invalid_grant"}',
});

/** A bare 403, which carries no message text to match on. */
const FORBIDDEN_ERROR = JSON.stringify({
  type: "result",
  is_error: true,
  result: "API Error: 403 Forbidden",
});

/** Error payload for a transient network blip, which should still retry. */
const TRANSIENT_ERROR = JSON.stringify({
  type: "result",
  is_error: true,
  result: "API Error: 503 upstream temporarily unavailable",
});

function buildScheduler({ pulseError }) {
  const scheduler = new PulseScheduler({
    client: {},
    sessionTracker: {
      registerSessionLimitSignal() {},
      getSessionInfo: () => ({}),
    },
    logger: NOOP_LOGGER,
    config: { MAX_RETRIES: 3, PROMPT_TEXT: "pulse check" },
  });

  let attempts = 0;
  scheduler._sendPulse = async () => {
    attempts += 1;
    return { success: false, error: pulseError };
  };
  // Keep the test fast: backoff timing is not what is under test here.
  scheduler._sleep = async () => {};

  return { scheduler, attempts: () => attempts };
}

test("raises an alert only at escalation points while a failure persists", async () => {
  // Arrange
  const alerted = [];
  const suppressed = [];
  const { scheduler } = buildScheduler({ pulseError: EXPIRED_TOKEN_ERROR });
  scheduler.logger = {
    ...NOOP_LOGGER,
    error: (_category, message) => alerted.push(message),
    warn: (_category, message) => suppressed.push(message),
  };

  // Act - four consecutive failing cycles
  for (let i = 0; i < 4; i += 1) {
    await scheduler._executePulseCycle();
  }

  // Assert - alerts at failures 1, 2 and 4; failure 3 stays quiet
  assert.equal(alerted.length, 3);
  assert.equal(suppressed.length, 1);
});

test("stops retrying immediately when the token has expired", async () => {
  // Arrange
  const { scheduler, attempts } = buildScheduler({
    pulseError: EXPIRED_TOKEN_ERROR,
  });

  // Act
  await scheduler._executePulseCycle();

  // Assert - re-sending cannot fix an expired token
  assert.equal(attempts(), 1);
});

test("stops retrying when the credential is rejected for this use", async () => {
  // Arrange
  const { scheduler, attempts } = buildScheduler({
    pulseError: UNAUTHORIZED_CREDENTIAL_ERROR,
  });

  // Act
  await scheduler._executePulseCycle();

  // Assert - the credential will not become valid by asking again
  assert.equal(attempts(), 1);
});

test("stops retrying when the refresh token is rejected", async () => {
  // Arrange
  const { scheduler, attempts } = buildScheduler({
    pulseError: INVALID_GRANT_ERROR,
  });

  // Act
  await scheduler._executePulseCycle();

  // Assert
  assert.equal(attempts(), 1);
});

test("stops retrying on a bare 403", async () => {
  // Arrange
  const { scheduler, attempts } = buildScheduler({
    pulseError: FORBIDDEN_ERROR,
  });

  // Act
  await scheduler._executePulseCycle();

  // Assert - no message text to match, so the status code must be enough
  assert.equal(attempts(), 1);
});

test("still retries a transient failure up to maxRetries", async () => {
  // Arrange
  const { scheduler, attempts } = buildScheduler({
    pulseError: TRANSIENT_ERROR,
  });

  // Act
  await scheduler._executePulseCycle();

  // Assert
  assert.equal(attempts(), 3);
});
