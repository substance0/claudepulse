import { test } from "node:test";
import assert from "node:assert/strict";

import {
  nextPulseFromRateLimit,
  SchedulingStrategyManager,
} from "../src/features/scheduling/strategy/scheduling-strategies.js";

const NOW = new Date("2026-09-24T09:00:00Z");
const WINDOW_RESET = new Date("2026-09-24T13:50:00Z");
const WEEK_RESET = new Date("2026-09-26T09:00:00Z");
const BUFFER_MS = 10 * 1000;

// --- nextPulseFromRateLimit ------------------------------------------------

test("an allowed pulse schedules the next one just after the 5-hour reset", () => {
  const next = nextPulseFromRateLimit(
    { status: "allowed", resetsAt: WINDOW_RESET, fiveHourResetsAt: WINDOW_RESET },
    NOW,
  );

  assert.equal(next.getTime(), WINDOW_RESET.getTime() + BUFFER_MS);
});

test("a warning is still allowed and follows the 5-hour reset", () => {
  const next = nextPulseFromRateLimit(
    { status: "allowed_warning", resetsAt: WEEK_RESET, fiveHourResetsAt: WINDOW_RESET },
    NOW,
  );

  assert.equal(next.getTime(), WINDOW_RESET.getTime() + BUFFER_MS);
});

test("a rejected pulse waits for the blocking window, whichever it is", () => {
  const next = nextPulseFromRateLimit(
    { status: "rejected", resetsAt: WEEK_RESET, fiveHourResetsAt: WINDOW_RESET },
    NOW,
  );

  // Pulsing at the 5-hour reset would just be rejected again
  assert.equal(next.getTime(), WEEK_RESET.getTime() + BUFFER_MS);
});

test("does not round the reset to the hour", () => {
  // The measured window reset at 15:50 local; rounding up to 16:00:10 would
  // waste ten minutes of every window
  const next = nextPulseFromRateLimit(
    { status: "allowed", resetsAt: WINDOW_RESET, fiveHourResetsAt: WINDOW_RESET },
    NOW,
  );

  assert.equal(next.getUTCMinutes(), 50);
  assert.equal(next.getUTCSeconds(), 10);
});

test("returns null without rate-limit information", () => {
  assert.equal(nextPulseFromRateLimit(null, NOW), null);
});

test("returns null when an allowed pulse carries no 5-hour reset", () => {
  const next = nextPulseFromRateLimit(
    { status: "allowed", resetsAt: WEEK_RESET, fiveHourResetsAt: null },
    NOW,
  );

  assert.equal(next, null);
});

test("returns null for a reset that has already passed", () => {
  const past = new Date(NOW.getTime() - 60 * 1000);
  const next = nextPulseFromRateLimit(
    { status: "allowed", resetsAt: past, fiveHourResetsAt: past },
    NOW,
  );

  assert.equal(next, null);
});

// --- Strategy selection ----------------------------------------------------

const HOURLY = new Date("2026-09-24T10:00:10Z");
const CONFIGURED_START = new Date("2026-09-25T04:00:10Z");

function context(overrides = {}) {
  return {
    now: NOW,
    lastScheduledTime: new Date("2026-09-24T08:00:00Z"),
    rateLimit: null,
    nextHourPlusTen: () => HOURLY,
    nextFromInitialPulseHourPlusTen: () => null,
    ...overrides,
  };
}

const ALLOWED = {
  status: "allowed",
  resetsAt: WINDOW_RESET,
  fiveHourResetsAt: WINDOW_RESET,
};

test("schedules from the window when a pulse reported one", async () => {
  const result = await new SchedulingStrategyManager().computeNextRunTime(
    context({ rateLimit: ALLOWED }),
  );

  assert.equal(result.strategy, "window_reset");
  assert.equal(result.time.getTime(), WINDOW_RESET.getTime() + BUFFER_MS);
});

test("falls back to hourly discovery when no window is known", async () => {
  const result = await new SchedulingStrategyManager().computeNextRunTime(
    context(),
  );

  assert.equal(result.strategy, "discovery");
  assert.equal(result.time, HOURLY);
});

test("a configured start hour wins for the first scheduled pulse", async () => {
  const result = await new SchedulingStrategyManager().computeNextRunTime(
    context({
      lastScheduledTime: null,
      rateLimit: ALLOWED,
      nextFromInitialPulseHourPlusTen: () => CONFIGURED_START,
    }),
  );

  assert.equal(result.strategy, "scheduled_start");
});

test("the window wins over a configured start hour after the first pulse", async () => {
  const result = await new SchedulingStrategyManager().computeNextRunTime(
    context({
      rateLimit: ALLOWED,
      nextFromInitialPulseHourPlusTen: () => CONFIGURED_START,
    }),
  );

  assert.equal(result.strategy, "window_reset");
});

test("offers only the three remaining strategies", () => {
  const names = new SchedulingStrategyManager()
    .getStrategies()
    .map((s) => s.getStrategyName());

  assert.deepEqual(names, ["scheduled_start", "window_reset", "discovery"]);
});
