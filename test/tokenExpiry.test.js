import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildExpiryWarning,
  createTokenExpiryMonitor,
  daysLeft,
  dueThreshold,
  parseExpiryDate,
} from "../src/core/services/tokenExpiry.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRY = new Date(2027, 8, 25); // 25 Sep 2027, local midnight

test("reads an expiry date as local midnight", () => {
  assert.deepEqual(parseExpiryDate("2027-09-25"), EXPIRY);
});

test("rejects a date that does not exist or is not YYYY-MM-DD", () => {
  for (const text of ["2027-02-30", "2027-13-01", "25/09/2027", "2027-9-25", ""]) {
    assert.equal(parseExpiryDate(text), null, text);
  }
});

test("counts partial days as a full day left", () => {
  assert.equal(daysLeft(EXPIRY, new Date(EXPIRY.getTime() - 1)), 1);
  assert.equal(daysLeft(EXPIRY, new Date(EXPIRY.getTime() - 6.5 * DAY_MS)), 7);
  assert.equal(daysLeft(EXPIRY, EXPIRY), 0);
});

test("picks the closest threshold at or above the days left", () => {
  assert.equal(dueThreshold(20), null);
  assert.equal(dueThreshold(14), 14);
  assert.equal(dueThreshold(13), 14);
  assert.equal(dueThreshold(7), 7);
  assert.equal(dueThreshold(3), 7);
  assert.equal(dueThreshold(1), 1);
  assert.equal(dueThreshold(0), 0);
  assert.equal(dueThreshold(-5), 0);
});

test("a warning before expiry says how to renew", () => {
  const warning = buildExpiryWarning(7, EXPIRY);

  assert.equal(warning.title, "Claude token expires in 7 days");
  assert.equal(warning.level, "WARN");
  assert.match(warning.description, /claude setup-token/);
  assert.match(warning.description, /<t:\d+:D>/);
});

test("an expired token is an error", () => {
  const warning = buildExpiryWarning(0, EXPIRY, "work");

  assert.equal(warning.title, "work · Claude token expired");
  assert.equal(warning.level, "ERROR");
});

test("says day, not days, for one day left", () => {
  assert.equal(buildExpiryWarning(1, EXPIRY).title, "Claude token expires in 1 day");
});

function buildMonitor(nowRef) {
  const sent = [];
  const warned = [];
  const monitor = createTokenExpiryMonitor({
    expiresAt: EXPIRY,
    webhookUrl: "https://discord.test/hook",
    logger: {
      warn: (_c, message) => warned.push(message),
      error: (_c, message) => warned.push(message),
    },
    send: async (payload) => sent.push(payload),
    now: () => nowRef.value,
  });
  return { monitor, sent, warned };
}

test("sends each threshold once", async () => {
  const now = { value: new Date(EXPIRY.getTime() - 3 * DAY_MS) };
  const { monitor, sent } = buildMonitor(now);

  await monitor.check();
  await monitor.check();
  now.value = new Date(EXPIRY.getTime() - 0.5 * DAY_MS);
  await monitor.check();
  now.value = new Date(EXPIRY.getTime() + DAY_MS);
  await monitor.check();
  await monitor.check();

  assert.deepEqual(
    sent.map((p) => p.title),
    [
      "Claude token expires in 3 days",
      "Claude token expires in 1 day",
      "Claude token expired",
    ],
  );
});

test("sends nothing while expiry is far away", async () => {
  const { monitor, sent } = buildMonitor({ value: new Date(EXPIRY.getTime() - 30 * DAY_MS) });

  await monitor.check();

  assert.deepEqual(sent, []);
});

test("logs each warning too", async () => {
  const { monitor, warned } = buildMonitor({ value: new Date(EXPIRY.getTime() - 3 * DAY_MS) });

  await monitor.check();

  assert.deepEqual(warned, ["Claude token expires in 3 days"]);
});
