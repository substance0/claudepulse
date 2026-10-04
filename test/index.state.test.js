import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { DateUtility } from "../src/core/utils/DateUtility.js";
import { runUntilStopped } from "./helpers/runApp.js";

test("a restart resumes the schedule saved by the previous run", async (t) => {
  // Arrange: a state directory both runs share, and a first pulse about 12
  // hours away so neither run sends one
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claudepulse-state-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const env = {
    STATE_DIR: dir,
    SCHEDULED_START_HOUR: String((new Date().getHours() + 12) % 24),
  };

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

test("without STATE_DIR no state file is written", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claudepulse-state-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));

  await runUntilStopped({});

  assert.deepEqual(await fs.readdir(dir), []);
});
