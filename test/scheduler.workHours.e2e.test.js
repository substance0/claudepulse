import { test } from "node:test";
import assert from "node:assert/strict";

process.env.TZ = "Europe/Paris";

const { PulseScheduler } = await import(
  "../src/features/scheduling/automation/scheduler.js"
);
const { createWorkHoursFromConfig } = await import(
  "../src/features/scheduling/workHours.js"
);

function quietLogger(record) {
  const logger = {
    info() {},
    warn() {},
    debug() {},
    error() {},
    startTimer: () => ({}),
    endTimer: () => ({ ms: 1 }),
    logScheduler: (event, data) => {
      if (event === "next_pulse_scheduled") record.scheduled.push(data);
    },
    child: () => logger,
  };
  return logger;
}

test("a limit lifting after work hours waits for the next working day", async (t) => {
  // Arrange: Wednesday 30 Sep 2026 at 18:00, the limit lifts at 20:30
  t.mock.timers.enable({ apis: ["Date"], now: new Date(2026, 8, 30, 18, 0) });
  const lift = new Date(2026, 8, 30, 20, 30);
  const record = { scheduled: [] };
  const scheduler = new PulseScheduler({
    executor: {
      pulse: async () => ({
        success: false,
        authFailure: false,
        error: "You've hit your session limit",
        rateLimit: { status: "rejected", resetsAt: lift, fiveHourResetsAt: lift },
      }),
    },
    logger: quietLogger(record),
    config: { PROMPT_TEXT: "pulse check", MAX_RETRIES: 3 },
    workHours: createWorkHoursFromConfig({
      WORK_HOURS_ENABLED: true,
      WORK_START: "09:00",
      WORK_END: "19:00",
      HOURS_LEFT_AT_START: "2",
      WORK_DAYS: "Mon-Fri",
    }),
  });
  scheduler.running = true;

  // Act
  try {
    await scheduler._executePulseCycle();
    await scheduler._scheduleNext();
  } finally {
    await scheduler.shutdown();
  }

  // Assert: Thursday's day-start pulse, which is after the lift
  const next = record.scheduled.at(-1);
  assert.equal(next.strategy, "work_hours");
  assert.equal(new Date(next.nextRunTime).getTime(), new Date(2026, 9, 1, 6, 0, 10).getTime());
  assert.ok(new Date(next.nextRunTime) > lift);
});
