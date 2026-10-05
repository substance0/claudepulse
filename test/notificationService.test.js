import { test } from "node:test";
import assert from "node:assert/strict";

import { sendDiscordAlert } from "../src/core/services/notificationService.js";

const WEBHOOK = "https://discord.test/hook";
const PAYLOAD = { title: "t", description: "d", level: "WARN" };

test("reports a delivered alert", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({ ok: true }));

  assert.equal(await sendDiscordAlert(PAYLOAD, WEBHOOK), true);
});

test("reports an alert Discord refused", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({ ok: false, status: 500, statusText: "x" }));
  t.mock.method(console, "error", () => {});

  assert.equal(await sendDiscordAlert(PAYLOAD, WEBHOOK), false);
});

test("reports an alert that never reached Discord", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network down");
  });
  t.mock.method(console, "error", () => {});

  assert.equal(await sendDiscordAlert(PAYLOAD, WEBHOOK), false);
});

test("never logs a webhook URL that cannot be parsed", async (t) => {
  // A value copied with its quotes, as an env file read by `docker run --env-file` keeps them
  const quoted = '"https://discord.com/api/webhooks/123/SECRET-TOKEN"';
  const logged = [];
  t.mock.method(console, "error", (line) => logged.push(String(line)));

  assert.equal(await sendDiscordAlert(PAYLOAD, quoted), false);

  assert.equal(logged.length, 1);
  assert.doesNotMatch(logged[0], /SECRET-TOKEN/);
});

test("reports nothing sent without a webhook", async () => {
  assert.equal(await sendDiscordAlert(PAYLOAD, undefined), false);
});
