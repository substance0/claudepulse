import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildExpiryWarning,
  createTokenExpiryMonitor,
  daysLeft,
  dueThreshold,
  parseExpiryDate,
} from "../src/core/services/tokenExpiry.js";
import { DateUtility } from "../src/core/utils/DateUtility.js";

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

test("retries a warning Discord did not accept, logging it once", async () => {
  // Arrange: the first delivery fails, the next succeeds
  const now = { value: new Date(EXPIRY.getTime() - 0.5 * DAY_MS) };
  const attempts = [];
  const warned = [];
  const results = [false, true];
  const monitor = createTokenExpiryMonitor({
    expiresAt: EXPIRY,
    webhookUrl: "https://discord.test/hook",
    logger: { warn: (_c, message) => warned.push(message) },
    send: async (payload) => {
      attempts.push(payload.title);
      return results.shift();
    },
    now: () => now.value,
  });

  // Act: three hourly checks
  await monitor.check();
  await monitor.check();
  await monitor.check();

  // Assert: retried until delivered, then quiet; logged once
  assert.deepEqual(attempts, ["Claude token expires in 1 day", "Claude token expires in 1 day"]);
  assert.deepEqual(warned, ["Claude token expires in 1 day"]);
});

test("without a webhook, logs each warning once", async () => {
  const warned = [];
  const monitor = createTokenExpiryMonitor({
    expiresAt: EXPIRY,
    webhookUrl: undefined,
    logger: { warn: (_c, message) => warned.push(message) },
    send: async () => false,
    now: () => new Date(EXPIRY.getTime() - 3 * DAY_MS),
  });

  await monitor.check();
  await monitor.check();

  assert.deepEqual(warned, ["Claude token expires in 3 days"]);
});

test("logs the warning without the label the logger already shows, with the local date", async () => {
  // Arrange
  const logged = [];
  const sent = [];
  const monitor = createTokenExpiryMonitor({
    expiresAt: EXPIRY,
    webhookUrl: "https://discord.test/hook",
    label: "work",
    logger: { warn: (_c, message, data) => logged.push({ message, data }) },
    send: async (payload) => {
      sent.push(payload);
      return true;
    },
    now: () => new Date(EXPIRY.getTime() - 3 * DAY_MS),
  });

  // Act
  await monitor.check();

  // Assert: the log line has no second label and reads in local time;
  // Discord still names the account
  assert.equal(logged[0].message, "Claude token expires in 3 days");
  assert.equal(logged[0].data.expiresAt, DateUtility.formatLocalIso(EXPIRY));
  assert.equal(sent[0].title, "work · Claude token expires in 3 days");
});
