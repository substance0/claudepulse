import { test } from "node:test";
import assert from "node:assert/strict";

import { Logger } from "../src/core/utils/logger.js";

const logger = new Logger({ service: "claudepulse" });

function formatPulse(data) {
  return logger._formatDataForInline(data, "pulse");
}

test("shows when the window resets after a successful pulse", () => {
  const line = formatPulse({
    cost: 0.0075,
    windowResetsAt: "2026-09-24T13:50:00.000Z",
  });

  assert.match(line, /window_resets=/);
});

test("shows the error of a failed pulse", () => {
  // The scheduler logs failures without a success flag; the error must still
  // reach the log, since it is what explains an outage
  const line = formatPulse({ error: "API Error: 503 upstream unavailable" });

  assert.match(line, /error="API Error: 503 upstream unavailable"/);
});

test("shows when requests are accepted again after the usage limit", () => {
  const line = formatPulse({ resetsAt: "2026-09-26T09:00:00.000Z" });

  assert.match(line, /resets=/);
});

test("keeps the explicit success and failure markers", () => {
  assert.match(formatPulse({ success: true }), /^success/);
  assert.match(formatPulse({ success: false, error: "x" }), /^failed/);
});
