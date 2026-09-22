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

test("does not mistake a successful pulse for an auth failure", () => {
  const r = ClaudeCliExecutor.parseResult({
    stdout: SUCCESS_JSON,
    stderr: "",
    exitCode: 0,
  });

  assert.equal(r.authFailure, false);
});
