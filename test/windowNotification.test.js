import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildWindowNotification,
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
