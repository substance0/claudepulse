import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createStateStore } from "../src/core/services/stateStore.js";

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

  assert.deepEqual(loaded, { nextPulseAt, rateLimit: RATE_LIMIT });
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

  assert.deepEqual(await store.load(), { nextPulseAt, rateLimit: null });
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
