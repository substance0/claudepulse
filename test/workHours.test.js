import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseClock,
  parseWorkDays,
  workHoursErrors,
  workHoursWarnings,
} from "../src/features/scheduling/workHours.js";

test("reads a 24-hour clock time", () => {
  assert.deepEqual(parseClock("09:30"), { hour: 9, minute: 30 });
  assert.deepEqual(parseClock("00:00"), { hour: 0, minute: 0 });
});

test("rejects a clock time that is not HH:MM", () => {
  for (const text of ["9:30", "24:00", "09:60", "0930", "", undefined]) {
    assert.equal(parseClock(text), null, String(text));
  }
});

test("reads day ranges and lists in any case", () => {
  assert.deepEqual([...parseWorkDays("Mon-Fri")].sort(), [1, 2, 3, 4, 5]);
  assert.deepEqual([...parseWorkDays("mon,wed")].sort(), [1, 3]);
  assert.deepEqual([...parseWorkDays("Mon-Thu,Sat")].sort(), [1, 2, 3, 4, 6]);
});

test("a range can wrap over the weekend", () => {
  assert.deepEqual([...parseWorkDays("Fri-Mon")].sort(), [0, 1, 5, 6]);
});

test("rejects an unknown day name", () => {
  assert.equal(parseWorkDays("Mon-Funday"), null);
  assert.equal(parseWorkDays(""), null);
});

test("accepts a complete work-hours configuration", () => {
  const errors = workHoursErrors({
    WORK_HOURS_ENABLED: true,
    WORK_START: "09:00",
    WORK_END: "19:00",
    HOURS_LEFT_AT_START: "2",
    WORK_DAYS: "Mon-Fri",
  });

  assert.deepEqual(errors, []);
});

test("accepts no work-hours configuration at all", () => {
  assert.deepEqual(workHoursErrors({}), []);
});

test("ignores work-hours settings while the feature is off", () => {
  // Settings can stay in place while work hours are switched off
  assert.deepEqual(workHoursErrors({ WORK_START: "9h", SCHEDULED_START_HOUR: 6 }), []);
});

test("explains each invalid work-hours setting", () => {
  const on = { WORK_HOURS_ENABLED: true };
  const cases = [
    [{ ...on, WORK_START: "9h", WORK_END: "19:00" }, /WORK_START must be HH:MM/],
    [{ ...on, WORK_START: "09:00" }, /WORK_END is required/],
    [{ ...on, WORK_START: "09:00", WORK_END: "7pm" }, /WORK_END must be HH:MM/],
    [{ ...on, WORK_START: "19:00", WORK_END: "09:00" }, /WORK_END must be later than WORK_START/],
    [{ ...on, WORK_START: "09:00", WORK_END: "19:00", HOURS_LEFT_AT_START: "6" }, /HOURS_LEFT_AT_START must be a whole number from 1 to 5/],
    [{ ...on, WORK_START: "09:00", WORK_END: "19:00", HOURS_LEFT_AT_START: "2.5" }, /HOURS_LEFT_AT_START/],
    [{ ...on, WORK_START: "09:00", WORK_END: "19:00", WORK_DAYS: "Weekdays" }, /WORK_DAYS must list days/],
    [{ ...on, WORK_END: "19:00" }, /WORK_HOURS_ENABLED=true requires WORK_START/],
    [{ ...on, WORK_START: "09:00", WORK_END: "19:00", SCHEDULED_START_HOUR: 6 }, /not both/],
  ];

  for (const [config, expected] of cases) {
    assert.match(workHoursErrors(config).join("\n"), expected, JSON.stringify(config));
  }
});

test("rejects a day range with more than one dash", () => {
  assert.equal(parseWorkDays("Mon-Tue-Wed"), null);
});

test("accepts spaces around a range dash", () => {
  assert.deepEqual([...parseWorkDays("Mon - Fri")].sort(), [1, 2, 3, 4, 5]);
});

test("warns when work-hours settings are present but switched off", () => {
  const warnings = workHoursWarnings({ WORK_START: "09:00", WORK_END: "19:00" });

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /WORK_HOURS_ENABLED/);
  assert.match(warnings[0], /ignored/);
});

test("no warning for usual work hours", () => {
  const warnings = workHoursWarnings({
    WORK_HOURS_ENABLED: true,
    WORK_START: "09:00",
    WORK_END: "19:00",
    HOURS_LEFT_AT_START: "2",
  });

  assert.deepEqual(warnings, []);
});

test("warns when the evening window can overlap the next day's first pulse", () => {
  // First pulse 23:00:10 the evening before; a window opened at 22:29 is
  // still open then
  const warnings = workHoursWarnings({
    WORK_HOURS_ENABLED: true,
    WORK_START: "03:00",
    WORK_END: "22:30",
    HOURS_LEFT_AT_START: "1",
  });

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /WORK_END/);
  assert.match(warnings[0], /WORK_HOURS_ENABLED=false/);
});

test("no warning at all without work-hours settings", () => {
  assert.deepEqual(workHoursWarnings({}), []);
});
