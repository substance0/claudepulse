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
