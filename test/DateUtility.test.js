import { test } from "node:test";
import assert from "node:assert/strict";

import { DateUtility } from "../src/core/utils/DateUtility.js";

const LOCAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/;

test("formats a date as ISO 8601 with the local offset", () => {
  assert.match(DateUtility.formatLocalIso(new Date()), LOCAL_ISO);
});

test("refers to the same instant as its input", () => {
  const instant = new Date("2026-09-24T13:50:00.000Z");

  const formatted = DateUtility.formatLocalIso(instant);

  assert.equal(new Date(formatted).getTime(), instant.getTime());
});

test("accepts strings and epoch milliseconds as well as dates", () => {
  const ms = Date.UTC(2026, 8, 24, 13, 50);

  assert.equal(
    DateUtility.formatLocalIso(ms),
    DateUtility.formatLocalIso(new Date(ms).toISOString()),
  );
});

test("reports an unparseable input rather than throwing", () => {
  assert.equal(DateUtility.formatLocalIso("not a date"), "Invalid Date");
});

test("exposes only the formatter the application uses", () => {
  // The instance methods parsed Claude Code's JSONL logs, which ClaudePulse
  // no longer reads
  const methods = Object.getOwnPropertyNames(DateUtility.prototype).filter(
    (name) => name !== "constructor",
  );

  assert.deepEqual(methods, []);
});
