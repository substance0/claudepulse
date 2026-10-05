import { test } from "node:test";
import assert from "node:assert/strict";

import { PulseScheduler } from "../src/features/scheduling/automation/scheduler.js";

const HOUR_MS = 60 * 60 * 1000;

function extraUsageResult(overrides = {}) {
  const lift = new Date(Date.now() + 72 * HOUR_MS);
  return {
    success: true,
    message: { total_cost_usd: 0.015 },
    rateLimit: {
      status: "rejected",
      resetsAt: lift,
      fiveHourResetsAt: null,
      limitType: "seven_day",
      weekly: { utilization: 1, resetsAt: lift },
      overage: { status: "allowed", disabledReason: null, using: true, resetsAt: null },
      ...overrides,
    },
  };
}

function build({ result, notifier, alerter }) {
  const logs = { warn: [], info: [] };
  const logger = {
    info: (_category, message, data) => logs.info.push({ message, data }),
    warn: (_category, message, data) => logs.warn.push({ message, data }),
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
    executor: { pulse: async () => result },
    logger,
    config: { PROMPT_TEXT: "pulse check" },
    notifier,
    alerter,
  });
  return { scheduler, logs };
}

/** Let fire-and-forget notifications settle. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("logs a warning, naming the limit, when a pulse ran on paid extra usage", async () => {
  const { scheduler, logs } = build({ result: extraUsageResult() });

  await scheduler._sendPulse();

  const warning = logs.warn.find((w) => w.message === "Pulse ran on paid extra usage");
  assert.ok(warning, JSON.stringify(logs.warn));
  assert.equal(warning.data.limit, "weekly");
});

test("names the 5-hour limit in the warning", async () => {
  const { scheduler, logs } = build({
    result: extraUsageResult({ limitType: "five_hour", weekly: null }),
  });

  await scheduler._sendPulse();

  assert.equal(
    logs.warn.find((w) => w.message === "Pulse ran on paid extra usage").data.limit,
    "5-hour",
  );
});

test("does not warn when extra usage is off", async () => {
  const result = extraUsageResult();
  result.rateLimit.overage.using = false;
  const { scheduler, logs } = build({ result });

  await scheduler._sendPulse();

  assert.deepEqual(
    logs.warn.filter((w) => /extra usage/i.test(w.message)),
    [],
  );
});

test("hands a pulse that ran on extra usage to both the notifier and the alerter", async () => {
  const seen = { notifier: [], alerter: [] };
  const { scheduler } = build({
    result: extraUsageResult(),
    notifier: { notify: async (r) => seen.notifier.push(r) },
    alerter: { notify: async (r) => seen.alerter.push(r) },
  });

  scheduler._processPulseResult(await scheduler._sendPulse());
  await settle();

  assert.equal(seen.notifier.length, 1);
  assert.equal(seen.alerter.length, 1);
});

test("works without an alerter", async () => {
  const { scheduler } = build({ result: extraUsageResult() });

  assert.doesNotThrow(() => scheduler._processPulseResult(extraUsageResult()));
});

test("a failing alerter is only a warning and never stops pulsing", async () => {
  const { scheduler, logs } = build({
    result: extraUsageResult(),
    alerter: {
      notify: async () => {
        throw new Error("discord down");
      },
    },
  });

  const processed = scheduler._processPulseResult(extraUsageResult());
  await settle();

  assert.equal(processed.success, true);
  assert.ok(
    logs.warn.some((w) => w.message === "Extra usage alert failed"),
    JSON.stringify(logs.warn),
  );
});

test("a failing window notifier does not silence the alerter", async () => {
  const seen = [];
  const { scheduler } = build({
    result: extraUsageResult(),
    notifier: {
      notify: async () => {
        throw new Error("window channel down");
      },
    },
    alerter: { notify: async (r) => seen.push(r) },
  });

  scheduler._processPulseResult(extraUsageResult());
  await settle();

  assert.equal(seen.length, 1);
});
