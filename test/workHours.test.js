import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseClock,
  parseWorkDays,
  workHoursErrors,
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

test("explains each invalid work-hours setting", () => {
  const cases = [
    [{ WORK_START: "9h", WORK_END: "19:00" }, /WORK_START must be HH:MM/],
    [{ WORK_START: "09:00" }, /WORK_END is required/],
    [{ WORK_START: "09:00", WORK_END: "7pm" }, /WORK_END must be HH:MM/],
    [{ WORK_START: "19:00", WORK_END: "09:00" }, /WORK_END must be later than WORK_START/],
    [{ WORK_START: "09:00", WORK_END: "19:00", HOURS_LEFT_AT_START: "6" }, /HOURS_LEFT_AT_START must be a whole number from 1 to 5/],
    [{ WORK_START: "09:00", WORK_END: "19:00", HOURS_LEFT_AT_START: "2.5" }, /HOURS_LEFT_AT_START/],
    [{ WORK_START: "09:00", WORK_END: "19:00", WORK_DAYS: "Weekdays" }, /WORK_DAYS must list days/],
    [{ WORK_END: "19:00" }, /require WORK_START/],
    [{ WORK_START: "09:00", WORK_END: "19:00", SCHEDULED_START_HOUR: 6 }, /not both/],
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
