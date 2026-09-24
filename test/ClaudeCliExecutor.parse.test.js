import { test } from "node:test";
import assert from "node:assert/strict";

import { ClaudeCliExecutor } from "../src/features/claude/executor/ClaudeCliExecutor.js";

const SUCCESS_JSON = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "ok",
  session_id: "abc-123",
  duration_ms: 2735,
  total_cost_usd: 0.007584,
});

const AUTH_ERROR_JSON = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: true,
  result:
    'API Error: 401 {"type":"error","error":{"type":"authentication_error",' +
    '"message":"OAuth access token has expired. Re-authenticate to continue."}}',
  session_id: "def-456",
  duration_ms: 1200,
  total_cost_usd: 0,
});

const UNAUTHORIZED_CREDENTIAL_JSON = JSON.stringify({
  type: "result",
  is_error: true,
  result:
    'API Error: 400 {"type":"error","error":{"type":"invalid_request_error",' +
    '"message":"This credential is only authorized for use with Claude Code."}}',
});

test("reports success and carries cost, duration and session id", () => {
  // Arrange / Act
  const r = ClaudeCliExecutor.parseResult({
    stdout: SUCCESS_JSON,
    stderr: "",
    exitCode: 0,
  });

  // Assert
  assert.equal(r.success, true);
  assert.equal(r.authFailure, false);
  assert.equal(r.message.total_cost_usd, 0.007584);
  assert.equal(r.message.duration_ms, 2735);
  assert.equal(r.message.session_id, "abc-123");
});

test("flags an expired token as an auth failure", () => {
  const r = ClaudeCliExecutor.parseResult({
    stdout: AUTH_ERROR_JSON,
    stderr: "",
    exitCode: 1,
  });

  assert.equal(r.success, false);
  assert.equal(r.authFailure, true);
});

test("flags a credential rejected for this use as an auth failure", () => {
  const r = ClaudeCliExecutor.parseResult({
    stdout: UNAUTHORIZED_CREDENTIAL_JSON,
    stderr: "",
    exitCode: 1,
  });

  assert.equal(r.success, false);
  assert.equal(r.authFailure, true);
});

test("treats a non-zero exit with unparseable output as a plain failure", () => {
  const r = ClaudeCliExecutor.parseResult({
    stdout: "",
    stderr: "claude: command not found",
    exitCode: 127,
  });

  assert.equal(r.success, false);
  assert.equal(r.authFailure, false);
  assert.match(r.error, /command not found/);
});

// --- Rate-limit event ------------------------------------------------------

/** Epoch seconds for the window resets used below. */
const FIVE_HOUR_RESET = 1790257800; // Thu 24 Sep 2026 13:50:00 UTC
const SEVEN_DAY_RESET = 1790416800;

/** A rate_limit_event line, shaped like one captured from a real pulse. */
function rateLimitLine(info) {
  return JSON.stringify({
    type: "rate_limit_event",
    rate_limit_info: info,
    uuid: "u",
    session_id: "s",
  });
}

/** Join lines the way `--output-format stream-json` emits them. */
function stream(...lines) {
  return lines.join("\n") + "\n";
}

const OBSERVED_EVENT = {
  status: "allowed",
  resetsAt: FIVE_HOUR_RESET,
  rateLimitType: "five_hour",
  unifiedWindows: {
    five_hour: { utilization: 0.48, resetsAt: FIVE_HOUR_RESET },
    seven_day: { utilization: 0.2, resetsAt: SEVEN_DAY_RESET },
  },
};

test("reads the 5-hour window reset from a streamed pulse", () => {
  const r = ClaudeCliExecutor.parseResult({
    stdout: stream(rateLimitLine(OBSERVED_EVENT), SUCCESS_JSON),
    stderr: "",
    exitCode: 0,
  });

  assert.equal(r.success, true);
  assert.equal(r.rateLimit.status, "allowed");
  assert.equal(r.rateLimit.fiveHourResetsAt.getTime(), FIVE_HOUR_RESET * 1000);
});

test("reports a rejected pulse with the time requests are accepted again", () => {
  const r = ClaudeCliExecutor.parseResult({
    stdout: stream(
      rateLimitLine({
        status: "rejected",
        resetsAt: SEVEN_DAY_RESET,
        rateLimitType: "seven_day",
      }),
      UNAUTHORIZED_CREDENTIAL_JSON,
    ),
    stderr: "",
    exitCode: 1,
  });

  assert.equal(r.rateLimit.status, "rejected");
  assert.equal(r.rateLimit.resetsAt.getTime(), SEVEN_DAY_RESET * 1000);
});

test("leaves rateLimit null when the stream carries no event", () => {
  const r = ClaudeCliExecutor.parseResult({
    stdout: stream(SUCCESS_JSON),
    stderr: "",
    exitCode: 0,
  });

  assert.equal(r.rateLimit, null);
});

test("uses the last event when several are emitted", () => {
  const later = FIVE_HOUR_RESET + 3600;
  const r = ClaudeCliExecutor.parseResult({
    stdout: stream(
      rateLimitLine(OBSERVED_EVENT),
      rateLimitLine({ ...OBSERVED_EVENT, resetsAt: later, unifiedWindows: undefined }),
      SUCCESS_JSON,
    ),
    stderr: "",
    exitCode: 0,
  });

  assert.equal(r.rateLimit.fiveHourResetsAt.getTime(), later * 1000);
});

test("falls back to resetsAt when the undocumented unifiedWindows is absent", () => {
  const r = ClaudeCliExecutor.parseResult({
    stdout: stream(
      rateLimitLine({ status: "allowed", resetsAt: FIVE_HOUR_RESET }),
      SUCCESS_JSON,
    ),
    stderr: "",
    exitCode: 0,
  });

  // Only documented fields present: resetsAt is taken as the 5-hour window
  assert.equal(r.rateLimit.fiveHourResetsAt.getTime(), FIVE_HOUR_RESET * 1000);
});

test("does not treat another window's reset as the 5-hour reset", () => {
  const r = ClaudeCliExecutor.parseResult({
    stdout: stream(
      rateLimitLine({
        status: "allowed_warning",
        resetsAt: SEVEN_DAY_RESET,
        rateLimitType: "seven_day",
      }),
      SUCCESS_JSON,
    ),
    stderr: "",
    exitCode: 0,
  });

  assert.equal(r.rateLimit.fiveHourResetsAt, null);
  assert.equal(r.rateLimit.resetsAt.getTime(), SEVEN_DAY_RESET * 1000);
});

test("skips lines that are not JSON", () => {
  const r = ClaudeCliExecutor.parseResult({
    stdout: stream("a stray shell warning", rateLimitLine(OBSERVED_EVENT), SUCCESS_JSON),
    stderr: "",
    exitCode: 0,
  });

  assert.equal(r.success, true);
  assert.equal(r.rateLimit.status, "allowed");
});

test("does not mistake a successful pulse for an auth failure", () => {
  const r = ClaudeCliExecutor.parseResult({
    stdout: SUCCESS_JSON,
    stderr: "",
    exitCode: 0,
  });

  assert.equal(r.authFailure, false);
});
