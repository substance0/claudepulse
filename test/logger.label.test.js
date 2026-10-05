import { test } from "node:test";
import assert from "node:assert/strict";

import { Logger } from "../src/core/utils/logger.js";

const INFO = 2;
const WEBHOOK = "https://discord.com/api/webhooks/1/test-webhook";

test("prefixes each line with the account label", () => {
  const logger = new Logger({ label: "work", enableColors: false });

  const line = logger._formatLogEntry(INFO, "pulse", "Pulse successful");

  assert.match(line, /\[INFO\] \[work\] \[PULSE\] Pulse successful$/);
});

test("adds no label brackets when no label is set", () => {
  const logger = new Logger({ enableColors: false });

  const line = logger._formatLogEntry(INFO, "pulse", "Pulse successful");

  assert.match(line, /\[INFO\] \[PULSE\] Pulse successful$/);
});

test("a child logger keeps the label of its parent", () => {
  const parent = new Logger({ label: "work" });

  const child = parent.child({ component: "scheduler" });

  assert.equal(child.label, "work");
});

test("error alerts name the account", async (t) => {
  // Arrange: capture what would be posted to Discord
  const posted = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    posted.push(JSON.parse(init.body));
    return { ok: true };
  });
  const logger = new Logger({
    label: "work",
    discordWebhookUrl: WEBHOOK,
    enableColors: false,
  });
  t.mock.method(process.stderr, "write", () => true);

  // Act
  await logger.error("cycle", "All retry attempts exhausted");
  await new Promise((resolve) => setImmediate(resolve));

  // Assert
  assert.equal(posted[0].embeds[0].title, "claudepulse (work) Error");
});

test("error alerts without a label are titled with the service alone", async (t) => {
  const posted = [];
  t.mock.method(globalThis, "fetch", async (_url, init) => {
    posted.push(JSON.parse(init.body));
    return { ok: true };
  });
  const logger = new Logger({ discordWebhookUrl: WEBHOOK, enableColors: false });
  t.mock.method(process.stderr, "write", () => true);

  await logger.error("cycle", "All retry attempts exhausted");
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(posted[0].embeds[0].title, "claudepulse Error");
});
