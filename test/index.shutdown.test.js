import { test } from "node:test";
import assert from "node:assert/strict";

import { runUntilStopped } from "./helpers/runApp.js";

test("the shutdown log line carries the account label", async () => {
  const output = await runUntilStopped({ ACCOUNT_LABEL: "work" });

  assert.match(output, /\[INFO\] \[work\] \[SHUTDOWN\] Received SIGTERM signal/);
});
