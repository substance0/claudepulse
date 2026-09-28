import { test } from "node:test";
import assert from "node:assert/strict";

// Europe/Paris switches from summer to winter time on Sun 25 Oct 2026.
process.env.TZ = "Europe/Paris";

const { createWorkHoursFromConfig } = await import(
  "../src/features/scheduling/workHours.js"
);

/** Work hours switched on with the given settings. */
const enabled = (settings) =>
  createWorkHoursFromConfig({ WORK_HOURS_ENABLED: true, ...settings });

/** A local time; month is 1-12. */
const local = (month, day, hour, minute = 0, second = 0) =>
  new Date(2026, month - 1, day, hour, minute, second);

// Mon 28 Sep 2026 … Sun 4 Oct 2026, then Mon 5 Oct.
const weekdays = enabled({
  WORK_START: "09:00",
  WORK_END: "19:00",
  HOURS_LEFT_AT_START: "2",
  WORK_DAYS: "Mon-Fri",
});

test("keeps a pulse planned during working hours", () => {
  const t = local(9, 30, 11, 0, 10); // Wed 11:00:10

  assert.equal(weekdays.nextAllowed(t).getTime(), t.getTime());
  assert.equal(weekdays.isActive(t), true);
});

test("opens the working day so 2 hours are left at 09:00", () => {
  // Wed 03:00 → Wed 06:00:10, whose window resets at 11:00
  assert.deepEqual(weekdays.nextAllowed(local(9, 30, 3)), local(9, 30, 6, 0, 10));
});

test("moves an evening pulse to the next working day", () => {
  assert.deepEqual(weekdays.nextAllowed(local(9, 30, 21, 0, 10)), local(10, 1, 6, 0, 10));
});

test("skips the weekend", () => {
  assert.deepEqual(weekdays.nextAllowed(local(10, 2, 21, 0, 10)), local(10, 5, 6, 0, 10));
  assert.deepEqual(weekdays.nextAllowed(local(10, 3, 10)), local(10, 5, 6, 0, 10));
});

test("WORK_END is exclusive", () => {
  const justBefore = local(9, 30, 18, 59, 59);

  assert.equal(weekdays.nextAllowed(justBefore).getTime(), justBefore.getTime());
  assert.deepEqual(weekdays.nextAllowed(local(9, 30, 19)), local(10, 1, 6, 0, 10));
});

test("the time before the day-start pulse is not active", () => {
  assert.equal(weekdays.isActive(local(9, 30, 5, 59)), false);
});

test("leaves exactly the hours asked for a start that is not on the hour", () => {
  const halfPast = enabled({
    WORK_START: "09:30",
    WORK_END: "19:00",
    HOURS_LEFT_AT_START: "2",
  });

  // Windows run 5 h from the pulse's minute: 06:30:10 resets at 11:30
  assert.deepEqual(halfPast.nextAllowed(local(9, 30, 3)), local(9, 30, 6, 30, 10));
});

test("defaults to opening the window when work starts", () => {
  const atStart = enabled({ WORK_START: "09:00", WORK_END: "19:00" });

  assert.deepEqual(atStart.nextAllowed(local(9, 30, 3)), local(9, 30, 9, 0, 10));
});

test("keeps the local day-start time across a daylight-saving change", () => {
  // From Friday in summer time to Monday in winter time: the clocks go back
  // on Sun 25 Oct, and Monday's pulse is still 06:00:10 local, 05:00:10 UTC
  const next = weekdays.nextAllowed(local(10, 23, 21));

  assert.equal(next.toISOString(), "2026-10-26T05:00:10.000Z");
});

// On a switch day, 5 wall-clock hours are not 5 real hours; windows last 5
// real hours, so the pulse must land 5 real hours before the target reset.
const earlyStart = () =>
  enabled({ WORK_START: "04:00", WORK_END: "10:00", HOURS_LEFT_AT_START: "2" });

test("leaves the hours asked on the day the clocks go back", () => {
  // Target reset Sun 25 Oct 06:00 CET = 05:00Z → pulse 00:00:10Z (02:00:10 CEST)
  const next = earlyStart().nextAllowed(local(10, 24, 12));

  assert.equal(next.toISOString(), "2026-10-25T00:00:10.000Z");
});

test("leaves the hours asked on the day the clocks go forward", () => {
  // Target reset Sun 29 Mar 06:00 CEST = 04:00Z → pulse 23:00:10Z the day before
  const next = earlyStart().nextAllowed(new Date(2026, 2, 28, 12));

  assert.equal(next.toISOString(), "2026-03-28T23:00:10.000Z");
});

test("a day-start pulse can fall on the previous evening", () => {
  const early = enabled({
    WORK_START: "01:00",
    WORK_END: "10:00",
    HOURS_LEFT_AT_START: "1",
  });

  // 01:00 + 1 h = 02:00 reset → pulse 21:00:10 the evening before
  assert.deepEqual(early.nextAllowed(local(9, 29, 12)), local(9, 29, 21, 0, 10));
  assert.equal(early.isActive(local(9, 29, 22)), true);
});

test("never returns a time earlier than asked", () => {
  for (let hour = 0; hour < 24 * 7; hour += 1) {
    const t = local(9, 28, 0 + hour);
    assert.ok(weekdays.nextAllowed(t) >= t, t.toString());
  }
});

test("is off without WORK_START", () => {
  assert.equal(createWorkHoursFromConfig({}), null);
});

test("with 5 hours left, opens the window as work starts", () => {
  const halfPast = enabled({ WORK_START: "09:30", WORK_END: "19:00" });

  assert.deepEqual(halfPast.nextAllowed(local(9, 30, 3)), local(9, 30, 9, 30, 10));
  assert.equal(halfPast.isActive(local(9, 30, 9, 45)), true);
});

test("is off unless WORK_HOURS_ENABLED is true", () => {
  assert.equal(createWorkHoursFromConfig({ WORK_START: "09:00", WORK_END: "19:00" }), null);
});
