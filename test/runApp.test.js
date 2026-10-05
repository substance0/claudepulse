import { test } from "node:test";
import assert from "node:assert/strict";

import { runUntilStopped } from "./helpers/runApp.js";

const SHELL_SETTINGS = {
  ACCOUNT_LABEL: "shell",
  LOG_LEVEL: "ERROR",
  TOKEN_EXPIRES_AT: "2020-01-01",
  DRY_RUN: "true",
  WORK_HOURS_ENABLED: "true",
  SCHEDULED_START_HOUR: "7",
};

test("an app run ignores settings exported in the developer's shell", { timeout: 20000 }, async () => {
  const saved = Object.fromEntries(
    Object.keys(SHELL_SETTINGS).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, SHELL_SETTINGS);

  try {
    const output = await runUntilStopped({});

    assert.match(output, /automation running/);
    assert.doesNotMatch(output, /\[shell\]/);
    assert.doesNotMatch(output, /2020-01-01/);
    assert.doesNotMatch(output, /work hours/i);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("an app run that never reports running fails instead of waiting forever", async () => {
  await assert.rejects(
    runUntilStopped({}, { timeoutMs: 1 }),
    /did not report running/,
  );
});
