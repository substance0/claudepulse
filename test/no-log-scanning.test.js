import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

/** Every .js file under a directory, recursively. */
async function walk(dir) {
  const out = [];

  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full)));
    } else if (entry.name.endsWith(".js")) {
      out.push(full);
    }
  }

  return out;
}

/** Source files mentioning any of the given names. */
async function filesMentioning(names) {
  const offenders = [];

  for (const file of await walk("src")) {
    const text = await fs.readFile(file, "utf8");
    if (names.some((name) => text.includes(name))) {
      offenders.push(file);
    }
  }

  return offenders;
}

test("schedules from the pulse's rate-limit event, not from scanned logs", async () => {
  // Pulses write no project logs, and limit messages never matched the
  // formats Claude Code ships, so these modules could only mislead.
  assert.deepEqual(
    await filesMentioning([
      "SessionTracker",
      "ClaudeLogReader",
      "ProjectLogAggregator",
      "CycleComputer",
      "SessionLimitParser",
    ]),
    [],
  );
});

test("carries no configuration that nothing reads", async () => {
  assert.deepEqual(
    await filesMentioning([
      "SESSION_LIMIT_TIME_REGEX",
      "MOCK_CLAUDE_SESSION_LIMIT_MESSAGE",
      "MOCK_CLAUDE_PING_SUCCESS_MESSAGE",
    ]),
    [],
  );
});

test("package scripts do not set mock modes or mount a data volume", async () => {
  const pkg = JSON.parse(await fs.readFile("package.json", "utf8"));
  const offenders = Object.entries(pkg.scripts).filter(
    ([, cmd]) => cmd.includes("MOCK_CLAUDE_") || cmd.includes("/home/claudepulse/.claude"),
  );

  assert.deepEqual(offenders.map(([name]) => name), []);
});
