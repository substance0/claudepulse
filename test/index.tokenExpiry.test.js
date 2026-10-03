import { test } from "node:test";
import assert from "node:assert/strict";

import { runUntilStopped } from "./helpers/runApp.js";

test("checks the token expiry at startup, before the scheduler starts", async () => {
  // An expired token's alert should come before any pulse can fail on it
  const output = await runUntilStopped({ TOKEN_EXPIRES_AT: "2026-01-01" });

  const expired = output.indexOf("[TOKEN] Claude token expired");
  const schedulerStart = output.indexOf("Starting scheduler");
  assert.ok(expired > -1, output);
  assert.ok(expired < schedulerStart, output);
});
