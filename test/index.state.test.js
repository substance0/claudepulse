import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DateUtility } from "../src/core/utils/DateUtility.js";
import { runUntilStopped } from "./helpers/runApp.js";

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claudepulse-state-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

const ENTRY = fileURLToPath(new URL("../src/index.js", import.meta.url));

/** A first-pulse hour about 12 hours away, so no run sends a pulse. */
const hoursAhead = (hours) => String((new Date().getHours() + hours) % 24);

test("a restart resumes the schedule saved by the previous run", async (t) => {
  // Arrange: a state directory both runs share
  const dir = await tempDir(t);
  const env = { STATE_DIR: dir, SCHEDULED_START_HOUR: hoursAhead(12) };

  // Act
  const first = await runUntilStopped(env);
  const saved = JSON.parse(await fs.readFile(path.join(dir, "state.json"), "utf8"));
  const second = await runUntilStopped(env);

  // Assert
  assert.doesNotMatch(first, /Resuming saved schedule/);
  assert.equal(saved.version, 1);
  assert.match(second, /Resuming saved schedule/);
  assert.match(second, /strategy=restored/);
  // The resumed pulse is the saved one, not a newly computed time
  const resumed = DateUtility.formatLocalIso(new Date(saved.nextPulseAt));
  assert.ok(second.includes(`next_run=${resumed}`), second);
});

test("a restart under changed settings does not resume the saved schedule", async (t) => {
  const dir = await tempDir(t);

  await runUntilStopped({ STATE_DIR: dir, SCHEDULED_START_HOUR: hoursAhead(12) });
  const second = await runUntilStopped({ STATE_DIR: dir, SCHEDULED_START_HOUR: hoursAhead(6) });

  assert.match(second, /settings changed/i);
  assert.doesNotMatch(second, /Resuming saved schedule/);
  assert.match(second, /strategy=scheduled_start/);
});

test("without STATE_DIR no state file is written anywhere the app could reach", async (t) => {
  // The app runs with its working, temporary and home directories all inside
  // one directory, which is searched afterwards
  const dir = await tempDir(t);

  await runUntilStopped({ TMPDIR: dir, HOME: dir }, { cwd: dir });

  const files = await fs.readdir(dir, { recursive: true });
  assert.deepEqual(files.filter((name) => name.endsWith("state.json")), []);
});

test("a dry run reports the saved schedule and leaves the state file untouched", async (t) => {
  const dir = await tempDir(t);
  const env = { STATE_DIR: dir, SCHEDULED_START_HOUR: hoursAhead(12) };
  await runUntilStopped(env);
  const stateFile = path.join(dir, "state.json");
  const before = await fs.readFile(stateFile, "utf8");

  const dryRun = spawnSync(process.execPath, [ENTRY], {
    env: {
      ...process.env,
      ...env,
      DRY_RUN: "true",
      IMMEDIATE_PULSE_AFTER_AUTH: "false",
      CLAUDE_CODE_OAUTH_TOKEN: "placeholder",
      DISCORD_ERROR_WEBHOOK_URL: "",
      DISCORD_WINDOW_WEBHOOK_URL: "",
      NO_COLOR: "1",
    },
    encoding: "utf8",
  });

  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.match(dryRun.stdout, /resumed from saved schedule/);
  assert.equal(await fs.readFile(stateFile, "utf8"), before);
});
