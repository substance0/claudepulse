import { test } from "node:test";
import assert from "node:assert/strict";

import { PulseScheduler } from "../src/features/scheduling/automation/scheduler.js";

const HOUR_MS = 60 * 60 * 1000;

function refusedPulseLog(rateLimit) {
  const logged = [];
  const logger = {
    info: (category, message, data) => logged.push({ category, message, data }),
    warn() {},
    debug() {},
    error() {},
    startTimer: () => ({}),
    endTimer: () => ({ ms: 1 }),
    logScheduler() {},
    child: () => logger,
  };
  const scheduler = new PulseScheduler({
    executor: {
      pulse: async () => ({ success: false, authFailure: false, error: "limit", rateLimit }),
    },
    logger,
    config: { PROMPT_TEXT: "pulse check" },
  });
  return scheduler._sendPulse().then(() =>
    logged.find((entry) => /Usage limit reached/.test(entry.message)),
  );
}

test("the refusal log line says when the weekly limit blocks pulsing", async () => {
  const lift = new Date(Date.now() + 72 * HOUR_MS);

  const entry = await refusedPulseLog({
    status: "rejected",
    resetsAt: lift,
    fiveHourResetsAt: null,
    limitType: "seven_day",
    weekly: { utilization: 1, resetsAt: lift },
  });

  assert.equal(entry.data.limit, "weekly");
});

test("the refusal log line says when the 5-hour limit blocks pulsing", async () => {
  const lift = new Date(Date.now() + 2 * HOUR_MS);

  const entry = await refusedPulseLog({
    status: "rejected",
    resetsAt: lift,
    fiveHourResetsAt: lift,
    limitType: "five_hour",
    weekly: null,
  });

  assert.equal(entry.data.limit, "5-hour");
});
