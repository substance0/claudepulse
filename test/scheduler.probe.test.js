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

test("ignores the order of field names", () => {
  const { scheduler, warnings } = buildScheduler();

  scheduler._processPulseResult(pulseWith({ alpha: 1, beta: 2 }));
  scheduler._processPulseResult(pulseWith({ beta: 2, alpha: 1 }));

  assert.equal(probeWarnings(warnings).length, 1);
});

test("keeps field names that contain commas distinct", () => {
  const { scheduler, warnings } = buildScheduler();

  scheduler._processPulseResult(pulseWith({ a: 1, b: 2 }));
  scheduler._processPulseResult(pulseWith({ "a,b": 1 }));

  assert.equal(probeWarnings(warnings).length, 2);
});

test("reports a field whose value is null", () => {
  const { scheduler, warnings } = buildScheduler();

  scheduler._processPulseResult(pulseWith({ surpassedThreshold: null }));

  assert.equal(probeWarnings(warnings)[0].data.fields, '{"surpassedThreshold":null}');
});

test("never logs the values of account billing flags", () => {
  const { scheduler, warnings } = buildScheduler();

  scheduler._processPulseResult(
    pulseWith({
      canUserPurchaseCredits: true,
      hasChargeableSavedPaymentMethod: false,
      overageInUse: true,
    }),
  );

  const fields = JSON.parse(probeWarnings(warnings)[0].data.fields);
  assert.equal(fields.canUserPurchaseCredits, "[omitted]");
  assert.equal(fields.hasChargeableSavedPaymentMethod, "[omitted]");
  assert.equal(fields.overageInUse, true);
});

test("passes extra-usage state to the pulse log", async () => {
  const logged = [];
  const logger = {
    info: (_category, message, data) => logged.push({ message, data }),
    warn() {},
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
    executor: {
      pulse: async () => ({
        success: true,
        message: { total_cost_usd: 0 },
        rateLimit: { status: "allowed", overage: { using: true, status: "allowed" } },
      }),
    },
    logger,
    config: { PROMPT_TEXT: "pulse check" },
  });

  await scheduler._sendPulse();

  const entry = logged.find((e) => e.message === "Pulse successful");
  assert.equal(entry.data.usingOverage, true);
});
