import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createStateStore, scheduleFingerprint } from "../src/core/services/stateStore.js";

async function tempDir(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "claudepulse-state-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

const RATE_LIMIT = {
  status: "allowed",
  resetsAt: new Date("2026-09-30T09:00:00.000Z"),
  fiveHourResetsAt: new Date("2026-09-30T09:00:00.000Z"),
  limitType: "five_hour",
  weekly: { utilization: 0.2, resetsAt: new Date("2026-10-02T07:00:00.000Z") },
};

test("restores what it saved, with dates as dates", async (t) => {
  const store = createStateStore(await tempDir(t));
  const nextPulseAt = new Date("2026-09-30T09:00:10.000Z");

  await store.save({ nextPulseAt, rateLimit: RATE_LIMIT });
  const loaded = await store.load();

  assert.deepEqual(loaded, {
    nextPulseAt,
    rateLimit: RATE_LIMIT,
    strategy: null,
    fingerprint: null,
  });
});

test("saves a rate limit that has no weekly window or limit type", async (t) => {
  const store = createStateStore(await tempDir(t));
  const nextPulseAt = new Date("2026-09-30T09:00:10.000Z");
  const bare = { status: "allowed", resetsAt: nextPulseAt, fiveHourResetsAt: null };

  await store.save({ nextPulseAt, rateLimit: bare });
  const loaded = await store.load();

  assert.deepEqual(loaded.rateLimit, { ...bare, limitType: null, weekly: null });
});

test("saves no rate limit at all", async (t) => {
  const store = createStateStore(await tempDir(t));
  const nextPulseAt = new Date("2026-09-30T09:00:10.000Z");

  await store.save({ nextPulseAt, rateLimit: null });

  assert.deepEqual(await store.load(), {
    nextPulseAt,
    rateLimit: null,
    strategy: null,
    fingerprint: null,
  });
});

test("has nothing to restore before the first save", async (t) => {
  const store = createStateStore(await tempDir(t));

  assert.equal(await store.load(), null);
});

test("creates the state directory when missing", async (t) => {
  const dir = path.join(await tempDir(t), "nested");
  const store = createStateStore(dir);

  await store.save({ nextPulseAt: new Date(), rateLimit: null });

  assert.ok((await fs.stat(path.join(dir, "state.json"))).isFile());
});

test("leaves no temporary file behind", async (t) => {
  const dir = await tempDir(t);

  await createStateStore(dir).save({ nextPulseAt: new Date(), rateLimit: null });

  assert.deepEqual(await fs.readdir(dir), ["state.json"]);
});

test("refuses a truncated state file", async (t) => {
  const dir = await tempDir(t);
  await fs.writeFile(path.join(dir, "state.json"), '{"version":1,"nextPu');

  await assert.rejects(createStateStore(dir).load());
});

test("refuses a state file of another version", async (t) => {
  const dir = await tempDir(t);
  await fs.writeFile(
    path.join(dir, "state.json"),
    JSON.stringify({ version: 2, nextPulseAt: new Date().toISOString() }),
  );

  await assert.rejects(createStateStore(dir).load(), /version/);
});

test("refuses a state file without a valid next pulse time", async (t) => {
  const dir = await tempDir(t);
  await fs.writeFile(
    path.join(dir, "state.json"),
    JSON.stringify({ version: 1, nextPulseAt: "not a date", rateLimit: null }),
  );

  await assert.rejects(createStateStore(dir).load(), /nextPulseAt/);
});

test("concurrent saves into one directory all succeed", async (t) => {
  // Two containers starting together share a directory when a volume is
  // shared; a fixed temporary name made one rename fail
  const dir = await tempDir(t);
  const stores = [createStateStore(dir), createStateStore(dir)];

  const saves = Array.from({ length: 40 }, (_, i) =>
    stores[i % 2].save({ nextPulseAt: new Date(Date.UTC(2026, 9, 5, i)), rateLimit: null }),
  );

  await Promise.all(saves);
  assert.ok((await createStateStore(dir).load()).nextPulseAt instanceof Date);
  assert.deepEqual(await fs.readdir(dir), ["state.json"]);
});

test("removes its temporary file when the save fails", async (t) => {
  const dir = await tempDir(t);
  // A directory where the state file must go makes the rename fail
  await fs.mkdir(path.join(dir, "state.json"));

  await assert.rejects(
    createStateStore(dir).save({ nextPulseAt: new Date(), rateLimit: null }),
  );

  assert.deepEqual(await fs.readdir(dir), ["state.json"]);
});

test("restores the strategy and settings fingerprint it saved", async (t) => {
  const store = createStateStore(await tempDir(t));
  const nextPulseAt = new Date("2026-09-30T09:00:10.000Z");

  await store.save({ nextPulseAt, rateLimit: null, strategy: "window_reset", fingerprint: "fp-1" });
  const loaded = await store.load();

  assert.equal(loaded.strategy, "window_reset");
  assert.equal(loaded.fingerprint, "fp-1");
});

test("reads a state saved without a strategy or fingerprint as having none", async (t) => {
  const dir = await tempDir(t);
  await fs.writeFile(
    path.join(dir, "state.json"),
    JSON.stringify({ version: 1, nextPulseAt: "2026-09-30T09:00:10.000Z", rateLimit: null }),
  );

  const loaded = await createStateStore(dir).load();

  assert.equal(loaded.strategy, null);
  assert.equal(loaded.fingerprint, null);
});

const SETTINGS = {
  WORK_HOURS_ENABLED: true,
  WORK_START: "09:00",
  WORK_END: "19:00",
  WORK_DAYS: "Mon-Fri",
  HOURS_LEFT_AT_START: "2",
  SCHEDULED_START_HOUR: undefined,
  IMMEDIATE_PULSE_AFTER_AUTH: true,
  ACCOUNT_LABEL: "work",
  LOG_LEVEL: "INFO",
  DISCORD_WEBHOOK_URL: "https://discord.test/hook",
};

test("the fingerprint is the same for the same scheduling settings", () => {
  assert.equal(scheduleFingerprint(SETTINGS), scheduleFingerprint({ ...SETTINGS }));
});

test("the fingerprint changes with every setting that changes the schedule", () => {
  const base = scheduleFingerprint(SETTINGS);
  const changes = {
    WORK_HOURS_ENABLED: false,
    WORK_START: "08:00",
    WORK_END: "18:00",
    WORK_DAYS: "Mon-Sat",
    HOURS_LEFT_AT_START: "3",
    SCHEDULED_START_HOUR: 4,
    IMMEDIATE_PULSE_AFTER_AUTH: false,
    ACCOUNT_LABEL: "personal",
  };

  for (const [key, value] of Object.entries(changes)) {
    assert.notEqual(scheduleFingerprint({ ...SETTINGS, [key]: value }), base, key);
  }
});

test("the fingerprint changes with the time zone", (t) => {
  const original = process.env.TZ;
  t.after(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  process.env.TZ = "Europe/Paris";
  const paris = scheduleFingerprint(SETTINGS);
  process.env.TZ = "Asia/Tokyo";

  assert.notEqual(scheduleFingerprint(SETTINGS), paris);
});

test("the fingerprint ignores settings that do not change the schedule", () => {
  const base = scheduleFingerprint(SETTINGS);

  assert.equal(scheduleFingerprint({ ...SETTINGS, LOG_LEVEL: "DEBUG" }), base);
  assert.equal(scheduleFingerprint({ ...SETTINGS, DISCORD_WEBHOOK_URL: undefined }), base);
});
