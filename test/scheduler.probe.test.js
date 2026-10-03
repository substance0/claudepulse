import { test } from "node:test";
import assert from "node:assert/strict";

import { PulseScheduler } from "../src/features/scheduling/automation/scheduler.js";

function buildScheduler() {
  const warnings = [];
  const logger = {
    info() {},
    warn: (_category, message, data) => warnings.push({ message, data }),
    debug() {},
    error() {},
    startTimer: () => ({}),
    endTimer: () => ({ ms: 1 }),
    logScheduler() {},
    child() {
      return logger;
    },
  };
  const scheduler = new PulseScheduler({
    executor: { pulse: async () => ({}) },
    logger,
    config: { PROMPT_TEXT: "pulse check" },
  });
  return { scheduler, warnings };
}

function pulseWith(unrecognised) {
  return {
    success: true,
    rateLimit: { status: "allowed", resetsAt: null, fiveHourResetsAt: null, unrecognised },
  };
}

const probeWarnings = (warnings) =>
  warnings.filter((w) => w.message === "Unrecognised rate-limit fields");

test("logs unknown rate-limit fields once per set of names", () => {
  const { scheduler, warnings } = buildScheduler();

  scheduler._processPulseResult(pulseWith({ isUsingOverage: true }));
  scheduler._processPulseResult(pulseWith({ isUsingOverage: false }));
  scheduler._processPulseResult(pulseWith({ isUsingOverage: true, overageResetsAt: 1 }));

  assert.equal(probeWarnings(warnings).length, 2);
});

test("logs nested values as JSON", () => {
  const { scheduler, warnings } = buildScheduler();

  scheduler._processPulseResult(pulseWith({ overage: { status: "on" } }));

  assert.equal(probeWarnings(warnings)[0].data.fields, '{"overage":{"status":"on"}}');
});

test("logs nothing when every field is known", () => {
  const { scheduler, warnings } = buildScheduler();

  scheduler._processPulseResult(pulseWith(null));
  scheduler._processPulseResult({ success: false, rateLimit: null });

  assert.deepEqual(probeWarnings(warnings), []);
});
