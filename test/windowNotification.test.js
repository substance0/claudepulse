import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildExtraUsageNotification,
  buildWindowNotification,
  createExtraUsageAlerter,
  createWindowNotifier,
} from "../src/core/services/windowNotification.js";

const RESET = new Date("2026-09-25T00:20:00.000Z");
const RESET_EPOCH = RESET.getTime() / 1000;

function allowedPulse() {
  return {
    success: true,
    rateLimit: { status: "allowed", resetsAt: RESET, fiveHourResetsAt: RESET },
  };
}

function rejectedPulse() {
  return {
    success: false,
    rateLimit: { status: "rejected", resetsAt: RESET, fiveHourResetsAt: null },
  };
}

test("a pulse that got through announces when its window resets", () => {
  const payload = buildWindowNotification(allowedPulse());

  assert.equal(payload.level, "SUCCESS");
  // Discord renders these in each reader's own time zone, and as a countdown
  assert.match(payload.description, new RegExp(`<t:${RESET_EPOCH}:t>`));
  assert.match(payload.description, new RegExp(`<t:${RESET_EPOCH}:R>`));
});

test("a refused pulse announces when the limit lifts", () => {
  const payload = buildWindowNotification(rejectedPulse());

  assert.equal(payload.level, "WARN");
  assert.match(payload.title, /limit reached/i);
  assert.match(payload.description, new RegExp(`<t:${RESET_EPOCH}:t>`));
});

test("a pulse that reported no window announces nothing", () => {
  assert.equal(buildWindowNotification({ success: false, rateLimit: null }), null);
});

test("a reset time that is not a date announces nothing", () => {
  const pulse = {
    success: true,
    rateLimit: { status: "allowed", resetsAt: null, fiveHourResetsAt: null },
  };

  assert.equal(buildWindowNotification(pulse), null);
});

test("the notifier posts to its own webhook", async () => {
  const sent = [];
  const notifier = createWindowNotifier("https://example.test/hook", {
    send: async (payload, url) => sent.push({ payload, url }),
  });

  await notifier.notify(allowedPulse());

  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://example.test/hook");
});

test("the notifier stays silent when there is nothing to announce", async () => {
  const sent = [];
  const notifier = createWindowNotifier("https://example.test/hook", {
    send: async (payload) => sent.push(payload),
  });

  await notifier.notify({ success: false, rateLimit: null });

  assert.deepEqual(sent, []);
});

test("prefixes the title with the account label", async () => {
  const sent = [];
  const notifier = createWindowNotifier("https://discord.test/hook", {
    label: "work",
    send: async (payload) => sent.push(payload),
  });

  await notifier.notify(allowedPulse());

  assert.equal(sent[0].title, "work · Window open");
});

test("keeps the plain title without a label", async () => {
  const sent = [];
  const notifier = createWindowNotifier("https://discord.test/hook", {
    send: async (payload) => sent.push(payload),
  });

  await notifier.notify(allowedPulse());

  assert.equal(sent[0].title, "Window open");
});

test("a labelled notifier still sends nothing for a pulse with no window", async () => {
  const sent = [];
  const notifier = createWindowNotifier("https://discord.test/hook", {
    label: "work",
    send: async (payload) => sent.push(payload),
  });

  await notifier.notify({ success: false, rateLimit: null });

  assert.deepEqual(sent, []);
});

const WEEK_RESET = new Date("2026-09-28T07:00:00.000Z");
const WEEK_EPOCH = WEEK_RESET.getTime() / 1000;

test("names the weekly limit when it is what blocks pulsing", () => {
  const payload = buildWindowNotification({
    success: false,
    rateLimit: {
      status: "rejected",
      resetsAt: WEEK_RESET,
      fiveHourResetsAt: null,
      limitType: "seven_day",
      weekly: { utilization: 1, resetsAt: WEEK_RESET },
    },
  });

  assert.equal(payload.title, "Weekly limit reached");
  assert.equal(payload.level, "WARN");
  // Days away, so the date matters as much as the countdown
  assert.match(payload.description, new RegExp(`<t:${WEEK_EPOCH}:F>`));
  assert.match(payload.description, new RegExp(`<t:${WEEK_EPOCH}:R>`));
});

test("recognises a weekly rejection by its reset time alone", () => {
  const payload = buildWindowNotification({
    success: false,
    rateLimit: {
      status: "rejected",
      resetsAt: WEEK_RESET,
      fiveHourResetsAt: null,
      limitType: null,
      weekly: { utilization: 1, resetsAt: WEEK_RESET },
    },
  });

  assert.equal(payload.title, "Weekly limit reached");
});

test("a 5-hour rejection is not the weekly limit", () => {
  const payload = buildWindowNotification({
    success: false,
    rateLimit: {
      status: "rejected",
      resetsAt: RESET,
      fiveHourResetsAt: RESET,
      limitType: "five_hour",
      weekly: { utilization: 0.4, resetsAt: WEEK_RESET },
    },
  });

  assert.equal(payload.title, "Usage limit reached");
});

test("an open window shows weekly usage", () => {
  const payload = buildWindowNotification({
    success: true,
    rateLimit: {
      status: "allowed",
      resetsAt: RESET,
      fiveHourResetsAt: RESET,
      weekly: { utilization: 0.2, resetsAt: WEEK_RESET },
    },
  });

  assert.match(payload.description, new RegExp(`Weekly usage: 20% · resets <t:${WEEK_EPOCH}:R>`));
});

test("shows weekly usage above the limit as reported", () => {
  const payload = buildWindowNotification({
    success: true,
    rateLimit: {
      status: "allowed",
      resetsAt: RESET,
      fiveHourResetsAt: RESET,
      weekly: { utilization: 1.04, resetsAt: WEEK_RESET },
    },
  });

  assert.match(payload.description, /Weekly usage: 104%/);
});

test("leaves weekly usage out when it is unknown", () => {
  const payload = buildWindowNotification({
    success: true,
    rateLimit: {
      status: "allowed",
      resetsAt: RESET,
      fiveHourResetsAt: RESET,
      weekly: { utilization: null, resetsAt: WEEK_RESET },
    },
  });

  assert.doesNotMatch(payload.description, /Weekly usage/);
});

test("an explicit 5-hour limit is not called weekly, even when resets coincide", () => {
  const payload = buildWindowNotification({
    success: false,
    rateLimit: {
      status: "rejected",
      resetsAt: WEEK_RESET,
      fiveHourResetsAt: WEEK_RESET,
      limitType: "five_hour",
      weekly: { utilization: 0.4, resetsAt: WEEK_RESET },
    },
  });

  assert.equal(payload.title, "Usage limit reached");
});

test("every seven-day limit type counts as the weekly limit", () => {
  const payload = buildWindowNotification({
    success: false,
    rateLimit: {
      status: "rejected",
      resetsAt: WEEK_RESET,
      fiveHourResetsAt: null,
      limitType: "seven_day_overage_included",
      weekly: null,
    },
  });

  assert.equal(payload.title, "Weekly limit reached");
});

test("never presents the weekly reset as the current window's reset", () => {
  // A weekly warning without a 5-hour reset: the current window's reset is
  // unknown, so there is nothing true to announce
  const payload = buildWindowNotification({
    success: true,
    rateLimit: {
      status: "allowed_warning",
      resetsAt: WEEK_RESET,
      fiveHourResetsAt: null,
      limitType: "seven_day",
      weekly: { utilization: 0.9, resetsAt: WEEK_RESET },
    },
  });

  assert.equal(payload, null);
});

test("labels the weekly limit notification with the account", async () => {
  const sent = [];
  const notifier = createWindowNotifier("https://discord.test/hook", {
    label: "work",
    send: async (payload) => sent.push(payload),
  });

  await notifier.notify({
    success: false,
    rateLimit: {
      status: "rejected",
      resetsAt: WEEK_RESET,
      fiveHourResetsAt: null,
      limitType: "seven_day",
      weekly: { utilization: 1, resetsAt: WEEK_RESET },
    },
  });

  assert.equal(sent[0].title, "work · Weekly limit reached");
});

// --- Extra usage -----------------------------------------------------------

/** A pulse that succeeded on paid extra usage because a limit is reached. */
function extraUsagePulse(rateLimit = {}) {
  return {
    success: true,
    rateLimit: {
      status: "rejected",
      resetsAt: WEEK_RESET,
      fiveHourResetsAt: null,
      limitType: "seven_day",
      weekly: { utilization: 1, resetsAt: WEEK_RESET },
      overage: { status: "allowed", disabledReason: null, using: true, resetsAt: null },
      ...rateLimit,
    },
  };
}

test("announces a pulse that ran on paid extra usage because the weekly limit is reached", () => {
  const payload = buildExtraUsageNotification(extraUsagePulse());

  assert.equal(payload.title, "Extra usage in use");
  assert.equal(payload.level, "WARN");
  assert.match(payload.description, /ran on paid extra usage/);
  assert.match(payload.description, /weekly limit is reached/);
  // Days away: date and countdown
  assert.match(payload.description, new RegExp(`<t:${WEEK_EPOCH}:F>`));
  assert.match(payload.description, new RegExp(`<t:${WEEK_EPOCH}:R>`));
});

test("does not promise when the next pulse runs", () => {
  // A scheduled start hour or a restart can pulse before the limit lifts
  const payload = buildExtraUsageNotification(extraUsagePulse());

  assert.doesNotMatch(payload.description, /next pulse/i);
});

test("names the 5-hour limit when that is the one reached", () => {
  const payload = buildExtraUsageNotification(
    extraUsagePulse({ resetsAt: RESET, limitType: "five_hour", weekly: null }),
  );

  assert.match(payload.description, /5-hour limit is reached/);
  assert.match(payload.description, new RegExp(`<t:${RESET_EPOCH}:t>`));
});

test("says only that extra usage was used when the limit is not known", () => {
  // A newer CLI could report extra usage without a rejected limit
  const payload = buildExtraUsageNotification(
    extraUsagePulse({ status: "allowed", resetsAt: null }),
  );

  assert.equal(payload.description, "This pulse ran on paid extra usage.");
});

test("announces nothing when extra usage is not in use", () => {
  const using = extraUsagePulse().rateLimit.overage;

  assert.equal(
    buildExtraUsageNotification(extraUsagePulse({ overage: { ...using, using: false } })),
    null,
  );
  assert.equal(buildExtraUsageNotification(extraUsagePulse({ overage: null })), null);
  assert.equal(buildExtraUsageNotification({ success: true, rateLimit: null }), null);
});

test("announces nothing for a pulse that failed, since nothing was billed", () => {
  assert.equal(buildExtraUsageNotification({ ...extraUsagePulse(), success: false }), null);
});

test("the window announcement says extra usage was used instead of the limit message", () => {
  const payload = buildWindowNotification(extraUsagePulse());

  assert.equal(payload.title, "Extra usage in use");
});

test("a failed pulse keeps the limit message", () => {
  const payload = buildWindowNotification({ ...extraUsagePulse(), success: false });

  assert.equal(payload.title, "Weekly limit reached");
});

test("the window notifier prefixes the extra usage title with the account", async () => {
  const sent = [];
  const notifier = createWindowNotifier("https://discord.test/window", {
    label: "work",
    send: async (payload) => sent.push(payload),
  });

  await notifier.notify(extraUsagePulse());

  assert.equal(sent[0].title, "work · Extra usage in use");
});

test("the alerter posts an extra usage pulse to its webhook, labelled", async () => {
  const sent = [];
  const alerter = createExtraUsageAlerter("https://discord.test/errors", {
    label: "work",
    send: async (payload, url) => sent.push({ payload, url }),
  });

  await alerter.notify(extraUsagePulse());

  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://discord.test/errors");
  assert.equal(sent[0].payload.title, "work · Extra usage in use");
});

test("a notifier fails when Discord refuses its post, so the failure can be attributed", async () => {
  const refuse = async () => false;
  const windowNotifier = createWindowNotifier("https://discord.test/window", { send: refuse });
  const alerter = createExtraUsageAlerter("https://discord.test/errors", { send: refuse });

  await assert.rejects(windowNotifier.notify(allowedPulse()), /Discord did not accept/);
  await assert.rejects(alerter.notify(extraUsagePulse()), /Discord did not accept/);
});

test("the alerter stays silent for ordinary pulses and limit messages", async () => {
  const sent = [];
  const alerter = createExtraUsageAlerter("https://discord.test/errors", {
    send: async (payload) => sent.push(payload),
  });

  await alerter.notify(allowedPulse());
  await alerter.notify(rejectedPulse());
  await alerter.notify({ success: false, rateLimit: null });

  assert.deepEqual(sent, []);
});
