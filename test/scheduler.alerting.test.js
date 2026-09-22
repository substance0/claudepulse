import { test } from "node:test";
import assert from "node:assert/strict";

import { shouldAlertForFailureCount } from "../src/features/scheduling/automation/scheduler.js";

test("alerts on the first failure", () => {
  assert.equal(shouldAlertForFailureCount(1), true);
});

test("alerts on the second failure", () => {
  assert.equal(shouldAlertForFailureCount(2), true);
});

test("stays quiet on a third consecutive failure", () => {
  // Arrange / Act / Assert - the operator already knows after 1 and 2
  assert.equal(shouldAlertForFailureCount(3), false);
});

test("re-alerts at exponentially spaced failure counts", () => {
  for (const count of [4, 8, 16, 32, 64, 128]) {
    assert.equal(
      shouldAlertForFailureCount(count),
      true,
      `expected an alert at ${count} consecutive failures`,
    );
  }
});

test("never alerts on the long tail between those points", () => {
  for (const count of [5, 6, 7, 9, 100, 2976]) {
    assert.equal(
      shouldAlertForFailureCount(count),
      false,
      `expected no alert at ${count} consecutive failures`,
    );
  }
});

test("does not alert when there is no failure", () => {
  assert.equal(shouldAlertForFailureCount(0), false);
});
